function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    const err = new Error("PROVIDER_NOT_CONFIGURED");
    err.status = 501;
    err.details = { provider: "anthropic", missing: name };
    throw err;
  }
  return v;
}

const DEFAULT_SYSTEM_PROMPT =
  process.env.ANTHROPIC_SYSTEM_PROMPT ||
  [
    "Responde em Markdown limpo (títulos, listas, tabelas).",
    "NÃO envolvas a resposta inteira num bloco de código.",
    "Usa ``` apenas para trechos de código reais.",
    "Para tabelas, usa tabelas Markdown (pipes), não tabelas ASCII em monoespaçado.",
  ].join(" ");

function shouldStripFenceLanguage(lang) {
  const l = String(lang || "").trim().toLowerCase();
  return l === "md" || l === "markdown" || l === "text" || l === "plaintext";
}

function escapeRegExp(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unwrapSingleFencedBlock(text) {
  const s = String(text || "");
  // Support both ``` and ~~~ fences, and 3+ fence markers.
  // Only unwrap if the entire response is inside a single top-level fence and the fence language is a
  // "wrapper language" (markdown/text/empty).
  const m = s.match(/^\s*([`~]{3,})\s*([A-Za-z0-9_-]+)?\s*\n([\s\S]*?)\n\1[\t ]*$/);
  if (!m) return s;
  const lang = m[2] || "";
  if (!shouldStripFenceLanguage(lang)) return s;
  return String(m[3] || "");
}

function extractTextFromContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const out = [];
    for (const p of content) {
      if (!p || typeof p !== "object") continue;
      const t = String(p.type || "");
      if (t === "text" || t === "input_text") {
        const v =
          typeof p.text === "string"
            ? p.text
            : typeof p.content === "string"
              ? p.content
              : "";
        if (v) out.push(v);
      }
    }
    return out.join("");
  }
  return "";
}

function parseDataUrl(url) {
  const raw = String(url || "").trim();
  if (!raw.startsWith("data:")) return null;
  const comma = raw.indexOf(",");
  if (comma === -1) return null;
  const meta = raw.slice(5, comma);
  const data = raw.slice(comma + 1);
  const isBase64 = /;base64/i.test(meta);
  const mime = meta.split(";")[0] || "application/octet-stream";
  if (!isBase64) return null;
  if (!data) return null;
  return { mime, base64: data };
}

function toAnthropicBlocksFromContent(content) {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];

  const blocks = [];
  for (const p of content) {
    if (!p || typeof p !== "object") continue;
    const t = String(p.type || "");

    if (t === "text" || t === "input_text") {
      const v =
        typeof p.text === "string"
          ? p.text
          : typeof p.content === "string"
            ? p.content
            : "";
      if (v) blocks.push({ type: "text", text: v });
      continue;
    }

    if (t === "image_url") {
      const url = typeof p.image_url === "string" ? p.image_url : p.image_url?.url;
      const parsed = parseDataUrl(url);
      if (parsed) {
        blocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: parsed.mime,
            data: parsed.base64,
          },
        });
      }
    }
  }

  return blocks;
}

function createFenceStrippingSink(onDelta, opts) {
  const options = opts && typeof opts === "object" ? opts : {};
  let out = "";
  let deltaBuf = "";
  const flushBytes = Number.parseInt(process.env.ANTHROPIC_STREAM_FLUSH_BYTES || "32", 10) || 32;
  let mode = "normal"; // normal | pending_decision | keep_fence | strip_fence

  let atLineStart = true;
  let lineProbe = ""; // used only when we might be looking at a fence line

  // Fence header info when inside a fenced block
  let fenceChar = null; // ` or ~
  let fenceLen = 0; // opening fence length
  let fenceLang = ""; // language after opening fence
  let fenceHeaderRaw = ""; // original opening line (no trailing \n)

  // For empty-language fences we need to decide keep/strip based on first real content
  let decisionBuf = "";
  let pendingContent = ""; // buffered content while deciding (does not include the header line)
  let decisionLine = ""; // current line while deciding (includes \n when completed)

  const emit = (chunk) => {
    if (!chunk) return;
    out += chunk;
    deltaBuf += chunk;
    if (deltaBuf.length >= flushBytes && typeof onDelta === "function") {
      onDelta(deltaBuf);
      deltaBuf = "";
    }
  };

  const flushDelta = () => {
    if (!deltaBuf) return;
    if (typeof onDelta === "function") onDelta(deltaBuf);
    deltaBuf = "";
  };

  const parseFenceHeaderLine = (line) => {
    // Code fence line: optional indent + ``` or ~~~ + optional lang + nothing else
    const m = String(line || "").match(/^\s{0,3}([`~]{3,})\s*([\w+-]+)?\s*$/);
    if (!m) return null;
    const fence = m[1] || "";
    const lang = m[2] || "";
    const ch = fence[0];
    const len = fence.length;
    return { fence: fence, fenceChar: ch, fenceLen: len, lang, raw: String(line || "") };
  };

  const isClosingFenceLine = (line) => {
    if (!fenceChar || fenceLen < 3) return false;
    const t = String(line || "").trim();
    if (!t) return false;
    if (t[0] !== fenceChar) return false;
    let n = 0;
    while (n < t.length && t[n] === fenceChar) n += 1;
    if (n < fenceLen) return false;
    return String(t.slice(n)).trim() === "";
  };

  const looksLikeMarkdown = (s) => {
    const t = String(s || "").trim();
    if (!t) return false;
    if (/^(#{1,6})\s+/.test(t)) return true;
    if (/^>\s?/.test(t)) return true;
    if (/^[-*]\s+/.test(t)) return true;
    if (/^\d+\.\s+/.test(t)) return true;
    if (t.includes("|")) return true;
    if (/^\s*(---|\*\*\*)\s*$/.test(t)) return true;
    return false;
  };

  const looksLikeCode = (s) => {
    const t = String(s || "").trim();
    if (!t) return false;
    if (/[{};]/.test(t)) return true;
    if (/\b(const|let|var|function|import|export|class|return|await|async)\b/.test(t)) return true;
    if (/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP)\b/i.test(t)) return true;
    if (/<\/?[A-Za-z][^>]*>/.test(t)) return true;
    return false;
  };

  const decideEmptyFenceMode = (sample) => {
    // If the user didn't ask for code, treat empty-language fences as formatting wrappers and strip them.
    // This prevents Claude Opus from turning the whole answer into a big "code-looking" block.
    if (options.userWantsCode === false) return "strip_fence";

    const oneLine = String(sample || "").split("\n")[0] || "";
    if (looksLikeMarkdown(oneLine) && !looksLikeCode(oneLine)) return "strip_fence";
    return "keep_fence";
  };

  const enterFence = ({ fenceChar: ch, fenceLen: len, lang, raw }) => {
    fenceChar = ch;
    fenceLen = len;
    fenceLang = String(lang || "");
    fenceHeaderRaw = String(raw || "");

    decisionBuf = "";
    pendingContent = "";
    decisionLine = "";

    const l = fenceLang.trim().toLowerCase();
    if (l && shouldStripFenceLanguage(l)) {
      mode = "strip_fence";
      return;
    }
    if (l) {
      mode = "keep_fence";
      emit(`${fenceHeaderRaw}\n`);
      return;
    }

    // Empty language: delay decision until we see some content (or closing line).
    mode = "pending_decision";
  };

  const exitFence = (keepClosingLine, closingLine) => {
    if (keepClosingLine && closingLine != null) emit(`${closingLine}\n`);
    fenceChar = null;
    fenceLen = 0;
    fenceLang = "";
    fenceHeaderRaw = "";
    decisionBuf = "";
    pendingContent = "";
    mode = "normal";
    atLineStart = true;
    lineProbe = "";
  };

  const flushLineProbeAsText = () => {
    if (!lineProbe) return;
    if (mode === "pending_decision") {
      pendingContent += lineProbe;
      decisionLine += lineProbe;
    } else {
      emit(lineProbe);
    }
    atLineStart = lineProbe.endsWith("\n");
    lineProbe = "";
  };

  const maybeDecideFromDecisionLine = () => {
    if (mode !== "pending_decision") return;
    if (!decisionLine.endsWith("\n")) return;

    const line = decisionLine.slice(0, -1);
    decisionLine = "";

    if (!line.trim()) return;

    decisionBuf += `${line}\n`;
    const nextMode = decideEmptyFenceMode(decisionBuf);

    if (nextMode === "keep_fence") emit(`${fenceHeaderRaw}\n`);
    emit(pendingContent);
    pendingContent = "";
    decisionBuf = "";
    mode = nextMode;
  };

  const tryConsumeFenceLine = () => {
    // Only attempt when lineProbe has a full line (ends with \n).
    if (!lineProbe.endsWith("\n")) return false;
    const line = lineProbe.slice(0, -1); // drop \n for parsing
    const parsed = parseFenceHeaderLine(line);

    if (mode === "normal") {
      if (parsed) {
        lineProbe = "";
        enterFence(parsed);
        return true;
      }
      // Not a fence header; just emit as text.
      flushLineProbeAsText();
      return true;
    }

    // In any fence mode, we need to catch the closing fence line.
    if (isClosingFenceLine(line)) {
      lineProbe = "";
      if (mode === "keep_fence") exitFence(true, line);
      else exitFence(false, line);
      return true;
    }

    // Not a closing line. In normal keep/strip we can stream it.
    if (mode === "keep_fence" || mode === "strip_fence") {
      lineProbe = "";
      if (mode === "keep_fence") emit(`${line}\n`);
      else emit(`${line}\n`);
      atLineStart = true;
      return true;
    }

    if (mode === "pending_decision") {
      lineProbe = "";
      const trimmed = line.trim();
      if (!trimmed) {
        // still deciding; buffer blank lines
        pendingContent += `${line}\n`;
        atLineStart = true;
        return true;
      }

      decisionBuf += `${line}\n`;
      pendingContent += `${line}\n`;

      // Decide as soon as we have a little context.
      if (decisionBuf.length >= 1) {
        const nextMode = decideEmptyFenceMode(decisionBuf);
        if (nextMode === "keep_fence") {
          emit(`${fenceHeaderRaw}\n`);
          emit(pendingContent);
          mode = "keep_fence";
        } else {
          emit(pendingContent);
          mode = "strip_fence";
        }
        decisionBuf = "";
        pendingContent = "";
      }

      atLineStart = true;
      return true;
    }

    // Fallback: emit as text.
    flushLineProbeAsText();
    return true;
  };

  const push = (chunk) => {
    if (!chunk) return;
    const s = String(chunk || "");

    for (let i = 0; i < s.length; i += 1) {
      const ch = s[i];

      // If we're probing a line (potential fence header or closing fence), buffer just enough to decide.
      if (atLineStart) {
        // If this is a clearly non-fence line, we can stream immediately without buffering the whole line.
        if (!lineProbe) {
          // allow up to 3 leading spaces for fence markers
          const isSpace = ch === " " || ch === "\t";
          const isFenceCh = ch === "`" || ch === "~";
          if (!isSpace && !isFenceCh) {
            // Normal line start: stream directly.
            if (mode === "pending_decision") {
              pendingContent += ch;
              decisionLine += ch;
              if (ch === "\n") maybeDecideFromDecisionLine();
              atLineStart = ch === "\n";
            } else {
              emit(ch);
              atLineStart = ch === "\n";
            }
            continue;
          }
        }

        lineProbe += ch;

        // Early flush if lineProbe can't possibly be a fence line.
        const probeNoIndent = lineProbe.replace(/^\s{0,3}/, "");
        if (probeNoIndent && !probeNoIndent.startsWith("`") && !probeNoIndent.startsWith("~")) {
          // Not a fence header/closing line. Flush what we buffered and continue streaming rest of line.
          flushLineProbeAsText();
          continue;
        }

        // Once we have a newline, parse the full line.
        if (ch === "\n") {
          tryConsumeFenceLine();
          continue;
        }

        // If we already buffered a few chars and it's not going to be a fence (e.g. 1-2 backticks then text),
        // flush quickly to keep streaming granular.
        if (probeNoIndent.startsWith("`") || probeNoIndent.startsWith("~")) {
          const c0 = probeNoIndent[0];
          let n = 0;
          while (n < probeNoIndent.length && probeNoIndent[n] === c0) n += 1;
          const next = probeNoIndent[n] || "";
          if (n > 0 && n < 3 && next && next !== c0 && next !== "\n") {
            flushLineProbeAsText();
            continue;
          }
        }

        // Keep buffering until we can decide (newline or early flush conditions).
        continue;
      }

      // Not at line start: stream normally according to mode.
      if (mode === "pending_decision") {
        pendingContent += ch;
        decisionLine += ch;
        if (ch === "\n") {
          atLineStart = true;
          maybeDecideFromDecisionLine();
        }
      } else {
        emit(ch);
        if (ch === "\n") atLineStart = true;
      }
    }

    flushDelta();
  };

  const finish = () => {
    // If we're in pending decision and never saw a non-empty line, decide "strip" (wrapper) by default.
    if (mode === "pending_decision") {
      const nextMode = decideEmptyFenceMode(decisionBuf);
      if (nextMode === "keep_fence") emit(`${fenceHeaderRaw}\n`);
      emit(pendingContent);
      mode = nextMode;
      decisionBuf = "";
      pendingContent = "";
      decisionLine = "";
    }

    // Flush any remaining probe as plain text (never treat as a fence without newline).
    if (lineProbe) flushLineProbeAsText();

    flushDelta();
    return out;
  };

  return { push, finish, getText: () => out };
}

function stripWrapperMarkdownFencesEverywhere(text, opts) {
  let out = "";
  const sink = createFenceStrippingSink((d) => {
    out += d;
  }, opts);
  sink.push(String(text || ""));
  sink.finish();
  return out;
}

function normalizeBaseUrl(raw) {
  const fallback = "https://api.anthropic.com/v1";
  const src = String(raw || fallback).trim();
  let u;
  try {
    u = new URL(src);
  } catch {
    return fallback;
  }

  // Many people set ANTHROPIC_BASE_URL=https://api.anthropic.com (no /v1).
  // The Messages API lives under /v1/messages, so add /v1 when the path is empty.
  if (!u.pathname || u.pathname === "/") u.pathname = "/v1";

  // Normalize trailing slash for simple `${baseUrl}/messages` joining.
  return u.toString().replace(/\/$/, "");
}

function getAnthropicMaxTokens() {
  const explicit = Number.parseInt(process.env.ANTHROPIC_MAX_TOKENS || "", 10);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  // Keep Claude answers much larger by default so long code responses
  // don't hit avoidable auto-continue as quickly.
  return 30000;
}

function sseParseFrames(buffer) {
  // Some servers use CRLF delimiters (\r\n\r\n). Normalize to LF so splitting works.
  const normalized = String(buffer || "").replace(/\r/g, "");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() || "";
  return { frames: parts, rest };
}

function parseSseFrame(frame) {
  // Anthropic streams SSE frames with optional "event:" + "data:" lines.
  const lines = String(frame || "").split("\n");
  let event = null;
  const dataLines = [];

  for (const line of lines) {
    const l = String(line || "").trimEnd();
    if (!l) continue;
    if (l.startsWith("event:")) {
      event = l.slice(6).trim();
      continue;
    }
    if (l.startsWith("data:")) {
      dataLines.push(l.slice(5).trimStart());
    }
  }

  const dataRaw = dataLines.join("\n").trim();
  if (!dataRaw) return null;
  try {
    return { event, json: JSON.parse(dataRaw) };
  } catch {
    return { event, raw: dataRaw };
  }
}

function extractUsage(json) {
  const u = json?.usage;
  if (!u || typeof u !== "object") return null;
  const prompt = Number(u.input_tokens);
  const completion = Number(u.output_tokens);
  const total = (Number.isFinite(prompt) ? prompt : 0) + (Number.isFinite(completion) ? completion : 0);
  const cacheRead = Number(u.cache_read_input_tokens);
  const cacheCreate = Number(u.cache_creation_input_tokens);
  return {
    prompt_tokens: Number.isFinite(prompt) ? prompt : null,
    completion_tokens: Number.isFinite(completion) ? completion : null,
    total_tokens: Number.isFinite(total) ? total : null,
    cache_read_input_tokens: Number.isFinite(cacheRead) ? cacheRead : null,
    cache_creation_input_tokens: Number.isFinite(cacheCreate) ? cacheCreate : null,
    anthropic: u,
  };
}

function buildProviderError({ status, text }) {
  // Anthropic error shape:
  // { type: "error", error: { type: "...", message: "..." } }
  let code = "PROVIDER_ERROR";
  let message = "";
  try {
    const j = JSON.parse(text || "{}");
    code = j?.error?.type || j?.type || code;
    message = j?.error?.message || j?.message || "";
  } catch {
    // ignore JSON parse errors
  }

  const err = new Error(code || "PROVIDER_ERROR");
  err.status = status || 500;
  err.details = {
    provider: "anthropic",
    code: code || null,
    message: message || null,
    body: String(text || "").slice(0, 2000),
  };

  if (process.env.DEBUG_AI === "1") {
    console.error("[anthropic] error", {
      status: err.status,
      code: err.details.code,
      message: err.details.message,
      body: err.details.body,
    });
  }

  return err;
}

function toAnthropicPayload({ remoteModel, messages }) {
  const systemParts = [];
  const outMessages = [];

  for (const m of Array.isArray(messages) ? messages : []) {
    const role = String(m?.role || "");
    const rawContent = m?.content;

    if (role === "system") {
      const t = extractTextFromContent(rawContent);
      if (t) systemParts.push(t);
      continue;
    }

    if (role === "user" || role === "assistant") {
      const blocks = toAnthropicBlocksFromContent(rawContent);
      if (blocks.length === 0) continue;
      outMessages.push({
        role,
        content: blocks,
      });
    }
  }

  const system = [DEFAULT_SYSTEM_PROMPT, ...systemParts].filter(Boolean).join("\n\n");

  const enableCaching = String(process.env.ANTHROPIC_PROMPT_CACHING || "1") !== "0";
  const cacheTtl = String(process.env.ANTHROPIC_PROMPT_CACHE_TTL || "").trim();
  const cache_control =
    enableCaching
      ? {
          type: "ephemeral",
          ...(cacheTtl ? { ttl: cacheTtl } : {}),
        }
      : undefined;

  return {
    model: remoteModel,
    max_tokens: getAnthropicMaxTokens(),
    ...(system ? { system } : {}),
    messages: outMessages,
    ...(cache_control ? { cache_control } : {}),
  };
}

const AUTO_CONTINUE_PROMPT =
  process.env.ANTHROPIC_AUTO_CONTINUE_PROMPT ||
  [
    "Continua exatamente a resposta a partir de onde paraste.",
    "Responde apenas com a continuação (sem preâmbulos, sem repetir o que já disseste).",
    "Mantém o mesmo idioma e formatação Markdown.",
  ].join(" ");

function shouldAutoContinueFromStopReason(stopReason) {
  const sr = String(stopReason || "")
    .trim()
    .toLowerCase();
  return sr === "max_tokens" || sr === "length";
}

function mergeUsage(a, b) {
  const ua = a && typeof a === "object" ? a : null;
  const ub = b && typeof b === "object" ? b : null;
  if (!ua) return ub;
  if (!ub) return ua;
  const p = (Number(ua.prompt_tokens) || 0) + (Number(ub.prompt_tokens) || 0);
  const c = (Number(ua.completion_tokens) || 0) + (Number(ub.completion_tokens) || 0);
  const t = (Number(ua.total_tokens) || 0) + (Number(ub.total_tokens) || 0);
  const cr = (Number(ua.cache_read_input_tokens) || 0) + (Number(ub.cache_read_input_tokens) || 0);
  const cc = (Number(ua.cache_creation_input_tokens) || 0) + (Number(ub.cache_creation_input_tokens) || 0);
  return {
    prompt_tokens: p || null,
    completion_tokens: c || null,
    total_tokens: t || null,
    cache_read_input_tokens: cr || null,
    cache_creation_input_tokens: cc || null,
    anthropic: ub.anthropic || ua.anthropic || null,
  };
}

function detectUserWantsCodeFromMessages(messages) {
  const lastUser = Array.isArray(messages)
    ? [...messages].reverse().find((m) => m && m.role === "user")
    : null;
  const lastUserText = extractTextFromContent(lastUser?.content || "");
  return /\b(c[oó]digo|code|script|programa|implementa|implementar|exemplo\s+de\s+c[oó]digo)\b/i.test(
    String(lastUserText || "")
  );
}

function emitTextChunks(onDelta, text, chunkSize = 64) {
  if (typeof onDelta !== "function") return;
  const s = String(text || "");
  for (let i = 0; i < s.length; i += chunkSize) onDelta(s.slice(i, i + chunkSize));
}

function detectRichCodeRequestFromMessages(messages) {
  const lastUser = Array.isArray(messages)
    ? [...messages].reverse().find((m) => m && m.role === "user")
    : null;
  const text = String(extractTextFromContent(lastUser?.content || "") || "");
  if (!text.trim()) return false;
  if (/```|~~~/.test(text)) return true;
  if (/\b[\w.-]+\.(jsx?|tsx?|css|scss|sass|less|html|json|md|py|java|kt|swift|php|rb|go|rs|c|cpp|cs|sql)\b/i.test(text)) {
    return true;
  }

  const asksToBuild =
    /\b(escrev(?:e|er)|cria(?:r)?|gera(?:r)?|faz(?:er)?|monta(?:r)?|build|complete?|completo|full)\b/i.test(
      text
    );
  const codeSurface =
    /\b(react|componente?|component|jsx|tsx|css|html|json|typescript|javascript|frontend|backend|api)\b/i.test(
      text
    );

  return asksToBuild && codeSurface;
}

function getAnthropicAutoContinueMax() {
  const explicit = Number.parseInt(process.env.ANTHROPIC_AUTO_CONTINUE_MAX || "", 10);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  return 2;
}

function getAnthropicEmptyStreamRetryMax() {
  const explicit = Number.parseInt(process.env.ANTHROPIC_STREAM_EMPTY_RETRIES || "", 10);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  return 1;
}

function buildAutoContinueMessages(messages, assistantText) {
  return [
    ...(Array.isArray(messages) ? messages : []),
    { role: "assistant", content: String(assistantText || "") },
    { role: "user", content: AUTO_CONTINUE_PROMPT },
  ];
}

async function generateOnce({ remoteModel, messages, signal }) {
  const apiKey = requireEnv("ANTHROPIC_API_KEY");
  const baseUrl = normalizeBaseUrl(process.env.ANTHROPIC_BASE_URL);
  const version = process.env.ANTHROPIC_VERSION || "2023-06-01";

  if (process.env.DEBUG_AI === "1") {
    console.error("[anthropic] request", {
      remoteModel,
      baseUrl,
      version,
      keyLen: apiKey.length,
      keyLast4: apiKey.slice(-4),
      stream: false,
    });
  }

  const makeRequest = async (body) =>
    fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": version,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });

  const body = toAnthropicPayload({ remoteModel, messages });

  let resp = await makeRequest(body);
  if (!resp.ok && resp.status === 400 && body && typeof body === "object" && body.cache_control) {
    const text = await resp.text().catch(() => "");
    if (text.toLowerCase().includes("cache_control") || text.toLowerCase().includes("prompt caching")) {
      const body2 = { ...body };
      delete body2.cache_control;
      resp = await makeRequest(body2);
    } else {
      throw buildProviderError({ status: resp.status, text });
    }
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw buildProviderError({ status: resp.status, text });
  }

  const json = await resp.json().catch(() => null);
  const usage = extractUsage(json);
  const stopReason = typeof json?.stop_reason === "string" ? json.stop_reason : null;
  const content = Array.isArray(json?.content) ? json.content : [];
  const textRaw = content
    .map((p) => (p && p.type === "text" && typeof p.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("");

  const userWantsCode =
    detectUserWantsCodeFromMessages(messages) || detectRichCodeRequestFromMessages(messages);

  const text = stripWrapperMarkdownFencesEverywhere(textRaw, { userWantsCode });
  return { text, usage, stopReason };
}

async function streamOnce({ remoteModel, messages, onDelta, signal }) {
  const apiKey = requireEnv("ANTHROPIC_API_KEY");
  const baseUrl = normalizeBaseUrl(process.env.ANTHROPIC_BASE_URL);
  const version = process.env.ANTHROPIC_VERSION || "2023-06-01";

  if (process.env.DEBUG_AI === "1") {
    console.error("[anthropic] request", {
      remoteModel,
      baseUrl,
      version,
      keyLen: apiKey.length,
      keyLast4: apiKey.slice(-4),
      stream: true,
    });
  }

  const makeRequest = async (body) =>
    fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": version,
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });

  const body = {
    ...toAnthropicPayload({ remoteModel, messages }),
    stream: true,
  };

  let resp = await makeRequest(body);
  if (!resp.ok && resp.status === 400 && body && typeof body === "object" && body.cache_control) {
    const text = await resp.text().catch(() => "");
    if (text.toLowerCase().includes("cache_control") || text.toLowerCase().includes("prompt caching")) {
      const body2 = { ...body };
      delete body2.cache_control;
      resp = await makeRequest(body2);
    } else {
      throw buildProviderError({ status: resp.status, text });
    }
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw buildProviderError({ status: resp.status, text });
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");

  let acc = "";
  const userWantsCode =
    detectUserWantsCodeFromMessages(messages) || detectRichCodeRequestFromMessages(messages);
  const sink = createFenceStrippingSink(onDelta, { userWantsCode });
  let usage = null;
  let stopReason = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    acc += decoder.decode(value, { stream: true });
    const { frames, rest } = sseParseFrames(acc);
    acc = rest;

    for (const frame of frames) {
      const parsed = parseSseFrame(frame);
      if (!parsed || !parsed.json) continue;

      const ev = parsed.json;

      // Usage can appear in message_start / message_delta.
      const u = extractUsage(ev?.message || ev);
      if (u) usage = u;

      const sr = ev?.delta?.stop_reason || ev?.message?.stop_reason || ev?.stop_reason;
      if (typeof sr === "string") stopReason = sr;

      // Text deltas are usually in:
      // - event: content_block_delta { delta: { type: "text_delta", text: "..." } }
      const delta = ev?.delta;
      if (delta && delta.type === "text_delta" && typeof delta.text === "string") {
        const chunk = delta.text;
        if (chunk) {
          sink.push(chunk);
        }
      }

      // Some implementations may send initial text in content_block_start.
      const contentBlock = ev?.content_block;
      if (contentBlock && contentBlock.type === "text" && typeof contentBlock.text === "string") {
        const chunk = contentBlock.text;
        if (chunk) {
          sink.push(chunk);
        }
      }

      if (parsed.event === "message_stop") {
        return { text: sink.finish(), usage, stopReason };
      }
    }
  }

  return { text: sink.finish(), usage, stopReason };
}

async function streamChat({ remoteModel, messages, onDelta, signal }) {
  const maxCont = getAnthropicAutoContinueMax();
  const maxEmptyRetries = getAnthropicEmptyStreamRetryMax();

  let combinedText = "";
  let combinedUsage = null;
  let currentStopReason = null;
  let currentMessages = Array.isArray(messages) ? messages : [];

  for (let segment = 0; segment <= maxCont; segment += 1) {
    let out = null;

    for (let attempt = 0; attempt <= maxEmptyRetries; attempt += 1) {
      out = await streamOnce({
        remoteModel,
        messages: currentMessages,
        onDelta,
        signal,
      });

      if (String(out?.text || "").trim()) break;
      if (attempt < maxEmptyRetries && process.env.DEBUG_AI === "1") {
        console.error("[anthropic] retry empty stream", {
          remoteModel,
          segment: segment + 1,
          attempt: attempt + 2,
        });
      }
    }

    const segmentText = String(out?.text || "");
    currentStopReason = out?.stopReason || null;

    if (!segmentText.trim()) {
      if (process.env.DEBUG_AI === "1") {
        console.error("[anthropic] stream empty", { remoteModel, segment: segment + 1 });
      }

      // Final safety fallback if Anthropic's SSE channel produced no visible text.
      if (!combinedText.trim()) {
        const fallback = await generateOnce({
          remoteModel,
          messages: currentMessages,
          signal,
        });
        const fallbackText = String(fallback?.text || "");
        if (fallbackText) emitTextChunks(onDelta, fallbackText);
        combinedText += fallbackText;
        combinedUsage = mergeUsage(combinedUsage, fallback?.usage || null);
        currentStopReason = fallback?.stopReason || currentStopReason;
      }
      break;
    }

    combinedText += segmentText;
    combinedUsage = mergeUsage(combinedUsage, out?.usage || null);

    if (!shouldAutoContinueFromStopReason(currentStopReason)) break;
    if (segment >= maxCont) break;

    currentMessages = buildAutoContinueMessages(messages, combinedText);
  }

  return { text: combinedText, usage: combinedUsage, stopReason: currentStopReason };
}

module.exports = {
  streamChat,
  _debugStripWrapperMarkdownFences: stripWrapperMarkdownFencesEverywhere,
};
