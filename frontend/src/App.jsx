// frontend/src/App.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import "./App.css";
import Definicoes from "./Definicoes";
import CreativeStudio from "./CreativeStudio";
import Explorar from "./explorar.jsx";
import Projects from "./components/projects/Projects";
import PlanosModal from "./PlanosModal";
import MemoryModal from "./MemoryModal";
import LegalPage from "./LegalPage";
import SupportModal from "./SupportModal";
import { Routes, Route, useNavigate } from "react-router-dom";
import coreLogo from "./assets/coreai-logo.svg";
import { Pin, PinOff, Pencil, FlagOff, Search, X, MoreHorizontal } from "lucide-react";
import { useLocation } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import AuthModal from "./auth/AuthModal";
import { useAuth } from "./auth/AuthContext";
import { api, apiGetBlob, apiStream } from "./services/api";
import useFileDropTarget, { extractTransferFiles } from "./hooks/useFileDropTarget";
import ComposerFileDropOverlay from "./components/composer/ComposerFileDropOverlay";
import ArtifactCard, { ArtifactPreviewCard } from "./components/chat/ArtifactCard";
import {
  PROJECTS_STORAGE_UPDATED_EVENT,
  attachConversationToProjectRequest,
  clearStoredProjectsIndex,
  createProjectLinkId,
  findConversationProjectMatch,
  loadProjectsFromApi,
  readStoredProjectsIndex,
  removeConversationFromProjectRequest,
  sortProjectTargets,
  writeStoredProjectsIndex,
} from "./services/projects";
import { applyTheme } from "./utils/theme";

const MODELS = [
  {
    id: "__best__",
    name: "Best • Auto",
    provider: "core",
    logo: "/models/coreai.svg",
  },
  { id: "gpt-5.4 pro", name: "GPT-5.4 Pro", provider: "openai", logo: "/models/openai.svg" },
  { id: "gpt-5.4", name: "GPT-5.4", provider: "openai", logo: "/models/openai.svg" },
  { id: "gpt-5.2 pro", name: "GPT-5.2 Pro", provider: "openai", logo: "/models/openai.svg" },
  { id: "gpt-5.2", name: "GPT-5.2", provider: "openai", logo: "/models/openai.svg" },
  { id: "gpt-5.1", name: "GPT-5.1", provider: "openai", logo: "/models/openai.svg" },
  { id: "gpt-5-mini", name: "GPT-5 Mini", provider: "openai", logo: "/models/openai.svg" },
  { id: "gpt-5", name: "GPT-5", provider: "openai", logo: "/models/openai.svg" },
  { id: "claude-opus-4.6", name: "Claude Opus 4.6", provider: "anthropic", logo: "/models/anthropic.svg" },
  { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", provider: "anthropic", logo: "/models/anthropic.svg" },
  { id: "claude-opus-4.5", name: "Claude Opus 4.5", provider: "anthropic", logo: "/models/anthropic.svg" },
  { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", provider: "anthropic", logo: "/models/anthropic.svg" },
  { id: "claude-haiku-4.5", name: "Claude Haiku 4.5", provider: "anthropic", logo: "/models/anthropic.svg" },
  { id: "gemini-3.1 pro", name: "Gemini 3.1 Pro", provider: "google", logo: "/models/google.svg" },
  { id: "gemini-3 pro", name: "Gemini 3 Pro", provider: "google", logo: "/models/google.svg" },
  { id: "gemini-2.5 pro", name: "Gemini 2.5 Pro", provider: "google", logo: "/models/google.svg" },
  { id: "gemini-2.5 flash", name: "Gemini 2.5 Flash", provider: "google", logo: "/models/google.svg" },
  { id: "grok-4.2", name: "Grok 4.2", provider: "grok", logo: "/models/grok.svg" },
  { id: "grok-4.1", name: "Grok 4.1", provider: "grok", logo: "/models/grok.svg" },
  { id: "grok-4", name: "Grok 4", provider: "grok", logo: "/models/grok.svg" },
  { id: "deepseek-v3.2", name: "DeepSeek V3.2", provider: "deepseek", logo: "/models/deepseek.svg" },
  { id: "deepseek-r1", name: "DeepSeek R1", provider: "deepseek", logo: "/models/deepseek.svg" },
  { id: "perplexity-sonar-pro", name: "Perplexity Sonar Pro", provider: "perplexity", logo: "/models/perplexity.svg" },
  { id: "perplexity-sonar", name: "Perplexity Sonar", provider: "perplexity", logo: "/models/perplexity.svg" },
  {
    id: "nemotron 3 super",
    name: "Nemotron 3 Super",
    provider: "openrouter",
    logo: "https://cdn.simpleicons.org/nvidia/76B900",
  },
  {
    id: "minimax m2.7",
    name: "MiniMax M2.7",
    provider: "openrouter",
    logo: "/models/minimax-color.png",
  },
  { id: "kimi-k2-5", name: "Kimi K2.5", provider: "moonshot", logo: "/models/kimi.svg" },
  { id: "qwen3.5-plus", name: "Qwen 3.5 Plus", provider: "qwen", logo: "/models/qwen.svg" },
  { id: "qwen3.5-flash", name: "Qwen 3.5 Flash", provider: "qwen", logo: "/models/qwen.svg" },
  { id: "qwen3-max", name: "Qwen 3 Max", provider: "qwen", logo: "/models/qwen.svg" },
];
const NEW_MODEL_BADGE_IDS = new Set([
  "gpt-5.4 pro",
  "gpt-5.4",
  "gemini-3.1 pro",
  "claude-opus-4.6",
  "claude-sonnet-4.6",
  "nemotron 3 super",
  "minimax m2.7",
]);
const DEFAULT_MODEL = String(import.meta.env.VITE_DEFAULT_MODEL || "__best__").trim() || "__best__";
const FREE_ALLOWED_CHAT_MODEL_IDS = new Set([
  "__best__",
  "deepseek-v3.2",
  "gpt-5-mini",
  "gemini-2.5 flash",
  "qwen3.5-flash",
]);
const FREE_PLAN_BADGE_MODEL_IDS = new Set([
  "deepseek-v3.2",
  "gpt-5-mini",
  "gemini-2.5 flash",
  "qwen3.5-flash",
]);
const SUPPORT_MAX_FILES = 2;
const SUPPORT_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const SUPPORT_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const REMOTE_CONVERSATION_LIST_RETRY_DELAYS_MS = [350, 900, 1800];
function shouldRetryRemoteConversationListLoad(err) {
  const status = Number(err?.status || err?.response?.status || 0);
  return (
    status === 0 ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    err?.message === "DB_UNAVAILABLE" ||
    err?.message === "Network Error" ||
    err?.message === "REQUEST_FAILED"
  );
}

function waitMs(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function normalizeChatModelId(id) {
  const raw = String(id || "").trim();
  const norm = raw.toLowerCase();
  if (norm === "gpt-5-nano") return "gpt-5-mini";
  return raw;
}

function normalizeCreativeCredits(payload) {
  const limitRaw = payload?.creativeCreditsLimit ?? payload?.creativeLimit;
  const usedRaw = payload?.creativeCreditsUsed ?? payload?.creativeUsed;
  const remainingRaw = payload?.creativeCreditsRemaining ?? payload?.creativeRemaining;

  const limit = Number(limitRaw);
  const used = Number(usedRaw);
  const derivedRemaining = Number.isFinite(limit) && Number.isFinite(used) ? Math.max(0, limit - used) : NaN;
  const remaining = Number.isFinite(Number(remainingRaw)) ? Math.max(0, Number(remainingRaw)) : derivedRemaining;

  if (!Number.isFinite(limit)) return null;

  return {
    limit: Math.max(0, limit),
    used: Number.isFinite(used) ? Math.max(0, used) : 0,
    remaining: Number.isFinite(remaining) ? remaining : 0,
  };
}

function getCreativeCreditsCacheKey(userId) {
  const safeUserId = String(userId || "").trim();
  if (!safeUserId) return null;
  return `coreai_creative_credits_${safeUserId}`;
}

function readCachedCreativeCredits(userId) {
  const key = getCreativeCreditsCacheKey(userId);
  if (!key || typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return normalizeCreativeCredits(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeCachedCreativeCredits(userId, summary) {
  const key = getCreativeCreditsCacheKey(userId);
  if (!key || typeof window === "undefined" || !summary) return;

  try {
    window.localStorage.setItem(key, JSON.stringify(summary));
  } catch {
    // ignore
  }
}

function normalizeStatusText(text) {
  return String(text || "")
    .replace(/Ã¢â‚¬Â¦/g, "...")
    .replace(/â€¦/g, "...")
    .replace(/\u2026/g, "...")
    .trim();
}

function isThinkingStatusText(text) {
  const raw = normalizeStatusText(text).toLowerCase();
  return (
    raw === "core is thinking..." ||
    raw === "searching the web..."
  );
}

function isGeneratingStatusText(text) {
  const raw = normalizeStatusText(text).toLowerCase();
  return (
    raw === "generating..." ||
    raw === "a gerar..." ||
    raw.startsWith("generating") ||
    raw.startsWith("a gerar")
  );
}

function ThinkingStatus({ text }) {
  const raw = normalizeStatusText(text);
  const hasTrailingDots = raw.endsWith("...");
  const label = hasTrailingDots ? raw.slice(0, -3) : raw;
  const animatedChunk = hasTrailingDots ? `${label}...` : raw;

  return (
    <span className="thinking" aria-live="polite">
      {hasTrailingDots ? (
        <span className="thinking-tail" aria-hidden="true">
          <span className="thinking-tail-ghost">{animatedChunk}</span>
          <span className="thinking-tail-live">
            <span className="thinking-tail-base">{animatedChunk}</span>
            <span className="thinking-tail-shimmer">{animatedChunk}</span>
          </span>
        </span>
      ) : (
        <span className="thinking-label">{raw}</span>
      )}
    </span>
  );
}

function GeneratingStatus({ text }) {
  const raw = normalizeStatusText(text);
  const hasTrailingDots = raw.endsWith("...");
  const label = hasTrailingDots ? raw.slice(0, -3) : raw;
  const animatedChunk = hasTrailingDots ? `${label}...` : raw;

  return (
    <span className="thinking" aria-live="polite">
      {hasTrailingDots ? (
        <span className="thinking-tail" aria-hidden="true">
          <span className="thinking-tail-ghost">{animatedChunk}</span>
          <span className="thinking-tail-live">
            <span className="thinking-tail-base">{animatedChunk}</span>
            <span className="thinking-tail-shimmer">{animatedChunk}</span>
          </span>
        </span>
      ) : (
        <span className="thinking-label">{raw}</span>
      )}
    </span>
  );
}

function safeLinkHref(href) {
  const raw = String(href || "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw, window.location.origin);
    if (u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:") {
      return u.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function splitMathDelimiters(src) {
  const raw = String(src || "");
  if (raw.startsWith("\\(") && raw.endsWith("\\)")) {
    return { open: "\\(", inner: raw.slice(2, -2), close: "\\)" };
  }
  if (raw.startsWith("\\[") && raw.endsWith("\\]")) {
    return { open: "\\[", inner: raw.slice(2, -2), close: "\\]" };
  }
  if (raw.startsWith("$$") && raw.endsWith("$$")) {
    return { open: "$$", inner: raw.slice(2, -2), close: "$$" };
  }
  if (raw.startsWith("$") && raw.endsWith("$")) {
    return { open: "$", inner: raw.slice(1, -1), close: "$" };
  }
  return null;
}

function normalizeMathSourceForMathJax(src) {
  const parts = splitMathDelimiters(src);
  if (!parts) return src;

  const inner = parts.inner
    .replace(/(^|[^\\])%/g, (_, prefix) => `${prefix}\\%`)
    .replace(/(\d)\s*€/g, "$1\\text{€}")
    .replace(/£\s*(\d)/g, "\\text{£}$1")
    .replace(/¥\s*(\d)/g, "\\text{¥}$1");

  return `${parts.open}${inner}${parts.close}`;
}

function renderInline(md, keyPrefix) {
  const text = String(md || "");
  const nodes = [];
  let buf = "";
  let i = 0;
  let k = 0;

  const flush = () => {
    if (!buf) return;
    nodes.push(buf);
    buf = "";
  };

  const push = (el) => {
    nodes.push(el);
    k += 1;
  };

  const isEscapedAt = (pos) => {
    // true if the character at `pos` is preceded by an odd number of backslashes
    let n = 0;
    let p = pos - 1;
    while (p >= 0 && text[p] === "\\") {
      n += 1;
      p -= 1;
    }
    return n % 2 === 1;
  };

  const pushMathSpan = ({
    start,
    endExclusive,
    displayMode = false,
    pending = false,
    trimOpening = 0,
  }) => {
    flush();
    const src = text.slice(start, endExclusive);
    const shown = pending && trimOpening > 0 ? src.slice(trimOpening) : src;
    const normalized = pending ? shown : normalizeMathSourceForMathJax(src);
    push(
      <span
        className={`md-math ${displayMode ? "md-math-display" : "md-math-inline"}${
          pending ? " md-math-pending" : ""
        }`}
        key={`${keyPrefix}_math_${k}`}
      >
        {normalized}
      </span>
    );
  };

  while (i < text.length) {
    const ch = text[i];

    // New line -> <br/> (keeps multi-line math intact because math is tokenized below)
    if (ch === "\n") {
      flush();
      push(<br key={`${keyPrefix}_br_${k}`} />);
      i += 1;
      continue;
    }

    // Math delimiters: \( ... \) and \[ ... \]
    if (text.startsWith("\\(", i) || text.startsWith("\\[", i)) {
      const open = text.startsWith("\\(", i) ? "\\(" : "\\[";
      const close = open === "\\(" ? "\\)" : "\\]";
      let j = i + open.length;
      while (j < text.length) {
        if (text.startsWith(close, j) && !isEscapedAt(j)) break;
        j += 1;
      }
      if (j < text.length) {
        pushMathSpan({
          start: i,
          endExclusive: j + close.length,
          displayMode: open === "\\[",
        });
        i = j + close.length;
        continue;
      }

      pushMathSpan({
        start: i,
        endExclusive: text.length,
        displayMode: open === "\\[",
        pending: true,
        trimOpening: open.length,
      });
      i = text.length;
      continue;
    }

    // Math delimiters: $...$ and $$...$$
    if (ch === "$" && !isEscapedAt(i)) {
      const delim = text.startsWith("$$", i) ? "$$" : "$";
      let j = i + delim.length;
      while (j < text.length) {
        if (text.startsWith(delim, j) && !isEscapedAt(j)) {
          // For inline math, avoid closing on the first '$' of '$$'
          if (delim === "$" && text.startsWith("$$", j)) {
            j += 1;
            continue;
          }
          break;
        }
        j += 1;
      }
      if (j < text.length) {
        pushMathSpan({
          start: i,
          endExclusive: j + delim.length,
          displayMode: delim === "$$",
        });
        i = j + delim.length;
        continue;
      }

      const tail = text.slice(i + delim.length);
      const looksLikePendingMath =
        /[\\^_=+\-*/{}()[\]]/.test(tail) || /\b(?:frac|sqrt|sum|int|log|sin|cos|max|min)\b/.test(tail);

      if (looksLikePendingMath) {
        pushMathSpan({
          start: i,
          endExclusive: text.length,
          displayMode: delim === "$$",
          pending: true,
          trimOpening: delim.length,
        });
        i = text.length;
        continue;
      }
    }

    // Markdown backslash-escapes (but keep TeX commands like \frac intact)
    if (ch === "\\" && i + 1 < text.length) {
      const next = text[i + 1];
      const escapable = "\\`*_{}[]()#+-.!>".includes(next);
      const looksLikeTexCommand = /[A-Za-z]/.test(next);
      const looksLikeMathDelimiter = next === "(" || next === "[" || next === ")" || next === "]";

      if (looksLikeTexCommand || looksLikeMathDelimiter) {
        // Preserve the backslash; let the next char be processed normally.
        buf += ch;
        i += 1;
        continue;
      }

      if (escapable) {
        buf += next;
        i += 2;
        continue;
      }

      buf += ch;
      i += 1;
      continue;
    }

    // Inline code: `code`
    if (ch === "`") {
      const end = text.indexOf("`", i + 1);
      if (end !== -1) {
        flush();
        const code = text.slice(i + 1, end);
        push(
          <code className="md-code-inline" key={`${keyPrefix}_code_${k}`}>
            {code}
          </code>
        );
        i = end + 1;
        continue;
      }
    }

    // Link: [label](href)
    if (ch === "[") {
      const endLabel = text.indexOf("]", i + 1);
      if (endLabel !== -1 && text[endLabel + 1] === "(") {
        const endHref = text.indexOf(")", endLabel + 2);
        if (endHref !== -1) {
          const label = text.slice(i + 1, endLabel);
          const hrefRaw = text.slice(endLabel + 2, endHref);
          const href = safeLinkHref(hrefRaw);
          if (href) {
            flush();
            push(
              <a
                key={`${keyPrefix}_a_${k}`}
                href={href}
                target="_blank"
                rel="noreferrer"
              >
                {renderInline(label, `${keyPrefix}_a_lbl_${k}`)}
              </a>
            );
            i = endHref + 1;
            continue;
          }
        }
      }
    }

    // Bold: **text**
    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      if (end !== -1) {
        flush();
        const inner = text.slice(i + 2, end);
        push(
          <strong key={`${keyPrefix}_b_${k}`}>
            {renderInline(inner, `${keyPrefix}_b_in_${k}`)}
          </strong>
        );
        i = end + 2;
        continue;
      }
    }

    // Italic: *text*
    if (ch === "*" && !text.startsWith("**", i)) {
      const end = text.indexOf("*", i + 1);
      if (end !== -1) {
        flush();
        const inner = text.slice(i + 1, end);
        push(
          <em key={`${keyPrefix}_i_${k}`}>
            {renderInline(inner, `${keyPrefix}_i_in_${k}`)}
          </em>
        );
        i = end + 1;
        continue;
      }
    }

    buf += ch;
    i += 1;
  }

  flush();
  return nodes;
}

function splitTableRow(line) {
  const raw = String(line || "");
  const trimmed = raw.trim();
  const noEdge =
    trimmed.startsWith("|") && trimmed.endsWith("|") ? trimmed.slice(1, -1) : trimmed;
  return noEdge.split("|").map((c) => c.trim());
}

function isTableSep(line) {
  // e.g. | --- | :---: | ---: |
  const t = String(line || "").trim();
  if (!t.includes("-")) return false;
  return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(t);
}

function looksLikeRealCodeBlock(text, lang) {
  const normalizedLang = String(lang || "").trim().toLowerCase();
  if (normalizedLang && normalizedLang !== "md" && normalizedLang !== "markdown" && normalizedLang !== "text") {
    return true;
  }

  const raw = String(text || "");
  const trimmed = raw.trim();
  if (!trimmed) return false;

  let score = 0;

  if (/[{}[\];]/.test(trimmed)) score += 2;
  if (/(=>|===|!==|<=|>=|::|<\/?[A-Za-z][\w:-]*|import\s+\w|export\s+default|function\s+\w|const\s+\w|let\s+\w|var\s+\w|class\s+\w|def\s+\w|SELECT\s+|INSERT\s+|UPDATE\s+|DELETE\s+|body\s*\{|@\w+)/m.test(trimmed)) {
    score += 2;
  }
  if (/^\s{2,}\S/m.test(raw)) score += 1;
  if (/;\s*$|\{\s*$|^\s*<[^>]+>\s*$/m.test(raw)) score += 1;

  return score >= 2;
}

function looksLikeMarkdownProseBlock(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;

  let score = 0;
  const words = raw.match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]*/g) || [];

  if (/\*\*[^*]+\*\*/.test(raw)) score += 2;
  if (/^\s*(#{1,6}\s|[-*]\s+|\d+\.\s+|>\s)/m.test(raw)) score += 2;
  if (/[.!?…:]\s*$/m.test(raw)) score += 1;
  if (words.length >= 18) score += 2;
  if (/\n\s*\n/.test(raw)) score += 1;

  return score >= 3;
}

function looksLikeStructuredPlainBlock(text) {
  const raw = String(text || "");
  const trimmed = raw.trim();
  if (!trimmed) return false;

  let score = 0;

  if (/[│└┘├┤┌┐─━]/.test(trimmed)) score += 3;
  if (/^\s*[-*]\s+/m.test(trimmed)) score += 1;
  if (/^\s{2,}\S/m.test(raw)) score += 1;
  if (/[:：]\s*$/m.test(trimmed)) score += 1;
  if (/^\s*[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9_ ()/-]{0,40}\s*$/m.test(trimmed) && /\n/.test(trimmed))
    score += 1;

  return score >= 3;
}

function parseMarkdownBlocks(md) {
  const text = String(md || "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const blocks = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = String(line || "");

    if (!t.trim()) {
      i += 1;
      continue;
    }

    // Code block ```lang
    const codeStart = t.trim().match(/^```([\w+-]*)\s*$/);
    if (codeStart) {
      const lang = codeStart[1] || "";
      i += 1;
      const codeLines = [];
      while (i < lines.length && !String(lines[i]).trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1; // consume closing ```
      const codeText = codeLines.join("\n");
      const normalizedLang = String(lang || "").trim().toLowerCase();

      if (
        normalizedLang === "md" ||
        normalizedLang === "markdown" ||
        (!looksLikeRealCodeBlock(codeText, normalizedLang) && looksLikeMarkdownProseBlock(codeText))
      ) {
        const nestedBlocks = parseMarkdownBlocks(codeText);
        if (nestedBlocks.length > 0) {
          blocks.push(...nestedBlocks);
          continue;
        }
      }

      if (
        normalizedLang === "text" ||
        normalizedLang === "txt" ||
        normalizedLang === "plain" ||
        normalizedLang === "plaintext" ||
        (!looksLikeRealCodeBlock(codeText, normalizedLang) && looksLikeStructuredPlainBlock(codeText))
      ) {
        blocks.push({ type: "plain", text: codeText });
        continue;
      }

      blocks.push({ type: "code", lang, text: codeText });
      continue;
    }

    // HR
    if (/^\s*(---|\*\*\*)\s*$/.test(t)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    // Heading
    const h = t.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (h) {
      const level = Math.min(3, h[1].length);
      blocks.push({ type: "heading", level, text: h[2] || "" });
      i += 1;
      continue;
    }

    // Blockquote
    if (/^\s*>/.test(t)) {
      const q = [];
      while (i < lines.length && /^\s*>/.test(String(lines[i] || ""))) {
        q.push(String(lines[i]).replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "blockquote", lines: q });
      continue;
    }

    // Table
    const next = i + 1 < lines.length ? lines[i + 1] : "";
    if (t.includes("|") && isTableSep(next)) {
      const header = splitTableRow(t);
      i += 2; // consume header + sep
      const rows = [];
      while (i < lines.length && String(lines[i] || "").includes("|") && String(lines[i] || "").trim()) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    // Lists
    const ul = t.match(/^\s*[-*]\s+(.*)$/);
    const ol = t.match(/^\s*(\d+)\.\s+(.*)$/);
    if (ul || ol) {
      const ordered = !!ol;
      const items = [];
      while (i < lines.length) {
        const cur = String(lines[i] || "");
        const m = ordered ? cur.match(/^\s*(\d+)\.\s+(.*)$/) : cur.match(/^\s*[-*]\s+(.*)$/);
        if (!m) break;
        items.push(ordered ? m[2] : m[1]);
        i += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    // Paragraph (consume until blank line)
    const p = [];
    while (i < lines.length && String(lines[i] || "").trim()) {
      const cur = String(lines[i] || "");
      // Stop paragraph if a new block starts.
      if (cur.trim().startsWith("```")) break;
      if (/^\s{0,3}#{1,6}\s+/.test(cur)) break;
      if (/^\s*>/.test(cur)) break;
      if (/^\s*(---|\*\*\*)\s*$/.test(cur)) break;
      if (/^\s*[-*]\s+/.test(cur)) break;
      if (/^\s*\d+\.\s+/.test(cur)) break;
      if (cur.includes("|") && isTableSep(i + 1 < lines.length ? lines[i + 1] : "")) break;
      p.push(cur);
      i += 1;
    }
    blocks.push({ type: "p", lines: p });
  }

  return blocks;
}

function normalizeAssistantMarkdown(md) {
  const text = String(md || "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const out = [];

  let inCode = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = String(line || "").trim();

    // Track fenced code blocks
    if (trimmed.startsWith("```")) {
      inCode = !inCode;
      out.push(line);
      continue;
    }

    if (!inCode) {
      // Convert markdown headings to bold titles (we don't want raw ### in the UI).
      // Heading line
      const h = String(line || "").match(/^\s{0,3}(#{1,6})\s+(.*)$/);
      if (h) {
        const title = String(h[2] || "").trim();
        if (title) {
          out.push("");
          out.push(`**${title}**`);
          out.push("");
        } else {
          out.push("");
        }
        continue;
      }

      // Headings inside list items (e.g. "- ### Title")
      const lh = String(line || "").match(/^(\s*[-*]\s+)(#{1,6})\s+(.*)$/);
      if (lh) {
        const prefix = lh[1] || "- ";
        const title = String(lh[3] || "").trim();
        out.push(`${prefix}**${title || ""}**`);
        continue;
      }
      const oh = String(line || "").match(/^(\s*\d+\.\s+)(#{1,6})\s+(.*)$/);
      if (oh) {
        const prefix = oh[1] || "1. ";
        const title = String(oh[3] || "").trim();
        out.push(`${prefix}**${title || ""}**`);
        continue;
      }
    }

    out.push(line);
  }

  // Avoid huge vertical gaps, but keep 1 blank line separation.
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

const MAX_ASSISTANT_SELECTION_CHARS = 1200;

function clearWindowSelection() {
  try {
    window.getSelection()?.removeAllRanges();
  } catch {}
}

function normalizeQuotedSelectionText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function normalizeQuotedSelectionPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const text = normalizeQuotedSelectionText(value.text);
  if (!text) return null;

  const previewText = normalizeQuotedSelectionText(value.previewText);
  return previewText ? { text, previewText } : { text };
}

function unpackPersistedMessageAttachments(value) {
  if (Array.isArray(value)) {
    return {
      attachments: value,
      quotedSelection: null,
    };
  }

  if (value && typeof value === "object") {
    const attachments = Array.isArray(value.items)
      ? value.items
      : Array.isArray(value.attachments)
        ? value.attachments
        : [];

    return {
      attachments,
      quotedSelection: normalizeQuotedSelectionPayload(value.quotedSelection),
    };
  }

  return {
    attachments: [],
    quotedSelection: null,
  };
}

function buildPersistedMessageAttachments(attachments, quotedSelection) {
  const items = Array.isArray(attachments) ? attachments : [];
  const normalizedQuote = normalizeQuotedSelectionPayload(quotedSelection);

  if (!normalizedQuote) return items.length > 0 ? items : null;

  return {
    items,
    quotedSelection: normalizedQuote,
  };
}

function normalizePersistedConversationMessage(message) {
  const persisted = unpackPersistedMessageAttachments(message?.attachments);
  return {
    id: message?.id || null,
    role: message?.role,
    content: message?.content || "",
    attachments: persisted.attachments,
    quotedSelection: persisted.quotedSelection,
    artifact: message?.artifact || null,
    artifactIntentType: message?.artifact?.type || null,
    pendingArtifactIntentType: null,
    artifactPendingSync: false,
    artifactEditedLocally: false,
  };
}

function buildQuotedPreviewText(text, maxLength = 96) {
  const normalized = normalizeQuotedSelectionText(text);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function buildQuotedUserPrompt(text, quotedText) {
  const message = String(text || "").trim();
  const quote = String(quotedText || "").trim();
  if (!quote) return message;

  return [
    "Selected excerpt from the previous assistant message:",
    `"""${quote}"""`,
    "",
    "User follow-up:",
    message,
  ].join("\n");
}

function getSelectionNodeElement(node) {
  if (!node) return null;
  if (node.nodeType === 1) return node;
  return node.parentElement || null;
}

function findAssistantSelectableContainer(node) {
  const element = getSelectionNodeElement(node);
  return element?.closest?.(".assistant-selectable-message") || null;
}

function isEditableInteractionTarget(node) {
  const element = getSelectionNodeElement(node);
  return Boolean(
    element?.closest?.('textarea, input, select, [contenteditable="true"], [contenteditable=""], .chat-input-wrapper')
  );
}

function CodeBlock({ text, lang, blockKey, onCopySuccess }) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(String(text || ""));
      setCopied(true);
      if (typeof onCopySuccess === "function") onCopySuccess();
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copyTimerRef.current = null;
      }, 1600);
    } catch {}
  };

  const cls = lang ? `language-${lang}` : undefined;
  const languageLabel = String(lang || "code").trim().toLowerCase() || "code";

  return (
    <div className="md-code-wrap">
      <div className="md-code-toolbar">
        <div className="md-code-toolbar__lang">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
            className="md-code-toolbar__lang-icon"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5"
            />
          </svg>
          <span>{languageLabel}</span>
        </div>
        <button
          type="button"
          className="md-code-toolbar__copy"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={handleCopy}
          aria-label={copied ? "Copied code" : "Copy code"}
          title={copied ? "Copied" : "Copy"}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
          </svg>
        </button>
      </div>
      <pre>
        <code className={`md-code-block ${cls || ""}`.trim()}>
          {renderHighlightedCode(text, lang, blockKey)}
        </code>
      </pre>
    </div>
  );
}

function stripSourcesSection(md) {
  const text = String(md || "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const out = [];

  let inCode = false;
  let skipping = false;

  const isSourcesHeader = (line) => {
    const t = String(line || "").trim().toLowerCase();
    if (!t) return false;
    const hasWord =
      t.includes("fontes") || t.includes("sources") || t.includes("references") || t.includes("referências");

    const isHeading = /^#{1,6}\s+/.test(t);
    const isBoldTitle = /^\*\*.*\*\*$/.test(t) || t.startsWith("**") || t.includes("**fontes") || t.includes("**sources");

    // Also catch common emoji title like "📚 Fontes"
    const isEmojiTitle = /^[^\w\s]{0,2}[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(t);

    return hasWord && (isHeading || isBoldTitle || isEmojiTitle);
  };

  const isSourcesLine = (line) => {
    const t = String(line || "").trim();
    if (!t) return true; // allow blank lines inside the section
    if (/^[-*•]\s+/.test(t)) return true;
    if (/^\d+\.\s+/.test(t)) return true;
    if (t.includes("http://") || t.includes("https://")) return true;
    return false;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = String(line || "").trim();

    if (trimmed.startsWith("```")) {
      inCode = !inCode;
      if (!skipping) out.push(line);
      continue;
    }

    if (!inCode && !skipping && isSourcesHeader(line)) {
      skipping = true;
      continue;
    }

    if (skipping) {
      if (!inCode && isSourcesLine(line)) continue;
      skipping = false;
      // fallthrough: include this line if it's not part of sources
    }

    out.push(line);
  }

  return out.join("\n").trimEnd();
}

function buildSourcesSection(sources, language) {
  const list = Array.isArray(sources) ? sources : [];
  if (list.length === 0) return "";

  const title = language === "pt" ? "**📚 Fontes**" : "**📚 Sources**";

  const items = list
    .map((s) => String(s?.url || "").trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((url) => {
      try {
        const host = new URL(url).hostname.replace(/^www\./, "");
        return `- [${host}](${url})`;
      } catch {
        return `- ${url}`;
      }
    });

  if (items.length === 0) return "";
  return `${title}\n\n${items.join("\n")}`;
}

function looksLikeMath(md) {
  const s = String(md || "");
  if (!s) return false;
  if (s.includes("$$")) return true;
  if (s.includes("\\(") || s.includes("\\[") || s.includes("\\)") || s.includes("\\]"))
    return true;
  return /\\(frac|sum|int|sqrt|begin|end|cdot|times|left|right|mathcal|mathbf|mathrm|text|alpha|beta|gamma|theta|pi|sigma|Omega)\b/.test(
    s
  );
}

const CODE_LANG_ALIASES = {
  js: "javascript",
  jsx: "javascript",
  ts: "javascript",
  tsx: "javascript",
  node: "javascript",
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  html: "html",
  xml: "html",
  svg: "html",
  css: "css",
  scss: "css",
  sass: "css",
  less: "css",
  jsonc: "json",
  yml: "yaml",
};

const JS_KEYWORDS =
  /\b(?:const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|class|new|import|from|export|default|try|catch|finally|throw|async|await|typeof|instanceof|null|undefined|this|extends|super|yield|in|of)\b/y;
const JS_BUILTINS =
  /\b(?:console|document|window|Array|Object|String|Number|Boolean|Promise|Map|Set|Date|Math|JSON)\b/y;
const PY_KEYWORDS =
  /\b(?:def|return|if|elif|else|for|while|break|continue|class|import|from|as|try|except|finally|raise|lambda|yield|with|pass|in|is|and|or|not|None|True|False)\b/y;
const BASH_KEYWORDS =
  /\b(?:if|then|else|fi|for|in|do|done|case|esac|function|while|until|select|echo|exit)\b/y;

function pushCodeToken(tokens, type, text) {
  if (!text) return;
  const prev = tokens[tokens.length - 1];
  if (prev && prev.type === type) {
    prev.text += text;
    return;
  }
  tokens.push({ type, text });
}

function tokenizeWithPatterns(code, patterns) {
  const text = String(code || "");
  const tokens = [];
  let i = 0;

  while (i < text.length) {
    let matched = false;

    for (const pattern of patterns) {
      pattern.regex.lastIndex = i;
      const match = pattern.regex.exec(text);
      if (!match) continue;

      pushCodeToken(tokens, pattern.type, match[0]);
      i = pattern.regex.lastIndex;
      matched = true;
      break;
    }

    if (!matched) {
      pushCodeToken(tokens, null, text[i]);
      i += 1;
    }
  }

  return tokens;
}

function tokenizeHtml(code) {
  const text = String(code || "");
  const tokens = [];
  let i = 0;

  while (i < text.length) {
    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      const slice = end === -1 ? text.slice(i) : text.slice(i, end + 3);
      pushCodeToken(tokens, "comment", slice);
      i += slice.length;
      continue;
    }

    if (text[i] === "<") {
      const end = text.indexOf(">", i + 1);
      if (end === -1) {
        pushCodeToken(tokens, null, text.slice(i));
        break;
      }

      const tag = text.slice(i, end + 1);
      const tagMatch = tag.match(/^<\/?\s*([A-Za-z][\w:-]*)/);

      pushCodeToken(tokens, "punctuation", "<");
      let cursor = 1;

      if (tag[cursor] === "/") {
        pushCodeToken(tokens, "punctuation", "/");
        cursor += 1;
      }

      while (tag[cursor] === " ") {
        pushCodeToken(tokens, null, tag[cursor]);
        cursor += 1;
      }

      if (tagMatch?.[1]) {
        pushCodeToken(tokens, "tag", tagMatch[1]);
        cursor = tag.indexOf(tagMatch[1], cursor) + tagMatch[1].length;
      }

      const attrText = tag.slice(cursor, -1);
      const attrPatterns = [
        { type: "string", regex: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y },
        { type: "attr", regex: /\b[A-Za-z_:][-A-Za-z0-9_:.]*(?=\s*=)/y },
        { type: "operator", regex: /=/y },
        { type: "punctuation", regex: /\/$/y },
      ];
      const attrTokens = tokenizeWithPatterns(attrText, attrPatterns);
      attrTokens.forEach((token) => pushCodeToken(tokens, token.type, token.text));

      if (tag.endsWith("/>")) {
        pushCodeToken(tokens, "punctuation", "/");
      }
      pushCodeToken(tokens, "punctuation", ">");
      i = end + 1;
      continue;
    }

    pushCodeToken(tokens, null, text[i]);
    i += 1;
  }

  return tokens;
}

function getCodePatterns(lang) {
  if (lang === "javascript") {
    return [
      { type: "comment", regex: /\/\*[\s\S]*?\*\/|\/\/[^\n]*/y },
      { type: "string", regex: /`(?:\\[\s\S]|[^`])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y },
      { type: "keyword", regex: JS_KEYWORDS },
      { type: "builtin", regex: JS_BUILTINS },
      { type: "number", regex: /\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?)\b/y },
      { type: "boolean", regex: /\b(?:true|false)\b/y },
      { type: "property", regex: /\b[A-Za-z_$][\w$]*(?=\s*:)/y },
      { type: "variable", regex: /\b[A-Za-z_$][\w$]*(?=\s*=)/y },
      { type: "function", regex: /\b[A-Za-z_$][\w$]*(?=\s*\()/y },
      { type: "operator", regex: /=>|===|!==|==|!=|<=|>=|\+\+|--|&&|\|\||[+\-*/%=&|<>!?:]+/y },
      { type: "punctuation", regex: /[{}[\]();,.]/y },
    ];
  }

  if (lang === "python") {
    return [
      { type: "comment", regex: /#[^\n]*/y },
      { type: "string", regex: /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y },
      { type: "decorator", regex: /@[A-Za-z_][\w.]*/y },
      { type: "keyword", regex: PY_KEYWORDS },
      { type: "number", regex: /\b\d+(?:\.\d+)?\b/y },
      { type: "boolean", regex: /\b(?:True|False|None)\b/y },
      { type: "function", regex: /\b[A-Za-z_]\w*(?=\s*\()/y },
      { type: "operator", regex: /\*\*|\/\/|==|!=|<=|>=|[+\-*/%=&|<>:]+/y },
      { type: "punctuation", regex: /[()[\]{},.]/y },
    ];
  }

  if (lang === "bash") {
    return [
      { type: "comment", regex: /#[^\n]*/y },
      { type: "string", regex: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y },
      { type: "variable", regex: /\$\{[^}]+\}|\$[A-Za-z_][\w]*/y },
      { type: "keyword", regex: BASH_KEYWORDS },
      { type: "number", regex: /\b\d+\b/y },
      { type: "operator", regex: /\|\||&&|[|<>]=?|[=:+\-*/]+/y },
      { type: "function", regex: /\b[A-Za-z_][\w-]*(?=\s)/y },
      { type: "punctuation", regex: /[()[\]{};]/y },
    ];
  }

  if (lang === "css") {
    return [
      { type: "comment", regex: /\/\*[\s\S]*?\*\//y },
      { type: "string", regex: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y },
      { type: "atrule", regex: /@[A-Za-z-]+\b/y },
      { type: "selector", regex: /(?:^|(?<=\n)|(?<=\}))[ \t]*[^@\s][^{\n]*(?=\s*\{)/y },
      { type: "property", regex: /\b[A-Za-z-]+(?=\s*:)/y },
      { type: "number", regex: /#[\da-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|ms|s|deg)?\b/y },
      { type: "function", regex: /\b[A-Za-z-]+(?=\s*\()/y },
      { type: "operator", regex: /[:>~+,]/y },
      { type: "punctuation", regex: /[{}();.]/y },
    ];
  }

  if (lang === "json" || lang === "yaml") {
    return [
      { type: "comment", regex: /#[^\n]*/y },
      { type: "attr", regex: /"(?:\\.|[^"\\])*"(?=\s*:)|\b[A-Za-z0-9_-]+(?=\s*:)/y },
      { type: "string", regex: /"(?:\\.|[^"\\])*"/y },
      { type: "boolean", regex: /\b(?:true|false|null|yes|no)\b/y },
      { type: "number", regex: /\b-?\d+(?:\.\d+)?\b/y },
      { type: "operator", regex: /:/y },
      { type: "punctuation", regex: /[{}\[\],-]/y },
    ];
  }

  return [
    { type: "comment", regex: /\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*/y },
    { type: "string", regex: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\[\s\S]|[^`])*`/y },
    { type: "number", regex: /\b\d+(?:\.\d+)?\b/y },
    { type: "function", regex: /\b[A-Za-z_]\w*(?=\s*\()/y },
    { type: "operator", regex: /==|!=|<=|>=|=>|[+\-*/%=&|<>:]+/y },
    { type: "punctuation", regex: /[{}[\]();,.]/y },
  ];
}

function normalizeCodeLang(lang) {
  const raw = String(lang || "").trim().toLowerCase();
  if (!raw) return "";
  return CODE_LANG_ALIASES[raw] || raw;
}

function tokenizeCode(code, lang) {
  const normalized = normalizeCodeLang(lang);
  if (normalized === "html") return tokenizeHtml(code);
  return tokenizeWithPatterns(code, getCodePatterns(normalized));
}

function renderHighlightedCode(code, lang, keyPrefix) {
  const tokens = tokenizeCode(code, lang);
  return tokens.map((token, idx) =>
    token.type ? (
      <span key={`${keyPrefix}_${idx}`} className={`md-code-token md-code-${token.type}`}>
        {token.text}
      </span>
    ) : (
      <span key={`${keyPrefix}_${idx}`}>{token.text}</span>
    )
  );
}

function MarkdownMessage({ content, onCopyCode }) {
  const rootRef = useRef(null);
  const mathTimerRef = useRef(null);
  const mathTypesettingRef = useRef(false);
  const mathNeedsRerunRef = useRef(false);
  const mathUnmountedRef = useRef(false);
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);

  useEffect(() => {
    return () => {
      mathUnmountedRef.current = true;
      clearTimeout(mathTimerRef.current);
    };
  }, []);

  useEffect(() => {
    clearTimeout(mathTimerRef.current);
    if (!looksLikeMath(content)) return;

    const el = rootRef.current;
    if (!el) return;

    let tries = 0;

    const schedule = (delay = 80) => {
      clearTimeout(mathTimerRef.current);
      mathTimerRef.current = setTimeout(attempt, delay);
    };

    const attempt = () => {
      if (mathUnmountedRef.current) return;

      const mj = window.MathJax;
      if (!mj) {
        if (tries < 16) {
          tries += 1;
          schedule(120);
        }
        return;
      }

      if (mathTypesettingRef.current) {
        mathNeedsRerunRef.current = true;
        return;
      }

      mathTypesettingRef.current = true;

      const run = async () => {
        if (typeof mj.typesetClear === "function") {
          try {
            mj.typesetClear([el]);
          } catch {}
        }

        if (typeof mj.typesetPromise === "function") {
          await mj.typesetPromise([el]);
        }
      };

      const p = mj.startup?.promise ? Promise.resolve(mj.startup.promise).then(run) : run();
      Promise.resolve(p)
        .catch(() => {})
        .finally(() => {
          mathTypesettingRef.current = false;
          if (!mathUnmountedRef.current && mathNeedsRerunRef.current) {
            mathNeedsRerunRef.current = false;
            schedule(32);
          }
        });
    };

    mathUnmountedRef.current = false;
    mathNeedsRerunRef.current = true;
    schedule(60);

    return () => {
      clearTimeout(mathTimerRef.current);
    };
  }, [content]);

  const renderLinesWithBreaks = (lines, keyPrefix) => renderInline(lines.join("\n"), keyPrefix);

  return (
    <div className="md" ref={rootRef}>
      {blocks.map((b, idx) => {
        const key = `md_${idx}`;
        if (b.type === "hr") return <hr key={key} />;
        if (b.type === "heading") {
          const Tag = b.level === 1 ? "h1" : b.level === 2 ? "h2" : "h3";
          return <Tag key={key}>{renderInline(b.text, key)}</Tag>;
        }
        if (b.type === "blockquote") {
          return <blockquote key={key}>{renderLinesWithBreaks(b.lines, key)}</blockquote>;
        }
        if (b.type === "code") {
          return (
            <CodeBlock
              key={key}
              text={b.text}
              lang={b.lang}
              blockKey={key}
              onCopySuccess={onCopyCode}
            />
          );
        }
        if (b.type === "plain") {
          return (
            <pre key={key} className="md-plain-pre">
              <code className="md-plain-block">{b.text}</code>
            </pre>
          );
        }
        if (b.type === "list") {
          const Tag = b.ordered ? "ol" : "ul";
          return (
            <Tag key={key}>
              {b.items.map((it, j) => (
                <li key={`${key}_${j}`}>{renderInline(it, `${key}_${j}`)}</li>
              ))}
            </Tag>
          );
        }
        if (b.type === "table") {
          const cols = Math.max(b.header.length, ...b.rows.map((r) => r.length));
          const norm = (row) => Array.from({ length: cols }, (_, c) => row[c] || "");
          return (
            <div key={key} className="md-table-wrap">
              <table>
                <thead>
                  <tr>
                    {norm(b.header).map((c, j) => (
                      <th key={`${key}_h_${j}`}>{renderInline(c, `${key}_h_${j}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, ri) => (
                    <tr key={`${key}_r_${ri}`}>
                      {norm(r).map((c, ci) => (
                        <td key={`${key}_r_${ri}_c_${ci}`}>{renderInline(c, `${key}_${ri}_${ci}`)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        // paragraph
        return <p key={key}>{renderLinesWithBreaks(b.lines, key)}</p>;
      })}
    </div>
  );
}
const DEFAULT_CONVERSATION_TITLE = "New chat";

function normalizeUserPlanLabel(plan) {
  const raw = String(plan || "").trim();
  if (!raw) return "FREE";
  const s = raw.toLowerCase();
  if (s === "plus") return "PREMIUM";
  if (s === "free") return "FREE";
  if (s === "pro") return "PRO";
  if (s === "premium") return "PREMIUM";
  if (s === "max") return "MAX";
  if (s.includes("plus")) return "PREMIUM";
  if (s.includes("premium")) return "PREMIUM";
  if (s.includes("max")) return "MAX";
  if (s.includes("pro")) return "PRO";
  if (s.includes("free")) return "FREE";
  return raw.toUpperCase();
}

function getMessageAttachmentLimitForPlan(plan) {
  const normalizedPlan = normalizeUserPlanLabel(plan);
  return normalizedPlan === "FREE" ? 2 : 10;
}

function getChatModelDefinition(modelId) {
  const normalized = normalizeChatModelId(modelId);
  return MODELS.find((model) => model.id === normalized) || null;
}

function getChatModelName(modelId) {
  return getChatModelDefinition(modelId)?.name || String(modelId || "this model").trim() || "this model";
}

function isChatModelAllowedForPlan(plan, modelId) {
  const normalizedPlan = normalizeUserPlanLabel(plan);
  if (normalizedPlan !== "FREE") return true;

  const normalizedModelId = normalizeChatModelId(modelId) || DEFAULT_MODEL;
  return FREE_ALLOWED_CHAT_MODEL_IDS.has(normalizedModelId);
}

function shouldShowFreeModelBadge(modelId) {
  const normalizedModelId = normalizeChatModelId(modelId);
  return FREE_PLAN_BADGE_MODEL_IDS.has(normalizedModelId);
}

function isModelPlanUpgradeMessage(message) {
  return String(message?.errorCode || "").trim() === "MODEL_NOT_ALLOWED_FOR_PLAN";
}

function isMessageLimitUpgradeMessage(message) {
  return String(message?.errorCode || "").trim() === "PLAN_MESSAGE_LIMIT_REACHED";
}

function extractModelPlanUpgradeErrorMeta(error, fallback = {}) {
  const raw = String(error?.message || "");
  if (!raw.includes("MODEL_NOT_ALLOWED_FOR_PLAN")) return null;

  let parsed = null;
  const httpPayloadMatch = raw.match(/AI_HTTP_\d+:\s*(\{[\s\S]*\})$/);
  if (httpPayloadMatch?.[1]) {
    try {
      parsed = JSON.parse(httpPayloadMatch[1]);
    } catch {}
  }

  const modelId =
    normalizeChatModelId(
      error?.details?.modelId ||
        parsed?.modelId ||
        parsed?.details?.modelId ||
        fallback.modelId
    ) || DEFAULT_MODEL;

  const plan = normalizeUserPlanLabel(
    error?.details?.plan ||
      parsed?.plan ||
      parsed?.details?.plan ||
      fallback.plan
  );

  return { modelId, plan };
}

function extractMessageLimitErrorMeta(error, fallback = {}) {
  const raw = String(error?.message || "");
  if (!raw.includes("PLAN_MESSAGE_LIMIT_REACHED")) return null;

  let parsed = null;
  const httpPayloadMatch = raw.match(/AI_HTTP_\d+:\s*(\{[\s\S]*\})$/);
  if (httpPayloadMatch?.[1]) {
    try {
      parsed = JSON.parse(httpPayloadMatch[1]);
    } catch {}
  }

  const plan = normalizeUserPlanLabel(
    error?.details?.plan ||
      parsed?.plan ||
      parsed?.details?.plan ||
      fallback.plan
  );
  const limit = Number(
    error?.details?.limit ??
      parsed?.limit ??
      parsed?.details?.limit ??
      fallback.limit ??
      (plan === "FREE" ? 20 : 0)
  );
  const used = Number(
    error?.details?.used ??
      parsed?.used ??
      parsed?.details?.used ??
      fallback.used ??
      0
  );
  const rawWindow =
    error?.details?.limitWindow ||
    parsed?.limitWindow ||
    parsed?.details?.limitWindow ||
    fallback.limitWindow ||
    (plan === "FREE" ? "day" : "month");
  const limitWindow = String(rawWindow || "").trim().toLowerCase() === "day" ? "day" : "month";
  const periodEnd =
    error?.details?.periodEnd ||
    parsed?.periodEnd ||
    parsed?.details?.periodEnd ||
    fallback.periodEnd ||
    null;

  return {
    plan,
    limit,
    used,
    limitWindow,
    periodEnd,
  };
}

function extractCreativeLimitErrorMeta(error, fallback = {}) {
  const raw = String(error?.message || "");
  if (!raw.includes("PLAN_CREATIVE_LIMIT_REACHED")) return null;

  let parsed = null;
  const httpPayloadMatch = raw.match(/AI_HTTP_\d+:\s*(\{[\s\S]*\})$/);
  if (httpPayloadMatch?.[1]) {
    try {
      parsed = JSON.parse(httpPayloadMatch[1]);
    } catch {}
  }

  const plan = normalizeUserPlanLabel(
    error?.details?.plan ||
      parsed?.plan ||
      parsed?.details?.plan ||
      fallback.plan
  );
  const limit = Number(
    error?.details?.limit ??
      parsed?.limit ??
      parsed?.details?.limit ??
      fallback.limit ??
      0
  );
  const used = Number(
    error?.details?.used ??
      parsed?.used ??
      parsed?.details?.used ??
      fallback.used ??
      0
  );

  return { plan, limit, used };
}

function extractAttachmentLimitErrorMeta(error, fallback = {}) {
  const raw = String(error?.message || "");
  if (!raw.includes("ATTACHMENTS_PER_MESSAGE_LIMIT_REACHED")) return null;

  let parsed = null;
  const httpPayloadMatch = raw.match(/AI_HTTP_\d+:\s*(\{[\s\S]*\})$/);
  if (httpPayloadMatch?.[1]) {
    try {
      parsed = JSON.parse(httpPayloadMatch[1]);
    } catch {}
  }

  const plan = normalizeUserPlanLabel(
    error?.details?.plan ||
      parsed?.plan ||
      parsed?.details?.plan ||
      fallback.plan
  );
  const limit = Number(
    error?.details?.limit ??
      parsed?.limit ??
      parsed?.details?.limit ??
      fallback.limit ??
      getMessageAttachmentLimitForPlan(plan)
  );
  const requested = Number(
    error?.details?.requested ??
      parsed?.requested ??
      parsed?.details?.requested ??
      fallback.requested ??
      0
  );

  return {
    plan,
    limit,
    requested,
  };
}

function buildModelPlanUpgradeMessage({ plan, modelId }) {
  const normalizedModelId = normalizeChatModelId(modelId) || DEFAULT_MODEL;
  return {
    role: "assistant",
    content: "",
    errorCode: "MODEL_NOT_ALLOWED_FOR_PLAN",
    errorMeta: {
      plan: normalizeUserPlanLabel(plan),
      modelId: normalizedModelId,
      modelName: getChatModelName(normalizedModelId),
    },
  };
}

function buildMessageLimitUpgradeCopy({ plan, limit, limitWindow }) {
  const planLabel = normalizeUserPlanLabel(plan);
  const windowLabel = limitWindow === "day" ? "daily" : "monthly";
  const safeLimit = Number(limit);

  const title =
    Number.isFinite(safeLimit) && safeLimit > 0
      ? `You've reached the ${safeLimit}-message ${windowLabel} limit on the ${planLabel} plan.`
      : `You've reached the ${windowLabel} message limit on the ${planLabel} plan.`;

  const body =
    limitWindow === "day"
      ? "Upgrade your plan to keep this conversation going today, or wait for your daily limit to reset."
      : "Upgrade your plan to keep this conversation going, or wait for your monthly limit to reset.";

  return { title, body };
}

function buildMessageLimitUpgradeMessage({ plan, limit, limitWindow = "day", periodEnd = null }) {
  return {
    role: "assistant",
    content: "",
    errorCode: "PLAN_MESSAGE_LIMIT_REACHED",
    errorMeta: {
      plan: normalizeUserPlanLabel(plan),
      limit: Number(limit) || 0,
      limitWindow: limitWindow === "day" ? "day" : "month",
      periodEnd: periodEnd || null,
    },
  };
}

function buildCreativeLimitUpgradeCopy({ plan, limit }) {
  const planLabel = normalizeUserPlanLabel(plan);
  const safeLimit = Number(limit);

  const title =
    Number.isFinite(safeLimit) && safeLimit > 0
      ? `You've reached the ${safeLimit}-generation monthly limit on the ${planLabel} plan.`
      : `You've reached the monthly Creative Studio limit on the ${planLabel} plan.`;

  const body =
    "Upgrade your plan to keep creating this month, or wait for your monthly Creative Studio limit to reset.";

  return { title, body };
}

function buildCreativeLimitUpgradeMessage({ plan, limit }) {
  return {
    role: "assistant",
    content: "",
    errorCode: "PLAN_CREATIVE_LIMIT_REACHED",
    errorMeta: {
      plan: normalizeUserPlanLabel(plan),
      limit: Number(limit) || 0,
    },
  };
}

function PlanUpgradeMessage({ title, body, onOpenPlan }) {
  return (
    <div className="plan-upgrade-message" role="alert">
      <div className="plan-upgrade-message__eyebrow">Upgrade required</div>
      <div className="plan-upgrade-message__title">{title}</div>
      <p className="plan-upgrade-message__body">{body}</p>
      <button type="button" className="plan-upgrade-message__button" onClick={onOpenPlan}>
        See plans
      </button>
    </div>
  );
}

const isDefaultConversationTitle = (title) => {
  const s = String(title || "")
    .trim()
    .toLowerCase();
  return s === "new chat" || s === "novo chat";
};

const createEmptyConversation = (mode = "chat", modelId = DEFAULT_MODEL) => ({
  id: Date.now() + Math.random(),
  title: DEFAULT_CONVERSATION_TITLE,
  messages: [],
  messageCount: 0,
  pinned: false,
  pinnedAt: 0,
  updatedAt: Date.now(),
  mode, // x "chat" | "creative_studio"
  modelId,
});

function computeStreamingRevealStep(deltaMs, backlog) {
  const elapsed = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 16;
  const backlogSize = Number.isFinite(backlog) && backlog > 0 ? backlog : 1;
  const timeBased = Math.ceil((elapsed / 1000) * 180);
  const catchUp = Math.ceil(backlogSize / 18);
  return Math.max(1, Math.min(42, Math.max(timeBased, catchUp)));
}

function createStreamingTextAnimator({ onRender }) {
  let target = "";
  let shown = "";
  let rafId = 0;
  let lastTs = 0;
  let stopped = false;

  const cancelFrame = () => {
    if (!rafId || typeof window === "undefined") return;
    window.cancelAnimationFrame(rafId);
    rafId = 0;
  };

  const render = (text, final = false) => {
    if (typeof onRender === "function") onRender(text, final);
  };

  const tick = (ts) => {
    rafId = 0;
    if (stopped) return;

    if (!lastTs) lastTs = ts;
    const backlog = target.length - shown.length;
    if (backlog <= 0) return;

    const step = computeStreamingRevealStep(ts - lastTs, backlog);
    lastTs = ts;
    shown = target.slice(0, Math.min(target.length, shown.length + step));
    render(shown, false);

    if (shown.length < target.length && typeof window !== "undefined") {
      rafId = window.requestAnimationFrame(tick);
    }
  };

  const ensureTick = () => {
    if (stopped) return;
    if (typeof window === "undefined") {
      shown = target;
      render(shown, false);
      return;
    }
    if (!rafId) rafId = window.requestAnimationFrame(tick);
  };

  return {
    push(chunk) {
      if (stopped || !chunk) return;
      target += String(chunk);
      ensureTick();
    },
    flush(finalText) {
      if (stopped) return;
      if (typeof finalText === "string") target = finalText;
      shown = target;
      lastTs = 0;
      cancelFrame();
      render(shown, true);
    },
    stop() {
      stopped = true;
      lastTs = 0;
      cancelFrame();
    },
  };
}

function formatProjectUpdatedTime(timestamp) {
  if (!timestamp) return "Updated just now";

  const diffMs = Date.now() - new Date(timestamp).getTime();
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));

  if (diffMinutes < 60) return `Updated ${diffMinutes} min ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `Updated ${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;

  const diffDays = Math.round(diffHours / 24);
  return `Updated ${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

function AppShell() {
const { user, accessToken, authReady, openAuth, logout, completeMagicLink, setUser } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
  const userAvatarStyle = useMemo(() => {
    const palette = [
      { bg: "#174ea6", border: "rgba(23, 78, 166, 0.30)" },  // dark google blue
      { bg: "#c5221f", border: "rgba(197, 34, 31, 0.28)" },  // dark google red
      { bg: "#b06000", border: "rgba(176, 96, 0, 0.30)" },   // dark amber
      { bg: "#137333", border: "rgba(19, 115, 51, 0.28)" },  // dark google green
      { bg: "#8430ce", border: "rgba(132, 48, 206, 0.28)" }, // dark google purple
      { bg: "#b06000", border: "rgba(176, 96, 0, 0.30)" },   // dark orange
      { bg: "#007b83", border: "rgba(0, 123, 131, 0.28)" },  // dark cyan
      { bg: "#3c4043", border: "rgba(60, 64, 67, 0.30)" },   // dark grey
    ];
    const seed = String(user?.email || user?.name || "coreai-user").trim().toLowerCase() || "coreai-user";
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash * 53 + seed.charCodeAt(i) + 7) | 0;
    }
    const tone = palette[(Math.abs(hash) + 6) % palette.length];
    return {
      "--user-avatar-bg": tone.bg,
      "--user-avatar-border": tone.border,
    };
  }, [user]);
  const userInitial = useMemo(() => {
    const src = user?.name || user?.email || "";
    return src ? src.trim().charAt(0).toUpperCase() : "?";
  }, [user]);
  const userDisplayName = useMemo(() => {
    return user?.name || user?.email || "User";
  }, [user]);
  const userPlanLabel = useMemo(() => {
    return normalizeUserPlanLabel(user?.plan);
  }, [user]);
  const messageAttachmentLimit = useMemo(
    () => getMessageAttachmentLimitForPlan(userPlanLabel),
    [userPlanLabel]
  );
  const refreshCreativeCreditsSummary = useCallback(async () => {
    if (!authReady || !user || !accessToken) {
      setCreativeCreditsSummary(null);
      return null;
    }

    try {
      const res = await api.get("/plans/me");
      const nextPlan = typeof res?.data?.plan === "string" ? res.data.plan : null;
      if (nextPlan && nextPlan !== user?.plan) {
        setUser((prev) => (prev ? { ...prev, plan: nextPlan } : prev));
      }
      const nextSummary = normalizeCreativeCredits(res?.data || null);
      setCreativeCreditsSummary(nextSummary);
      writeCachedCreativeCredits(user?.id, nextSummary);
      return nextSummary;
    } catch {
      return null;
    }
  }, [authReady, user, accessToken, setUser]);

  useEffect(() => {
    setCreativeCreditsSummary(readCachedCreativeCredits(user?.id));
  }, [user?.id]);

  useEffect(() => {
    void refreshCreativeCreditsSummary();
  }, [refreshCreativeCreditsSummary]);
  // x FIX Safari iPad  viewport real quando o teclado abre/fecha
  useEffect(() => {
    const root = document.documentElement;
    let rafId = 0;
    const apply = () => {
      rafId = 0;
      syncIOSKeyboardViewport();
    };

    const schedule = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(apply);
    };

    schedule();

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", schedule);
      vv.addEventListener("scroll", schedule);
    }
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);

    return () => {
      root.classList.remove("mobile-keyboard-open");
      root.style.removeProperty("--mobile-keyboard-offset");
      clearKeyboardViewportPoll();
      if (vv) {
        vv.removeEventListener("resize", schedule);
        vv.removeEventListener("scroll", schedule);
      }
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, []);

  // Layout tipo app: sem scroll global (deixa scroll apenas nas Ã¡reas internas).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;

    if (typeof window === "undefined" || !window.matchMedia) return;

    const isIOS =
      (() => {
        const ua = navigator.userAgent || "";
        const platform = navigator.platform || "";
        return (
          /iPad|iPhone|iPod/.test(ua) ||
          (platform === "MacIntel" && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1)
        );
      })() || false;

    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    const isIOSSafari =
      isIOS &&
      /Safari/i.test(ua) &&
      !/(CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA|DuckDuckGo|YaBrowser)/i.test(ua);
    const maxTouchPoints =
      typeof navigator.maxTouchPoints === "number" ? navigator.maxTouchPoints : 0;
    const isMacDesktopBrowser =
      !isIOS &&
      maxTouchPoints <= 1 &&
      (/Mac/i.test(platform) || /Macintosh|Mac OS X/i.test(ua));
    root.classList.toggle("ios-safari", isIOSSafari);
    root.classList.toggle("mac-desktop-browser", isMacDesktopBrowser);

    const mqMobile = window.matchMedia("(max-width: 720px)");
    // iPad landscape can reach desktop-like widths, so keep the app-shell rules
    // active through the common tablet range without touching desktop browsers.
    const mqTablet = window.matchMedia("(max-width: 1366px)");

    const apply = () => {
      const isShare = typeof location?.pathname === "string" && location.pathname.startsWith("/s/");
      const isTabletIOSBrowser = isIOS && mqTablet.matches && !mqMobile.matches;
      const shouldNoScroll = mqMobile.matches || (isIOS && mqTablet.matches);
      root.classList.toggle("ios-tablet-browser", isTabletIOSBrowser);
      if (isShare || !shouldNoScroll) root.classList.remove("app-no-scroll");
      else root.classList.add("app-no-scroll");
    };

    apply();

      try {
        mqMobile.addEventListener("change", apply);
        mqTablet.addEventListener("change", apply);
      return () => {
        root.classList.remove("ios-safari");
        root.classList.remove("ios-tablet-browser");
        root.classList.remove("mac-desktop-browser");
        mqMobile.removeEventListener("change", apply);
        mqTablet.removeEventListener("change", apply);
      };
    } catch {
      mqMobile.addListener(apply);
      mqTablet.addListener(apply);
      return () => {
        root.classList.remove("ios-safari");
        root.classList.remove("ios-tablet-browser");
        root.classList.remove("mac-desktop-browser");
        mqMobile.removeListener(apply);
        mqTablet.removeListener(apply);
      };
    }
  }, [location?.pathname]);

  // ===== Icons (ChatGPT-like, stroke) =====
const IconCopy = ({ className = "", ...p }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`action-copy-icon ${className}`.trim()}
    aria-hidden="true"
    {...p}
  >
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </svg>
);

  const IconEdit = (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" {...p}>
      <path d="M12 20h9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );

  const IconThumbUp = (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" {...p}>
      <path className="feedback-icon__fill" d="M7 11v10H4V11h3z" fill="currentColor" stroke="none" />
      <path
        className="feedback-icon__fill"
        d="M7 11l5-7a2 2 0 0 1 2 2v5h6a2 2 0 0 1 2 2l-2 6a2 2 0 0 1-2 2H7"
        fill="currentColor"
        stroke="none"
      />
      <path d="M7 11v10H4V11h3z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path
        d="M7 11l5-7a2 2 0 0 1 2 2v5h6a2 2 0 0 1 2 2l-2 6a2 2 0 0 1-2 2H7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );

  const IconThumbDown = (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" {...p}>
      <path className="feedback-icon__fill" d="M7 13V3H4v10h3z" fill="currentColor" stroke="none" />
      <path
        className="feedback-icon__fill"
        d="M7 13l5 7a2 2 0 0 0 2-2v-5h6a2 2 0 0 0 2-2l-2-6a2 2 0 0 0-2-2H7"
        fill="currentColor"
        stroke="none"
      />
      <path d="M7 13V3H4v10h3z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path
        d="M7 13l5 7a2 2 0 0 0 2-2v-5h6a2 2 0 0 0 2-2l-2-6a2 2 0 0 0-2-2H7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );

  const IconRetry = (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" {...p}>
      <path
        d="M20 12a8 8 0 1 1-2.3-5.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M20 4v6h-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
const IconTrash = ({ className = "" }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className={className}
    width="16"
    height="16"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
    />
  </svg>
);

const IconFolderPlus = ({ className = "" }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    className={className}
    width="16"
    height="16"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6" />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
    />
  </svg>
);

const IconFolderSync = ({ className = "" }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    className={className}
    width="16"
    height="16"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v.5" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v4h4" />
    <path strokeLinecap="round" strokeLinejoin="round" d="m12 14 1.535-1.605a5 5 0 0 1 8 1.5" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M22 22v-4h-4" />
    <path strokeLinecap="round" strokeLinejoin="round" d="m22 18-1.535 1.605a5 5 0 0 1-8-1.5" />
  </svg>
);

const IconFolderX = ({ className = "" }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    className={className}
    width="16"
    height="16"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
    />
    <path strokeLinecap="round" strokeLinejoin="round" d="m9.5 10.5 5 5" />
    <path strokeLinecap="round" strokeLinejoin="round" d="m14.5 10.5-5 5" />
  </svg>
);


const handleTogglePinChat = async (id) => {
  const current = conversations.find((c) => c.id === id);
  if (!current) return;

  const nextPinned = !current.pinned;
  const prevPinnedAt = current.pinnedAt || 0;

  // Optimistic UI (works for guest + logged-in).
  setConversations((prev) =>
    prev.map((c) =>
      c.id === id
        ? { ...c, pinned: nextPinned, pinnedAt: nextPinned ? Date.now() : 0 }
        : c
    )
  );

  // Persist pin only for backend conversations when authed.
  if (!user || !accessToken) return;
  if (typeof id !== "string") return;

  try {
    const out = await authedRequest(`/conversations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ pinned: nextPinned }),
    });

    const c = out?.conversation;
    if (!c) return;

    setConversations((prev) =>
      prev.map((x) =>
        x.id === id
          ? {
              ...x,
              pinned: !!c.pinned,
              pinnedAt: c.pinnedAt ? Date.parse(c.pinnedAt) : 0,
            }
          : x
      )
    );
  } catch (e) {
    // Revert on failure (avoids phantom pins).
    setConversations((prev) =>
      prev.map((x) =>
        x.id === id
          ? {
              ...x,
              pinned: !nextPinned,
              pinnedAt: prevPinnedAt,
            }
          : x
      )
    );
    console.error("Erro a afixar/desafixar conversa no backend:", e);
    showGlobalToast("Ocorreu um erro. Tenta novamente.");
  }
};

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 720px)").matches;
  });

  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 720px)").matches;
  });
  const hasCoarsePointer =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    (window.matchMedia("(pointer: coarse)").matches ||
      window.matchMedia("(any-pointer: coarse)").matches ||
      (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0));
  const isTabletViewport =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(min-width: 721px) and (max-width: 1366px)").matches &&
    hasCoarsePointer;
  const shouldSubmitOnEnter = !isMobile && !isTabletViewport;

  const getIOSBrowserFlags = () => {
    if (typeof navigator === "undefined") {
      return { isiOS: false, isIOSSafari: false, isIOSAltBrowser: false };
    }

    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    const isiOS =
      /iPad|iPhone|iPod/.test(ua) ||
      (ua.includes("Mac") &&
        platform === "MacIntel" &&
        typeof navigator.maxTouchPoints === "number" &&
        navigator.maxTouchPoints > 1);
    const isIOSSafari =
      isiOS &&
      /Safari/i.test(ua) &&
      !/(CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA|DuckDuckGo|YaBrowser)/i.test(ua);

    return {
      isiOS,
      isIOSSafari,
      isIOSAltBrowser: isiOS && !isIOSSafari,
    };
  };

  const shouldUseCompactIOSBrowserViewportGuards = () => {
    if (typeof window === "undefined" || !window.matchMedia) return false;

    const { isiOS } = getIOSBrowserFlags();
    if (!isiOS) return false;

    const isTabletBrowser = window.matchMedia("(min-width: 721px) and (max-width: 1366px)").matches;
    return isMobile || isTabletBrowser;
  };

  const clearKeyboardViewportPoll = () => {
    const cleanup = keyboardViewportPollCleanupRef.current;
    keyboardViewportPollCleanupRef.current = null;
    if (typeof cleanup === "function") cleanup();
  };

  const clearKeyboardViewportCloseTimer = () => {
    const timerId = keyboardViewportCloseTimerRef.current;
    keyboardViewportCloseTimerRef.current = null;
    if (timerId) window.clearTimeout(timerId);
  };

  const setKeyboardViewportClosing = (isClosing) => {
    keyboardViewportClosingRef.current = isClosing;
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("mobile-keyboard-closing", isClosing);
  };

  const isComposerTextareaFocused = () => {
    if (typeof document === "undefined") return false;
    const activeEl = document.activeElement;
    return !!activeEl?.classList?.contains("composer-textarea");
  };

  const measureIOSKeyboardInset = () => {
    if (typeof document === "undefined") return;
    if (typeof window === "undefined") return;

    const root = document.documentElement;
    const vv = window.visualViewport;
    const height = vv?.height ?? window.innerHeight;
    root.style.setProperty("--real-vh", `${Math.round(height)}px`);

    const { isiOS } = getIOSBrowserFlags();
    if (!isiOS) {
      root.classList.remove("mobile-keyboard-open");
      root.style.removeProperty("--mobile-keyboard-offset");
      return;
    }

    const offsetTop = vv?.offsetTop ?? 0;
    const orientationKey =
      window.innerWidth > window.innerHeight ? "landscape" : "portrait";
    const candidateBaseline = Math.max(window.innerHeight || 0, height + offsetTop);

    if (orientationKey !== keyboardViewportOrientationRef.current) {
      keyboardViewportOrientationRef.current = orientationKey;
      keyboardViewportBaselineRef.current = candidateBaseline;
    }

    if (
      !keyboardViewportBaselineRef.current ||
      candidateBaseline > keyboardViewportBaselineRef.current - 24
    ) {
      keyboardViewportBaselineRef.current = Math.max(
        keyboardViewportBaselineRef.current,
        candidateBaseline
      );
    }

    const keyboardInset = Math.max(
      0,
      keyboardViewportBaselineRef.current - (height + offsetTop)
    );
    return keyboardInset;
  };

  const syncIOSKeyboardViewport = () => {
    const keyboardInset = measureIOSKeyboardInset();
    if (typeof keyboardInset !== "number") return;

    const root = document.documentElement;
    if (keyboardViewportClosingRef.current) {
      root.style.setProperty("--mobile-keyboard-offset", "0px");
      root.classList.remove("mobile-keyboard-open");
      return;
    }

    root.style.setProperty("--mobile-keyboard-offset", `${Math.round(keyboardInset)}px`);
    root.classList.toggle(
      "mobile-keyboard-open",
      keyboardInset > 160 && isComposerTextareaFocused()
    );
  };

  const queueIOSKeyboardViewportSync = (delays = []) => {
    if (typeof window === "undefined") return;

    clearKeyboardViewportPoll();

    let rafId = window.requestAnimationFrame(() => {
      rafId = 0;
      syncIOSKeyboardViewport();
    });

    const timers = delays.map((delay) =>
      window.setTimeout(() => {
        syncIOSKeyboardViewport();
      }, delay)
    );

    keyboardViewportPollCleanupRef.current = () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      timers.forEach((timerId) => window.clearTimeout(timerId));
    };
  };

  const clearComposerViewportGuard = () => {
    const cleanup = composerViewportGuardCleanupRef.current;
    composerViewportGuardCleanupRef.current = null;
    composerViewportGuardRestoreRef.current = null;
    if (typeof cleanup === "function") cleanup();
  };

  const collapseMobileComposerKeyboard = () => {
    if (typeof document === "undefined") return;

    clearKeyboardViewportCloseTimer();
    clearKeyboardViewportPoll();
    clearComposerViewportGuard();
    setKeyboardViewportClosing(false);

    const root = document.documentElement;
    root.style.setProperty("--mobile-keyboard-offset", "0px");
    root.classList.remove("mobile-keyboard-open");

    textareaRef.current?.blur?.();
  };

  const stabilizeIOSAltComposerViewport = ({ watchViewport = false, restoreChatScroll = true } = {}) => {
    if (!shouldUseCompactIOSBrowserViewportGuards()) return;
    if (typeof window === "undefined") return;
    if (typeof document === "undefined") return;

    const { isiOS } = getIOSBrowserFlags();
    if (!isiOS) return;

    const prevWindowY =
      window.pageYOffset || document.documentElement?.scrollTop || document.body?.scrollTop || 0;
    const prevChatTop =
      restoreChatScroll && chatBodyRef.current ? chatBodyRef.current.scrollTop : null;

    let rafId = 0;
    let timer50 = 0;
    let timer150 = 0;
    let timer320 = 0;
    let timer500 = 0;
    let timer720 = 0;
    let timer960 = 0;

    const restore = () => {
      const currentWindowY =
        window.pageYOffset || document.documentElement?.scrollTop || document.body?.scrollTop || 0;

      if (Math.abs(currentWindowY - prevWindowY) > 1) {
        try {
          window.scrollTo(0, prevWindowY);
        } catch {}
      }

      if (chatBodyRef.current && typeof prevChatTop === "number") {
        chatBodyRef.current.scrollTop = prevChatTop;
      }
    };

    const clearPending = () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
      if (timer50) {
        window.clearTimeout(timer50);
        timer50 = 0;
      }
      if (timer150) {
        window.clearTimeout(timer150);
        timer150 = 0;
      }
      if (timer320) {
        window.clearTimeout(timer320);
        timer320 = 0;
      }
      if (timer500) {
        window.clearTimeout(timer500);
        timer500 = 0;
      }
      if (timer720) {
        window.clearTimeout(timer720);
        timer720 = 0;
      }
      if (timer960) {
        window.clearTimeout(timer960);
        timer960 = 0;
      }
    };

    const scheduleRestore = () => {
      clearPending();
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        restore();
      });
      timer50 = window.setTimeout(() => {
        timer50 = 0;
        restore();
      }, 50);
      timer150 = window.setTimeout(() => {
        timer150 = 0;
        restore();
      }, 150);
      timer320 = window.setTimeout(() => {
        timer320 = 0;
        restore();
      }, 320);
      timer500 = window.setTimeout(() => {
        timer500 = 0;
        restore();
      }, 500);
      timer720 = window.setTimeout(() => {
        timer720 = 0;
        restore();
      }, 720);
      timer960 = window.setTimeout(() => {
        timer960 = 0;
        restore();
      }, 960);
    };

    if (watchViewport) {
      clearComposerViewportGuard();

      const vv = window.visualViewport;
      const handleWindowScroll = () => {
        const currentWindowY =
          window.pageYOffset || document.documentElement?.scrollTop || document.body?.scrollTop || 0;
        if (Math.abs(currentWindowY - prevWindowY) > 1) scheduleRestore();
      };

      vv?.addEventListener("resize", scheduleRestore);
      vv?.addEventListener("scroll", scheduleRestore);
      window.addEventListener("resize", scheduleRestore);
      window.addEventListener("scroll", handleWindowScroll);

      composerViewportGuardCleanupRef.current = () => {
        clearPending();
        vv?.removeEventListener("resize", scheduleRestore);
        vv?.removeEventListener("scroll", scheduleRestore);
        window.removeEventListener("resize", scheduleRestore);
        window.removeEventListener("scroll", handleWindowScroll);
      };
    }

    composerViewportGuardRestoreRef.current = scheduleRestore;
    scheduleRestore();
  };

  const handleComposerChange = (e) => {
    setInput(e.target.value);

    const el = e.target;
    if (el) {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }

    const restoreViewport = composerViewportGuardRestoreRef.current;
    if (typeof restoreViewport === "function") restoreViewport();
  };

  const handleComposerFocus = () => {
    if (!shouldUseCompactIOSBrowserViewportGuards()) return;
    if (typeof window === "undefined") return;
    if (typeof document === "undefined") return;

    const { isiOS } = getIOSBrowserFlags();

    if (!isiOS) return;
    clearKeyboardViewportCloseTimer();
    setKeyboardViewportClosing(false);
    queueIOSKeyboardViewportSync([60, 140, 240, 380, 560, 760]);
    stabilizeIOSAltComposerViewport({ watchViewport: true });
  };

  const handleComposerBlur = () => {
    const { isiOS, isIOSSafari } = getIOSBrowserFlags();
    if (!isiOS) {
      clearKeyboardViewportCloseTimer();
      clearKeyboardViewportPoll();
      clearComposerViewportGuard();
      return;
    }

    const restoreViewport = composerViewportGuardRestoreRef.current;
    if (typeof restoreViewport === "function") restoreViewport();

    if (isIOSSafari && showThread) {
      clearKeyboardViewportCloseTimer();
      clearKeyboardViewportPoll();
      setKeyboardViewportClosing(false);
      if (typeof document !== "undefined") {
        const root = document.documentElement;
        root.style.setProperty("--mobile-keyboard-offset", "0px");
        root.classList.remove("mobile-keyboard-open");
      }
      clearComposerViewportGuard();
      return;
    }

    clearKeyboardViewportCloseTimer();
    setKeyboardViewportClosing(true);
    syncIOSKeyboardViewport();
    queueIOSKeyboardViewportSync([80, 180, 320, 520]);

    let attempts = 0;
    const maxAttempts = isIOSSafari ? 10 : 7;
    const delayMs = isIOSSafari ? 140 : 120;
    const releaseClosingWhenSettled = () => {
      clearKeyboardViewportCloseTimer();
      keyboardViewportCloseTimerRef.current = window.setTimeout(() => {
        attempts += 1;
        const keyboardInset = measureIOSKeyboardInset();
        if ((typeof keyboardInset === "number" && keyboardInset < 80) || attempts >= maxAttempts) {
          setKeyboardViewportClosing(false);
          syncIOSKeyboardViewport();
          keyboardViewportCloseTimerRef.current = null;
          return;
        }

        releaseClosingWhenSettled();
      }, delayMs);
    };

    releaseClosingWhenSettled();
    clearComposerViewportGuard();
  };

  useEffect(() => {
    return () => {
      clearKeyboardViewportCloseTimer();
      setKeyboardViewportClosing(false);
      clearKeyboardViewportPoll();
      clearComposerViewportGuard();
    };
  }, []);

  // Mobile: start (and keep) sidebar collapsed when entering small screens.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 720px)");
    const onChange = (e) => {
      setIsMobile(e.matches);
      if (e.matches) setSidebarCollapsed(true);
    };
    try {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    } catch {
      mq.addListener(onChange);
      return () => mq.removeListener(onChange);
    }
  }, []);
const [userMenuOpen, setUserMenuOpen] = useState(false);
const [settingsOpen, setSettingsOpen] = useState(false);
	const [planOpen, setPlanOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportMessage, setSupportMessage] = useState("");
  const [supportFiles, setSupportFiles] = useState([]);
  const [supportSubmitting, setSupportSubmitting] = useState(false);
  const supportFileInputRef = useRef(null);
 	const [theme, setTheme] = useState(() => {
 	  try {
 	    const stored = localStorage.getItem("theme");
	    // Default: follow the user's OS theme preference.
	    return stored || "system";
 	  } catch {
	    return "system";
 	  }
 	});
	const [language, setLanguage] = useState(() => {
	  try {
	    return localStorage.getItem("language") || "en";
	  } catch {
	    return "en";
	  }
	});

  // Secção ativa (para páginas futuras)
  const [activeSection, setActiveSection] = useState("chat");
  const [, setDraftMode] = useState("chat");
const [searchOpen, setSearchOpen] = useState(false);
const [searchQuery, setSearchQuery] = useState("");
const [loadingHint, setLoadingHint] = useState(null); // "web" | null

  // x Modelo ativo (chat)
  const [activeModel, setActiveModel] = useState(DEFAULT_MODEL);
  // Modelo ativo (Creative Studio)
  const [activeCreativeModel, setActiveCreativeModel] = useState("gpt-image-1.5");
  const [creativeCreditsSummary, setCreativeCreditsSummary] = useState(() => readCachedCreativeCredits(user?.id));
      const [creativeEditTargetsByConversation, setCreativeEditTargetsByConversation] = useState({});
  	  const CREATIVE_MODEL_IDS = useMemo(
 	    () =>
 	      new Set([
 	        "gpt-image-1.5",
 	        "gpt-image-1",
	        "nano-banana-2",
 	        "nano-banana-pro",
 	        "nano-banana",
 	        "flux-2-pro",
 	        "flux-2",
 	        "ideogram-3",
 	        "seedream-5-lite",
 	        "seedream-4.5",
 	        "grok-image",
          "seedance-2",
          "kling-3",
          "veo-3.1",
          "hailuo-2.3",
          "wan-2.6",
          "vidu-q3",
          "runway-gen-4.5",
          "eleven-multilingual-v2",
          "minimax-02-hd",
          "cartesia-sonic-2",
          "eleven-v3",
          "lyria-3",
          "lyria-3-pro",
          "suno-v5.5",
 	      ]),
 	    []
 	  );
      const CREATIVE_VIDEO_MODEL_IDS = useMemo(
        () =>
          new Set([
            "seedance-2",
            "kling-3",
            "veo-3.1",
            "hailuo-2.3",
            "wan-2.6",
            "vidu-q3",
            "runway-gen-4.5",
          ]),
        []
      );
      const CREATIVE_MUSIC_MODEL_IDS = useMemo(
        () =>
          new Set([
            "lyria-3",
            "lyria-3-pro",
            "suno-v5.5",
          ]),
        []
      );
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState("");

      const getCreativeEditTargetKey = (conversationId) =>
        conversationId == null ? "" : String(conversationId);

      const setCreativeEditTargetForConversation = ({ conversationId, target }) => {
        const key = getCreativeEditTargetKey(conversationId);
        if (!key || !target?.url) return;

        setCreativeEditTargetsByConversation((prev) => ({
          ...prev,
          [key]: {
            url: String(target.url),
            previewUrl: String(target.previewUrl || target.url),
          },
        }));
      };

      const clearCreativeEditTargetForConversation = (conversationId) => {
        const key = getCreativeEditTargetKey(conversationId);
        if (!key) return;

        setCreativeEditTargetsByConversation((prev) => {
          if (!prev[key]) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
      };

      const moveCreativeEditTargetToConversation = ({ fromId, toId }) => {
        const fromKey = getCreativeEditTargetKey(fromId);
        const toKey = getCreativeEditTargetKey(toId);
        if (!fromKey || !toKey || fromKey === toKey) return;

        setCreativeEditTargetsByConversation((prev) => {
          if (!prev[fromKey] || prev[toKey]) return prev;
          const next = { ...prev, [toKey]: prev[fromKey] };
          delete next[fromKey];
          return next;
        });
      };

	  // Theme application (dark remains default; light is opt-in)
	  useEffect(() => {
	    applyTheme(theme);
	    try {
	      localStorage.setItem("theme", theme);
	    } catch {}
	  }, [theme]);

	  // If user selected "system", keep theme synced when OS preference changes
	  useEffect(() => {
	    if (theme !== "system") return;
	    const mq = window.matchMedia("(prefers-color-scheme: dark)");
	    const onChange = () => applyTheme("system");
	    try {
	      mq.addEventListener("change", onChange);
	      return () => mq.removeEventListener("change", onChange);
	    } catch {
	      // Safari < 14
	      mq.addListener(onChange);
	      return () => mq.removeListener(onChange);
	    }
	  }, [theme]);
    useEffect(() => {
  const params = new URLSearchParams(location.search);
  const tokenFromUrl = params.get("token");
  if (tokenFromUrl) {
    if (handledMagicTokenRef.current === tokenFromUrl) return;
    handledMagicTokenRef.current = tokenFromUrl;
    completeMagicLink(tokenFromUrl).catch(() => {});
    params.delete("token");
    const nextTokenless = params.toString();
    navigate(nextTokenless ? `/?${nextTokenless}` : "/", { replace: true });
    return;
  }
	  const modelFromUrl = params.get("model");
	  const modeFromUrl = params.get("mode"); // "chat" | "creative"
	const forceNew = params.get("new") === "1";

 	  // Normalize + validate Creative Studio model ids coming from the URL so we don't end up with
 	  // an "unselected" model state when something unknown (or an alias) is provided.
 	  const CREATIVE_MODEL_ALIASES = {
 	    "gpt-image": "gpt-image-1.5",
 	    "ideogram-3.0": "ideogram-3",
 	    "seedream-5.0-lite": "seedream-5-lite",
 	    "seedream-5-0-lite": "seedream-5-lite",
 	  };
 	  const creativeModelFromUrlRaw = modelFromUrl ? modelFromUrl.trim() : "";
 	  const creativeModelFromUrlResolved = creativeModelFromUrlRaw
 	    ? CREATIVE_MODEL_ALIASES[creativeModelFromUrlRaw] || creativeModelFromUrlRaw
 	    : "";
 	  const creativeModelFromUrl =
 	    creativeModelFromUrlResolved && CREATIVE_MODEL_IDS.has(creativeModelFromUrlResolved)
 	      ? creativeModelFromUrlResolved
 	      : null;

   // S& MODELO
   // - Chat: only allow known chat models
   // - Creative: allow Creative Studio models (separate state)
	  if (modelFromUrl) {
	    if (modeFromUrl === "creative") {
	      if (creativeModelFromUrl) setActiveCreativeModel(creativeModelFromUrl);
 	    } else {
 	      const chatModelFromUrl = normalizeChatModelId(modelFromUrl);
	      if (MODELS.some((m) => m.id === chatModelFromUrl)) setActiveModel(chatModelFromUrl);
	    }
	  }
	if (forceNew) {
	  if (modeFromUrl === "creative") {
	    handleNewCreativeStudioChat(creativeModelFromUrl || undefined);
	  } else {
	    handleNewChat(normalizeChatModelId(modelFromUrl));
	  }

  // x limpa o new=1 da URL (importantíssimo)
  params.delete("new");
  const next = params.toString();
  navigate(next ? `/?${next}` : "/", { replace: true });

  return; // : impede lógica duplicada
}

// R NO faças fallback aqui
// o default só é usado na inicialização
  // S& MODO / SEC!O
  // Don't auto-create chats based on URL mode; that behavior created extra "Novo chat" entries.
  setActiveSection(modeFromUrl === "creative" ? "creative" : "chat");
}, [location.search, completeMagicLink]);
  

  const storageKey = useMemo(
    () => (user ? `coreai_conversations_${user.id}` : "coreai_conversations_guest"),
    [user]
  );

  // Conversas (localStorage por user)
  const [conversations, setConversations] = useState([createEmptyConversation()]);
  const [activeId, setActiveId] = useState(null);

  // Keep the active conversation's model in sync with the UI selector.
  // (Important for URL-driven model selection and for per-chat model switching.)
  useEffect(() => {
    if (!activeId) return;
    if (!activeModel) return;
    if (!MODELS.some((m) => m.id === activeModel)) return;

    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== activeId) return c;
        if (c.modelId === activeModel) return c;
        return { ...c, modelId: activeModel };
      })
    );
  }, [activeId, activeModel]);

  const authHeaders = useMemo(() => {
    if (!accessToken) return {};
    return { Authorization: `Bearer ${accessToken}` };
  }, [accessToken]);

  const authedRequest = useMemo(() => {
    return async (path, options = {}) => {
      const method = String(options.method || "GET").toUpperCase();
      const headers = {
        ...(authHeaders || {}),
        ...(options.headers || {}),
      };

      const hasContentType = Object.keys(headers).some(
        (k) => String(k).toLowerCase() === "content-type"
      );

      const body = options.body;
      const data =
        body != null && method !== "GET" && method !== "HEAD" ? body : undefined;

      if (data != null && !hasContentType) {
        headers["Content-Type"] = "application/json";
      }

      const res = await api.request({
        url: path,
        method,
        headers,
        data,
      });
      return res.data;
    };
  }, [authHeaders]);

  const authConversationOwnerRef = useRef(null);

  useEffect(() => {
    function handleProjectsStorageUpdated() {
      setProjectsCacheVersion((value) => value + 1);
    }

    window.addEventListener(PROJECTS_STORAGE_UPDATED_EVENT, handleProjectsStorageUpdated);
    return () => window.removeEventListener(PROJECTS_STORAGE_UPDATED_EVENT, handleProjectsStorageUpdated);
  }, []);

  useEffect(() => {
    if (!authReady) return;

    if (user && accessToken) {
      void loadProjectsFromApi().catch((error) => {
        console.error("Erro a sincronizar projetos:", error);
      });
      return;
    }

    clearStoredProjectsIndex();
  }, [authReady, user, accessToken]);

  useEffect(() => {
    if (!authReady) return;

    // Guest mode: restore from localStorage (legacy behavior).
    // Authed users load history from the backend; we keep localStorage as a guest-only cache.
    if (user && accessToken) {
      const ownerKey = user.id;
      if (authConversationOwnerRef.current === ownerKey) return;
      authConversationOwnerRef.current = ownerKey;
      const fresh = [createEmptyConversation("chat", activeModel || DEFAULT_MODEL)];
      setConversations(fresh);
      setActiveId(fresh[0].id);
      return;
    }

    authConversationOwnerRef.current = null;

    try {
      const stored = localStorage.getItem(storageKey);
         if (stored) {
           const parsed = JSON.parse(stored);
           if (Array.isArray(parsed) && parsed.length > 0) {
             const migrated = parsed.map((c) => ({
               ...c,
               // Migration: old "creative" -> "creative_studio"
               mode: c.mode === "creative" ? "creative_studio" : c.mode || "chat",
               pinned: !!c.pinned,
               pinnedAt: typeof c.pinnedAt === "number" ? c.pinnedAt : 0,
               modelId:
                 (c.mode === "creative_studio" || c.mode === "creative") &&
                 typeof c.modelId === "string" &&
                 CREATIVE_MODEL_IDS.has(c.modelId.trim())
                   ? c.modelId.trim()
                   : c.modelId && MODELS.some((m) => m.id === c.modelId)
                     ? c.modelId
                     : DEFAULT_MODEL,
             }));
             setConversations(migrated);
             setActiveId(migrated[0]?.id ?? null);
             return;
           }
         }
    } catch (e) {
      console.error("Erro a ler conversas:", e);
    }
  }, [authReady, user, accessToken, storageKey]);
  // Input + loading
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [scrollDownButtonBottom, setScrollDownButtonBottom] = useState(200);
  const activeStreamAbortRef = useRef(null);
    // x} Attachments
  const [attachments, setAttachments] = useState([]); // [{ id, file, name, size, type, isImage, previewUrl }]
  const [selectedAssistantQuote, setSelectedAssistantQuote] = useState(null);
  const [assistantSelectionAction, setAssistantSelectionAction] = useState(null);
  const fileInputRef = useRef(null);
  const composerToolsRef = useRef(null);
  // x Toggles do composer
const [webSearchEnabled, setWebSearchEnabled] = useState(false);
const [reasoningEnabled, setReasoningEnabled] = useState(false);

useEffect(() => {
  if (userPlanLabel !== "FREE") return;
  if (webSearchEnabled) setWebSearchEnabled(false);
  if (reasoningEnabled) setReasoningEnabled(false);
}, [userPlanLabel, webSearchEnabled, reasoningEnabled]);

const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  // ===== Feedback UI (toast + likes/dislikes) =====
  const [msgRatings, setMsgRatings] = useState({}); // { [key]: "up" | "down" }
// S& Toast global (tipo ChatbotAI)  canto inferior direito
const [globalToast, setGlobalToast] = useState(null); // { text }
const toastTimerRef = useRef(null);

const showGlobalToast = (text) => {
  if (toastTimerRef.current) clearTimeout(toastTimerRef.current);

  setGlobalToast({ text });

  toastTimerRef.current = setTimeout(() => {
    setGlobalToast(null);
    toastTimerRef.current = null;
  }, 2000);
};

const stopCurrentResponse = () => {
  const controller = activeStreamAbortRef.current;
  if (controller) {
    try {
      controller.abort();
    } catch {}
  }
};

const setAssistantMessageContent = (conversationId, content) => {
  setConversations((prev) =>
    prev.map((conv) => {
      if (conv.id !== conversationId) return conv;
      const msgs = Array.isArray(conv.messages) ? conv.messages.slice() : [];
      if (msgs.length === 0) return conv;

      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant") {
        const shouldActivateArtifact =
          typeof content === "string" &&
          content.trim().length > 0 &&
          !isThinkingStatusText(content) &&
          !isGeneratingStatusText(content) &&
          last?.pendingArtifactIntentType;
        msgs[msgs.length - 1] = {
          ...last,
          content,
          artifactIntentType: shouldActivateArtifact
            ? last.pendingArtifactIntentType
            : last.artifactIntentType || null,
          pendingArtifactIntentType: shouldActivateArtifact ? null : last.pendingArtifactIntentType || null,
        };
        return { ...conv, messages: msgs, updatedAt: Date.now() };
      }

      msgs.push({ role: "assistant", content, artifactIntentType: null, pendingArtifactIntentType: null });
      return { ...conv, messages: msgs, updatedAt: Date.now() };
    })
  );
};

const mergePersistedMessageIntoConversation = (conversationId, persistedMessage) => {
  if (!persistedMessage) return;
  setConversations((prev) =>
    prev.map((conv) => {
      if (conv.id !== conversationId) return conv;
      const msgs = Array.isArray(conv.messages) ? conv.messages.slice() : [];
      const normalized = normalizePersistedConversationMessage(persistedMessage);
      let targetIndex = normalized.id ? msgs.findIndex((msg) => msg?.id === normalized.id) : -1;

      if (targetIndex < 0) {
        for (let i = msgs.length - 1; i >= 0; i -= 1) {
          if (msgs[i]?.role === normalized.role && !msgs[i]?.id) {
            targetIndex = i;
            break;
          }
        }
      }

      if (targetIndex < 0) {
        msgs.push(normalized);
      } else {
        const prevMessage = msgs[targetIndex] || {};
        const keepLocalArtifact = Boolean(
          prevMessage?.artifact &&
          (prevMessage?.artifactPendingSync || prevMessage?.artifactEditedLocally)
        );
        msgs[targetIndex] = {
          ...prevMessage,
          ...normalized,
          artifact: keepLocalArtifact ? prevMessage.artifact : normalized.artifact || prevMessage.artifact || null,
          artifactIntentType:
            (keepLocalArtifact ? prevMessage.artifact?.type : normalized.artifact?.type) ||
            prevMessage.artifactIntentType ||
            prevMessage.pendingArtifactIntentType ||
            null,
          pendingArtifactIntentType:
            normalized.artifact?.type ? null : prevMessage.pendingArtifactIntentType || null,
          artifactPendingSync: keepLocalArtifact ? true : false,
          artifactEditedLocally: keepLocalArtifact ? true : false,
        };
      }

      return { ...conv, messages: msgs, updatedAt: Date.now() };
    })
  );
};

const setLastAssistantArtifact = (conversationId, artifact, content = "") => {
  setConversations((prev) =>
    prev.map((conv) => {
      if (conv.id !== conversationId) return conv;
      const msgs = Array.isArray(conv.messages) ? conv.messages.slice() : [];
      if (msgs.length === 0) return conv;
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant") {
        msgs[msgs.length - 1] = {
          ...last,
          content,
          artifact: artifact || null,
          artifactIntentType: artifact?.type || last?.artifactIntentType || null,
          pendingArtifactIntentType: null,
        };
        return { ...conv, messages: msgs, updatedAt: Date.now() };
      }
      msgs.push({
        role: "assistant",
        content,
        artifact: artifact || null,
        artifactIntentType: artifact?.type || null,
        pendingArtifactIntentType: null,
      });
      return { ...conv, messages: msgs, updatedAt: Date.now() };
    })
  );
};

const setLastAssistantArtifactIntent = (conversationId, artifactType) => {
  if (!artifactType) return;
  setConversations((prev) =>
    prev.map((conv) => {
      if (conv.id !== conversationId) return conv;
      const msgs = Array.isArray(conv.messages) ? conv.messages.slice() : [];
      if (msgs.length === 0) return conv;
      const last = msgs[msgs.length - 1];
      const hasVisibleContent = typeof last?.content === "string" && last.content.trim().length > 0;
      if (last?.role === "assistant") {
        msgs[msgs.length - 1] = {
          ...last,
          artifactIntentType: hasVisibleContent ? artifactType : last?.artifactIntentType || null,
          pendingArtifactIntentType: artifactType,
        };
        return { ...conv, messages: msgs, updatedAt: Date.now() };
      }
      msgs.push({
        role: "assistant",
        content: "",
        artifact: null,
        artifactIntentType: null,
        pendingArtifactIntentType: artifactType,
      });
      return { ...conv, messages: msgs, updatedAt: Date.now() };
    })
  );
};

const createAssistantStreamRenderer = (conversationId) =>
  createStreamingTextAnimator({
    onRender: (text) => {
      setAssistantMessageContent(conversationId, normalizeAssistantMarkdown(text));
    },
  });

useEffect(() => {
  return () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  };
}, []);

  const getMsgKey = (i) => `${activeId}-${i}`;


  // Menu S...⬝ (renomear/apagar)
  const [openMenuId, setOpenMenuId] = useState(null);
const [menuPosition, setMenuPosition] = useState(null);
const [deleteChatId, setDeleteChatId] = useState(null);
const [renameChatId, setRenameChatId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
const [openMenuProjectMatch, setOpenMenuProjectMatch] = useState(null);
const [projectPickerState, setProjectPickerState] = useState(null);
const [projectPickerQuery, setProjectPickerQuery] = useState("");
const [isProjectPickerLoading, setIsProjectPickerLoading] = useState(false);
const [, setProjectsCacheVersion] = useState(0);

  // Refs
  const chatBodyRef = useRef(null);
  const chatInputWrapperRef = useRef(null);
  const textareaRef = useRef(null);
  const composerViewportGuardCleanupRef = useRef(null);
  const projectPickerRequestIdRef = useRef(0);
  const composerViewportGuardRestoreRef = useRef(null);
  const keyboardViewportPollCleanupRef = useRef(null);
  const keyboardViewportBaselineRef = useRef(0);
  const keyboardViewportOrientationRef = useRef("");
  const keyboardViewportClosingRef = useRef(false);
  const keyboardViewportCloseTimerRef = useRef(null);
  const assistantSelectionBubbleRef = useRef(null);
  const modelSelectorRef = useRef(null);
 const suppressScrollBtnRef = useRef(false);
  const chatMenuRef = useRef(null);
  const handledMagicTokenRef = useRef(null);
  const loadedRemoteConversationsRef = useRef(new Set());
  const pendingArtifactSyncRef = useRef(new Set());
  const remoteListLoadedUserIdRef = useRef(null);
  const remoteListLoadingRef = useRef(false);
  // When opening an existing (remote) chat, we "hydrate" its messages from the backend.
  // During this time we should not show the "new chat" empty-state UI (it causes a visible flicker).
  const [loadingConversationId, setLoadingConversationId] = useState(null);

  const currentComposerQuote =
    selectedAssistantQuote && selectedAssistantQuote.conversationId === activeId
      ? selectedAssistantQuote
      : null;

  const closeAssistantSelectionAction = () => {
    setAssistantSelectionAction(null);
  };

  const clearComposerQuote = () => {
    setSelectedAssistantQuote(null);
  };

  const resolveAssistantSelectionAction = ({ container = null, conversationId = activeId } = {}) => {
    if (typeof window === "undefined") return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      closeAssistantSelectionAction();
      return;
    }

    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    if (!anchorNode || !focusNode) {
      closeAssistantSelectionAction();
      return;
    }

    const anchorContainer = container || findAssistantSelectableContainer(anchorNode);
    const focusContainer = container || findAssistantSelectableContainer(focusNode);
    if (!anchorContainer || !focusContainer || anchorContainer !== focusContainer) {
      closeAssistantSelectionAction();
      return;
    }

    if (!anchorContainer.contains(anchorNode) || !anchorContainer.contains(focusNode)) {
      closeAssistantSelectionAction();
      return;
    }

    const rawText = String(selection.toString() || "").trim();
    const normalizedText = normalizeQuotedSelectionText(rawText).slice(0, MAX_ASSISTANT_SELECTION_CHARS);
    if (!normalizedText) {
      closeAssistantSelectionAction();
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) {
      closeAssistantSelectionAction();
      return;
    }

    const useTouchPlacement =
      isMobile ||
      isTabletViewport ||
      (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)")?.matches);
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 0;
    const bubbleHeight = 46;
    const viewportEdgeGap = 12;
    const selectionGap = 12;
    const nativeToolbarClearance = 56;
    const spaceAbove = rect.top;
    const spaceBelow = Math.max(0, viewportHeight - rect.bottom);

    let top;
    if (useTouchPlacement) {
      const composerRect = chatInputWrapperRef.current?.getBoundingClientRect?.() || null;
      if (composerRect?.top) {
        top = Math.max(
          viewportEdgeGap,
          Math.min(
            viewportHeight - bubbleHeight - viewportEdgeGap,
            composerRect.top - bubbleHeight - 12
          )
        );
      } else {
        const nativeToolbarLikelyAbove = spaceAbove > spaceBelow;
        if (nativeToolbarLikelyAbove) {
          const desiredBelow = rect.bottom + nativeToolbarClearance + selectionGap;
          top =
            desiredBelow + bubbleHeight <= viewportHeight - viewportEdgeGap
              ? desiredBelow
              : Math.max(viewportEdgeGap, rect.top - bubbleHeight - selectionGap);
        } else {
          const desiredAbove = rect.top - bubbleHeight - nativeToolbarClearance - selectionGap;
          top =
            desiredAbove >= viewportEdgeGap
              ? desiredAbove
              : Math.min(
                  viewportHeight - bubbleHeight - viewportEdgeGap,
                  rect.bottom + selectionGap
                );
        }
      }
    } else {
      top =
        rect.top > 60
          ? rect.top - 54
          : rect.bottom + 12;
    }
    const rawLeft = rect.left + rect.width / 2;
    const bubbleHalfWidth = 88;
    const left = Math.min(
      Math.max(rawLeft, bubbleHalfWidth + 12),
      window.innerWidth - bubbleHalfWidth - 12
    );

    setAssistantSelectionAction({
      conversationId,
      text: normalizedText,
      previewText: buildQuotedPreviewText(normalizedText),
      top,
      left,
    });
  };

  const handleAskAboutAssistantSelection = () => {
    if (!assistantSelectionAction?.text) return;

    const nextQuote = {
      conversationId: activeId,
      text: assistantSelectionAction.text,
      previewText: assistantSelectionAction.previewText || buildQuotedPreviewText(assistantSelectionAction.text),
    };

    clearWindowSelection();
    flushSync(() => {
      setSelectedAssistantQuote(nextQuote);
      closeAssistantSelectionAction();
    });

    const focusComposer = () => {
      autoResizeTextarea();
      const textarea = textareaRef.current;
      if (!textarea) return;

      try {
        textarea.focus({ preventScroll: true });
      } catch {
        textarea.focus();
      }

      try {
        const caret = textarea.value.length;
        textarea.setSelectionRange(caret, caret);
      } catch {}

      if (shouldUseCompactIOSBrowserViewportGuards()) {
        keyboardViewportBaselineRef.current = 0;
        clearKeyboardViewportCloseTimer();
        setKeyboardViewportClosing(false);
        syncIOSKeyboardViewport();
        queueIOSKeyboardViewportSync([60, 140, 240, 380, 560, 760, 980, 1220]);
        stabilizeIOSAltComposerViewport({ watchViewport: true });
      }

      chatInputWrapperRef.current?.scrollIntoView?.({
        behavior: isMobile || isTabletViewport ? "auto" : "smooth",
        block: "end",
      });
    };

    requestAnimationFrame(() => {
      focusComposer();
      window.setTimeout(focusComposer, 120);
    });
  };

  const handleAssistantSelectionMouseUp = (event) => {
    if (typeof window === "undefined") return;
    const target = event.currentTarget;
    const conversationId = activeId;

    window.requestAnimationFrame(() => {
      resolveAssistantSelectionAction({ container: target, conversationId });
    });
  };

  useEffect(() => {
    const handleSelectionChange = () => {
      if (typeof window === "undefined") return;
      const selection = window.getSelection();
      const text = String(selection?.toString() || "").trim();
      if (!text) closeAssistantSelectionAction();
    };

    const handlePointerDown = (event) => {
      if (assistantSelectionBubbleRef.current?.contains(event.target)) return;
      if (findAssistantSelectableContainer(event.target)) return;
      if (isEditableInteractionTarget(event.target)) {
        closeAssistantSelectionAction();
        return;
      }
      closeAssistantSelectionAction();
      clearWindowSelection();
    };

    const handleViewportChange = () => {
      closeAssistantSelectionAction();
    };

    const handlePointerUp = (event) => {
      if (isEditableInteractionTarget(event.target)) return;
      window.requestAnimationFrame(() => {
        resolveAssistantSelectionAction({ conversationId: activeId });
      });
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown, { passive: true });
    document.addEventListener("mouseup", handlePointerUp);
    document.addEventListener("touchend", handlePointerUp, { passive: true });
    window.addEventListener("resize", handleViewportChange);
    const scroller = chatBodyRef.current;
    scroller?.addEventListener("scroll", handleViewportChange, { passive: true });

    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("mouseup", handlePointerUp);
      document.removeEventListener("touchend", handlePointerUp);
      window.removeEventListener("resize", handleViewportChange);
      scroller?.removeEventListener("scroll", handleViewportChange);
    };
  }, [activeId]);

  useEffect(() => {
    setAssistantSelectionAction((prev) =>
      prev && prev.conversationId === activeId ? prev : null
    );
  }, [activeId]);

  useEffect(() => {
    if (activeSection !== "chat") {
      setAssistantSelectionAction(null);
    }
  }, [activeSection]);

  // When logging out, allow re-loading remote history on the next login.
  useEffect(() => {
    if (!(user && accessToken)) {
      loadedRemoteConversationsRef.current.clear();
      remoteListLoadedUserIdRef.current = null;
      remoteListLoadingRef.current = false;
    }
  }, [user, accessToken]);

  useEffect(() => {
    if (!openMenuId) {
      setMenuPosition(null);
      setOpenMenuProjectMatch(null);
    }
  }, [openMenuId]);

  // Logged-in users: load conversation list from backend once per user (multi-device history).
  // Keep the active draft open (we don't auto-open the last conversation on login).
  useEffect(() => {
    if (!authReady) {
      remoteListLoadedUserIdRef.current = null;
      remoteListLoadingRef.current = false;
      return;
    }

    let cancelled = false;
    let started = false;
    let finished = false;

    const loadRemoteList = async () => {
      if (!user || !accessToken) return;
      if (remoteListLoadedUserIdRef.current === user.id) return;
      if (remoteListLoadingRef.current) return;

      remoteListLoadingRef.current = true;
      started = true;
      try {
        let out = null;
        let lastErr = null;

        for (let attempt = 0; attempt <= REMOTE_CONVERSATION_LIST_RETRY_DELAYS_MS.length; attempt += 1) {
          try {
            out = await authedRequest("/conversations");
            lastErr = null;
            break;
          } catch (e) {
            lastErr = e;
            if (cancelled || !shouldRetryRemoteConversationListLoad(e)) {
              throw e;
            }

            const delay = REMOTE_CONVERSATION_LIST_RETRY_DELAYS_MS[attempt];
            if (delay == null) break;

            console.warn(
              `[conversations] initial load retry ${attempt + 1}/${REMOTE_CONVERSATION_LIST_RETRY_DELAYS_MS.length}`,
              {
                status: Number(e?.status || e?.response?.status || 0) || null,
                message: e?.message || String(e),
              }
            );
            await waitMs(delay);
          }
        }

        if (lastErr) throw lastErr;
        if (cancelled) return;

        const list = Array.isArray(out?.conversations) ? out.conversations : [];
        remoteListLoadedUserIdRef.current = user.id;

         const mapped = list.map((c) => ({
           id: c.id,
           title: c.title || DEFAULT_CONVERSATION_TITLE,
           mode: c.mode || "chat",
           pinned: !!c.pinned,
           pinnedAt: c.pinnedAt ? Date.parse(c.pinnedAt) : 0,
           updatedAt: c.updatedAt ? Date.parse(c.updatedAt) : c.createdAt ? Date.parse(c.createdAt) : Date.now(),
           messages: [],
           messageCount: typeof c.messageCount === "number" ? c.messageCount : 0,
           modelId:
             (c.mode || "chat") === "creative_studio"
               ? (CREATIVE_MODEL_IDS.has(String(activeCreativeModel || "").trim())
                 ? String(activeCreativeModel || "").trim()
                 : "gpt-image-1.5")
               : (activeModel || DEFAULT_MODEL),
         }));

        setConversations((prev) => {
          const prevRemoteById = new Map(
            prev
              .filter((x) => typeof x?.id === "string")
              .map((x) => [x.id, x])
          );

          const mergedRemote = mapped.map((x) => {
            const old = prevRemoteById.get(x.id);
            const oldMsgs = Array.isArray(old?.messages) ? old.messages : [];
            const mergedTitle =
              old?.title && !isDefaultConversationTitle(old.title) && isDefaultConversationTitle(x.title)
                ? old.title
                : x.title;
             const isCreative = (x.mode || old?.mode) === "creative_studio";
             const oldModel = typeof old?.modelId === "string" ? old.modelId.trim() : "";
             const mergedModelId = isCreative
               ? (oldModel && CREATIVE_MODEL_IDS.has(oldModel) ? oldModel : x.modelId)
               : (oldModel && MODELS.some((m) => m.id === oldModel) ? oldModel : x.modelId);

            const msgCount = Math.max(
              typeof old?.messageCount === "number" ? old.messageCount : 0,
              typeof x.messageCount === "number" ? x.messageCount : 0,
              oldMsgs.length
            );

            return {
              ...x,
              title: mergedTitle,
              messages: oldMsgs.length > 0 ? oldMsgs : x.messages,
              messageCount: msgCount,
              modelId: mergedModelId,
            };
          });

          // Keep exactly one empty local draft at the top (prevents "Novo chat" spam).
          const localDrafts = prev.filter(
            (c) => typeof c?.id !== "string" && Array.isArray(c?.messages) && c.messages.length === 0
          );
           const keepDraft =
             localDrafts[0] ||
             createEmptyConversation(
               activeSection === "creative" ? "creative_studio" : "chat",
               activeSection === "creative"
                 ? (CREATIVE_MODEL_IDS.has(String(activeCreativeModel || "").trim())
                   ? String(activeCreativeModel || "").trim()
                   : "gpt-image-1.5")
                 : (activeModel || DEFAULT_MODEL)
             );

          // Preserve any non-empty local drafts (rare, but avoids losing unsent UI state).
          const nonEmptyLocals = prev.filter(
            (c) => typeof c?.id !== "string" && Array.isArray(c?.messages) && c.messages.length > 0
          );

          return [keepDraft, ...nonEmptyLocals, ...mergedRemote];
        });
        finished = true;
      } catch (e) {
        console.error("Erro a carregar conversas do backend:", e);
      } finally {
        remoteListLoadingRef.current = false;
      }
    };

    loadRemoteList();
    return () => {
      cancelled = true;
      if (started && !finished) {
        // A token refresh/section change can restart this effect while the previous
        // request is still in flight. Release the lock so the next pass can retry.
        remoteListLoadingRef.current = false;
      }
    };
  }, [authReady, user, accessToken, authedRequest, activeSection]);


// S& força o textarea a crescer/recalcular altura (mesmo quando o input muda via setInput)
 const autoResizeTextarea = () => {
   const el = textareaRef.current;
   if (!el) return;

  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
};

  const scrollToBottom = (behavior = "auto") => {
    const updateScrollDownVisibility = () => {
  const el = chatBodyRef.current;
  if (!el) return;

  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;

  // S& só aparece depois de subires "um bocado"
  setShowScrollDown(distanceFromBottom > 200);
};
    const el = chatBodyRef.current;
    if (!el) return;

    el.scrollTop = el.scrollHeight;

    requestAnimationFrame(() => {
      el.scrollTo({
        top: el.scrollHeight,
        behavior,
      });
    });
  };

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId),
    [conversations, activeId]
  );
  const activeCreativeEditTarget = useMemo(() => {
    const key = getCreativeEditTargetKey(activeConversation?.id);
    return key ? creativeEditTargetsByConversation[key] || null : null;
  }, [activeConversation?.id, creativeEditTargetsByConversation]);
  const isCreativeChat = activeConversation?.mode === "creative_studio";
  const sidebarActiveConversationId =
    activeSection === "chat" || activeSection === "creative" ? activeId : null;

  // Keep the active Creative Studio conversation's model in sync with the Creative selector.
  useEffect(() => {
    if (!activeId) return;
    if (activeConversation?.mode !== "creative_studio") return;
    if (!activeCreativeModel) return;

    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== activeId) return c;
        if (c.modelId === activeCreativeModel) return c;
        return { ...c, modelId: activeCreativeModel };
      })
    );
  }, [activeId, activeConversation?.mode, activeCreativeModel]);

  // On hard refresh, `activeSection` defaults to "chat". If the active conversation is a creative studio chat,
  // the chat composer is hidden (by design) and the CreativeStudio UI won't mount unless we sync the section.
  useEffect(() => {
    if (!activeConversation) return;

    // Only auto-sync between chat/creative (don't yank the user out of explore/copilot, etc.)
    if (activeSection !== "chat" && activeSection !== "creative") return;

    const desired = activeConversation.mode === "creative_studio" ? "creative" : "chat";
    if (activeSection === desired) return;

    setActiveSection(desired);
    // Keep existing behavior consistent (used elsewhere).
    if (typeof setDraftMode === "function") setDraftMode(desired);
  }, [activeConversation, activeSection]);
// S& conversas ordenadas: afixadas em cima (mais recentes primeiro), resto mantém ordem original
const orderedConversations = useMemo(() => {
  return conversations
    .map((c, idx) => ({ ...c, __idx: idx }))
    .sort((a, b) => {
      const ap = !!a.pinned;
      const bp = !!b.pinned;

      // pinned primeiro
      if (ap && !bp) return -1;
      if (!ap && bp) return 1;

      // ambos pinned: mais recente em cima
      if (ap && bp) return (b.pinnedAt || 0) - (a.pinnedAt || 0);

      // nenhum pinned: mais recente (updatedAt) em cima, fallback para ordem original
      const au = typeof a.updatedAt === "number" ? a.updatedAt : a.__idx;
      const bu = typeof b.updatedAt === "number" ? b.updatedAt : b.__idx;
      if (bu !== au) return bu - au;
      return a.__idx - b.__idx;
    })
    .map(({ __idx, ...c }) => c);
}, [conversations]);

  const filteredModels = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    if (!q) return MODELS;
    return MODELS.filter((m) => m.name.toLowerCase().includes(q));
  }, [modelQuery]);
  const bestAutoModel = filteredModels.find((m) => m.id === "__best__") || null;
  const standardFilteredModels = filteredModels.filter((m) => m.id !== "__best__");
  // Persist local conversations only for guests (logged-in users are persisted in the DB).
  useEffect(() => {
    if (!authReady) return;
    if (user && accessToken) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(conversations));
    } catch (e) {
      console.error("Erro a guardar conversas:", e);
    }
  }, [conversations, storageKey, authReady, user, accessToken]);

  useEffect(() => {
  const handleClickOutside = (e) => {
    if (modelMenuOpen && modelSelectorRef.current && !modelSelectorRef.current.contains(e.target)) {
      setModelMenuOpen(false);
      setModelQuery("");
    }
    if (toolsMenuOpen && composerToolsRef.current && !composerToolsRef.current.contains(e.target)) {
      setToolsMenuOpen(false);
    }
  };

  document.addEventListener("mousedown", handleClickOutside);
  return () => {
    document.removeEventListener("mousedown", handleClickOutside);
  };
}, [modelMenuOpen, toolsMenuOpen]);
useEffect(() => {
  const el = chatBodyRef.current;
  if (!el) return;

  const onScroll = () => {
  if (suppressScrollBtnRef.current) return; // x sem updates durante open

  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  setShowScrollDown(distanceFromBottom > 700);
};

  el.addEventListener("scroll", onScroll, { passive: true });

  // estado inicial
  setShowScrollDown(false);

  return () => el.removeEventListener("scroll", onScroll);
}, [activeConversation?.messages?.length, loading]);
// S& quando o input muda por setInput (ex.: botão Editar), recalcula a altura automaticamente
useEffect(() => {
  requestAnimationFrame(() => {
    autoResizeTextarea();
  });
}, [input, currentComposerQuote]);
// S& quando mudas de conversa, abre SEMPRE no fundo (tipo ChatGPT)
useEffect(() => {
  const el = chatBodyRef.current;
  if (!el) return;

  suppressScrollBtnRef.current = true; // x bloqueia
  setShowScrollDown(false);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scrollToBottom("auto");
      setShowScrollDown(false);

      // liberta depois do scroll inicial estar feito
      requestAnimationFrame(() => {
        suppressScrollBtnRef.current = false;
      });
    });
  });
}, [activeId]);

// Quando o utilizador tem sessao, carrega mensagens do backend ao abrir um chat
useEffect(() => {
  if (!authReady) return;

  let cancelled = false;
  let requestedConversationId = null;
  let finished = false;

  const loadMessages = async () => {
    if (!user || !accessToken || !activeId) return;
    if (typeof activeId !== "string") return;
    if (loadedRemoteConversationsRef.current.has(activeId)) return;

    requestedConversationId = activeId;
    setLoadingConversationId(activeId);
    loadedRemoteConversationsRef.current.add(activeId);

    try {
      const out = await authedRequest(`/conversations/${encodeURIComponent(activeId)}`);
      if (cancelled) {
        // If the user navigated away mid-request, allow a future retry.
        loadedRemoteConversationsRef.current.delete(activeId);
        return;
      }

      const convo = out?.conversation;
      const messages = Array.isArray(convo?.messages)
        ? convo.messages.map((m) => normalizePersistedConversationMessage(m))
        : [];

      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeId
            ? {
                ...c,
                // Don't clobber a good local title with the backend default.
                title:
                  c.title && !isDefaultConversationTitle(c.title) && isDefaultConversationTitle(convo?.title)
                    ? c.title
                    : convo?.title || c.title,
                 mode: convo?.mode || c.mode,
                 pinned: typeof convo?.pinned === "boolean" ? convo.pinned : c.pinned,
                 pinnedAt: convo?.pinnedAt ? Date.parse(convo.pinnedAt) : c.pinnedAt || 0,
                 updatedAt: convo?.updatedAt ? Date.parse(convo.updatedAt) : c.updatedAt,
                 messages,
                 messageCount: messages.length,
               }
             : c
        )
      );
      finished = true;
    } catch (e) {
      loadedRemoteConversationsRef.current.delete(activeId);
      console.error("Erro a carregar mensagens do backend:", e);
    } finally {
      if (!cancelled) {
        setLoadingConversationId((v) => (v === activeId ? null : v));
      }
    }
  };

  loadMessages();
  return () => {
    cancelled = true;
    if (requestedConversationId && !finished) {
      // If this effect is invalidated mid-request, allow the next render to
      // request the same conversation again instead of getting stuck empty.
      loadedRemoteConversationsRef.current.delete(requestedConversationId);
      setLoadingConversationId((value) =>
        value === requestedConversationId ? null : value
      );
    }
  };
}, [activeId, authReady, user, accessToken, authedRequest]);
  // Handlers

  const persistConversationTitle = async (conversationId, title) => {
    if (!user || !accessToken) return;
    if (typeof conversationId !== "string") return;
    try {
      await authedRequest(`/conversations/${encodeURIComponent(conversationId)}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
    } catch (e) {
      console.error("Erro a renomear conversa no backend:", e);
    }
  };

  const persistMessage = async ({ conversationId, role, content, attachments, quotedSelection, artifact }) => {
    if (!user || !accessToken) return;
    if (typeof conversationId !== "string") return;
    try {
      const persistedAttachments = buildPersistedMessageAttachments(attachments, quotedSelection);
      const out = await authedRequest(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: "POST",
        body: JSON.stringify({ role, content, attachments: persistedAttachments, artifact }),
      });
      mergePersistedMessageIntoConversation(conversationId, out?.message || null);

      const convo = out?.conversation;
      if (convo?.id === conversationId && typeof convo?.title === "string" && convo.title.trim()) {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  title: convo.title,
                  updatedAt: convo.updatedAt ? Date.parse(convo.updatedAt) : c.updatedAt,
                }
              : c
          )
        );
      }
    } catch (e) {
      console.error("Erro a guardar mensagem no backend:", e);
    }
  };

  const patchConversationMessage = async ({ conversationId, messageId, content, artifact }) => {
    if (!user || !accessToken) return null;
    if (typeof conversationId !== "string" || typeof messageId !== "string") return null;
    try {
      const out = await authedRequest(
        `/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ content, artifact }),
        }
      );
      mergePersistedMessageIntoConversation(conversationId, out?.message || null);
      return out?.message || null;
    } catch (e) {
      console.error("Erro a atualizar mensagem no backend:", e);
      throw e;
    }
  };

  useEffect(() => {
    if (!user || !accessToken) return;

    const pendingMessages = [];
    for (const conversation of conversations) {
      if (!conversation?.id || !Array.isArray(conversation.messages)) continue;
      for (const message of conversation.messages) {
        if (
          message?.artifactPendingSync &&
          typeof message?.id === "string" &&
          message.id &&
          message?.role === "assistant" &&
          message?.artifact
        ) {
          pendingMessages.push({
            conversationId: conversation.id,
            messageId: message.id,
            content: message.content || "",
            artifact: message.artifact,
          });
        }
      }
    }

    if (!pendingMessages.length) return;

    let cancelled = false;
    for (const pending of pendingMessages) {
      const syncKey = `${pending.conversationId}:${pending.messageId}`;
      if (pendingArtifactSyncRef.current.has(syncKey)) continue;
      pendingArtifactSyncRef.current.add(syncKey);

      patchConversationMessage(pending)
        .then(() => {
          pendingArtifactSyncRef.current.delete(syncKey);
          if (cancelled) return;
          setConversations((prev) =>
            prev.map((conv) => {
              if (conv.id !== pending.conversationId) return conv;
              const msgs = Array.isArray(conv.messages) ? conv.messages.slice() : [];
              const targetIndex = msgs.findIndex((msg) => msg?.id === pending.messageId);
              if (targetIndex < 0) return conv;
              msgs[targetIndex] = {
                ...msgs[targetIndex],
                artifactPendingSync: false,
                artifactEditedLocally: true,
              };
              return { ...conv, messages: msgs, updatedAt: Date.now() };
            })
          );
        })
        .catch(() => {
          pendingArtifactSyncRef.current.delete(syncKey);
          if (cancelled) return;
          setConversations((prev) =>
            prev.map((conv) => {
              if (conv.id !== pending.conversationId) return conv;
              const msgs = Array.isArray(conv.messages) ? conv.messages.slice() : [];
              const targetIndex = msgs.findIndex((msg) => msg?.id === pending.messageId);
              if (targetIndex < 0) return conv;
              msgs[targetIndex] = {
                ...msgs[targetIndex],
                artifactPendingSync: false,
                artifactEditedLocally: false,
              };
              return { ...conv, messages: msgs, updatedAt: Date.now() };
            })
          );
          showGlobalToast("Couldn't save artifact changes");
        });
    }

    return () => {
      cancelled = true;
    };
  }, [conversations, user, accessToken]);

  const deleteRemoteConversation = async (conversationId) => {
    if (!user || !accessToken) return;
    if (typeof conversationId !== "string") return;
    try {
      await authedRequest(`/conversations/${encodeURIComponent(conversationId)}`, {
        method: "DELETE",
      });
      await loadProjectsFromApi();
    } catch (e) {
      console.error("Erro a apagar conversa no backend:", e);
    }
  };

  const setModelForActiveConversation = (modelId) => {
    const normalized = normalizeChatModelId(modelId);
    const nextId = normalized && MODELS.some((m) => m.id === normalized) ? normalized : DEFAULT_MODEL;
    setActiveModel(nextId);
    if (!activeId) return;
    setConversations((prev) => prev.map((c) => (c.id === activeId ? { ...c, modelId: nextId } : c)));
  };
  // Web Search UX: WebSearch injects context only (no model forcing).
const handleNewChat = (modelIdOverride) => {
  const normalizedOverride = normalizeChatModelId(modelIdOverride);
  const newConv = createEmptyConversation(
    "chat",
    normalizedOverride && MODELS.some((m) => m.id === normalizedOverride)
      ? normalizedOverride
      : normalizeChatModelId(activeModel) || DEFAULT_MODEL
  );
  setConversations((prev) => {
    // Keep only one empty local draft at a time (prevents "Novo chat" spam).
    const pruned = prev.filter(
      (c) => !(typeof c.id !== "string" && Array.isArray(c.messages) && c.messages.length === 0)
    );
    return [newConv, ...pruned];
  });
  setActiveId(newConv.id);
  setInput("");
  setOpenMenuId(null);
  setActiveSection("chat");
  if (isMobile) setSidebarCollapsed(true);
};

const ensureConversationExistsRemotely = async ({
  draftId,
  title,
  mode = "chat",
}) => {
  if (!user || !accessToken || typeof draftId === "string") {
    return { id: draftId, createdRemote: false, mode };
  }

  try {
    const out = await authedRequest("/conversations", {
      method: "POST",
      body: JSON.stringify({ title, mode }),
    });

    const conversation = out?.conversation;
    if (!conversation?.id) {
      throw new Error("CONVERSATION_CREATE_FAILED");
    }

    loadedRemoteConversationsRef.current.add(conversation.id);
    return {
      id: conversation.id,
      createdRemote: true,
      mode: conversation.mode || mode,
    };
  } catch (e) {
    console.error("Erro a criar conversa no backend:", e);
    showGlobalToast("Ocorreu um erro. Tenta novamente.");
    return { id: draftId, createdRemote: false, mode };
  }
};

  const replaceAssistantTerminalMessage = ({ conversationId, message }) => {
    setConversations((prev) =>
      prev.map((conv) => {
        if (conv.id !== conversationId) return conv;
        const msgs = Array.isArray(conv.messages) ? conv.messages.slice() : [];
        if (msgs.length > 0 && msgs[msgs.length - 1]?.role === "assistant") {
          msgs[msgs.length - 1] = { ...message };
        } else {
          msgs.push({ ...message });
        }
        return { ...conv, messages: msgs, updatedAt: Date.now() };
      })
    );
  };

  const showModelUpgradeRequiredState = ({ conversationId, plan = userPlanLabel, modelId }) => {
    const upgradeMessage = buildModelPlanUpgradeMessage({ plan, modelId });
    setPlanOpen(true);
    showGlobalToast(`Upgrade to use ${upgradeMessage.errorMeta.modelName}.`);
    replaceAssistantTerminalMessage({
      conversationId,
      message: upgradeMessage,
    });
    return upgradeMessage;
  };

  const showMessageLimitUpgradeRequiredState = ({
    conversationId,
    plan = userPlanLabel,
    limit = 0,
    limitWindow = "day",
    periodEnd = null,
  }) => {
    const upgradeMessage = buildMessageLimitUpgradeMessage({
      plan,
      limit,
      limitWindow,
      periodEnd,
    });
    setPlanOpen(true);
    showGlobalToast(
      limitWindow === "day" ? "Daily message limit reached." : "Monthly message limit reached."
    );
    replaceAssistantTerminalMessage({
      conversationId,
      message: upgradeMessage,
    });
    return upgradeMessage;
  };

  const showCreativeLimitUpgradeRequiredState = ({
    conversationId,
    plan = userPlanLabel,
    limit = 0,
  }) => {
    const upgradeMessage = buildCreativeLimitUpgradeMessage({ plan, limit });
    setPlanOpen(true);
    showGlobalToast("Creative Studio limit reached.");
    replaceAssistantTerminalMessage({
      conversationId,
      message: upgradeMessage,
    });
    return upgradeMessage;
  };

  const promptPlanUpgradeForComposerFeature = (featureLabel) => {
    setToolsMenuOpen(false);
    setPlanOpen(true);
    showGlobalToast(`Upgrade your plan to use ${featureLabel}.`);
  };

  const handleToggleWebSearch = () => {
    if (webSearchEnabled) {
      setWebSearchEnabled(false);
      return;
    }

    if (userPlanLabel === "FREE") {
      promptPlanUpgradeForComposerFeature("Web Search");
      return;
    }

    setWebSearchEnabled(true);
  };

  const handleToggleReasoning = () => {
    if (reasoningEnabled) {
      setReasoningEnabled(false);
      return;
    }

    if (userPlanLabel === "FREE") {
      promptPlanUpgradeForComposerFeature("Reasoning");
      return;
    }

    setReasoningEnabled(true);
  };

const activateConversation = ({
  conversationId,
  mode = "chat",
  modelId,
}) => {
  setActiveId(conversationId);
  if (mode === "creative_studio") {
    const creativeModel = typeof modelId === "string" ? modelId.trim() : "";
    setActiveCreativeModel(
      creativeModel && CREATIVE_MODEL_IDS.has(creativeModel) ? creativeModel : "gpt-image-1.5"
    );
  } else {
    const normalized = normalizeChatModelId(modelId);
    if (normalized && MODELS.some((model) => model.id === normalized)) setActiveModel(normalized);
    else setActiveModel(DEFAULT_MODEL);
  }
  setOpenMenuId(null);
  setActiveSection(mode === "creative_studio" ? "creative" : "chat");
  setDraftMode(mode === "creative_studio" ? "creative" : "chat");
  if (isMobile) setSidebarCollapsed(true);
};

const syncConversationProjectLink = async ({
  conversationId,
  draftId = null,
  localKey = "",
  projectId,
  projectName = "",
  projectChatId = null,
}) => {
  if (!projectId || !conversationId || typeof conversationId !== "string" || projectChatId) {
    return null;
  }

  try {
    const result = await attachConversationToProjectRequest({
      projectId,
      conversationId,
    });

    setConversations((prev) =>
      prev.map((item) => {
        const matchesId =
          item.id === conversationId || (draftId !== null && item.id === draftId);
        const matchesLocalKey = localKey && item.localKey === localKey;

        if (!matchesId && !matchesLocalKey) return item;

        return {
          ...item,
          projectId: result?.projectId || projectId,
          projectName: result?.projectName || projectName || item.projectName || "",
          projectChatId: result?.projectChatId || item.projectChatId || null,
        };
      })
    );

    void loadProjectsFromApi().catch((error) => {
      console.error("Erro a sincronizar projetos apos associar conversa:", error);
    });

    return result;
  } catch (error) {
    console.error("Erro a associar conversa ao projeto:", error);
    void loadProjectsFromApi().catch(() => {});
    return null;
  }
};

const createProjectConversation = async ({
  projectId,
  projectName,
  conversationRefId,
  title,
  text,
  attachments = [],
  modelId,
  webSearchEnabled: projectWebSearchEnabled = false,
  reasoningEnabled: projectReasoningEnabled = false,
}) => {
  const messageText = String(text || "").trim();
  const conversationAttachments = Array.isArray(attachments) ? attachments : [];
  if ((!messageText && conversationAttachments.length === 0) || loading) return null;

  if (!accessToken) {
    showGlobalToast("Log in to use the chat.");
    openAuth?.("login");
    return null;
  }

  const normalizedModel = normalizeChatModelId(modelId);
  const nextModelId =
    normalizedModel && MODELS.some((m) => m.id === normalizedModel)
      ? normalizedModel
      : DEFAULT_MODEL;
  const timestamp = Date.now();
  const nextLocalKey =
    String(conversationRefId || "").trim() ||
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `project-${timestamp}-${Math.random()}`);
  const nextTitle =
    String(title || DEFAULT_CONVERSATION_TITLE).trim() || DEFAULT_CONVERSATION_TITLE;

  try {
    const nextConversation = {
      ...createEmptyConversation("chat", nextModelId),
      title: nextTitle,
      updatedAt: timestamp,
      localKey: nextLocalKey,
      projectId: projectId || null,
      projectName: projectName || "",
      projectChatId: null,
    };

    setConversations((prev) => [
      nextConversation,
      ...prev.filter(
        (item) => item.id !== nextConversation.id && item.localKey !== nextConversation.localKey
      ),
    ]);

    void sendConversationMessage({
      customText: messageText,
      conversationId: nextConversation.id,
      conversationOverride: nextConversation,
      attachmentsOverride: conversationAttachments,
      sectionOverride: "chat",
      webSearchEnabledOverride: projectWebSearchEnabled,
      reasoningEnabledOverride: projectReasoningEnabled,
      resetComposer: false,
      shouldScrollAfterSend: true,
    });

    return {
      id: nextConversation.id,
      localKey: nextConversation.localKey,
      modelId: nextModelId,
      mode: nextConversation.mode,
      updatedAt: new Date(timestamp).toISOString(),
      projectChatId: null,
    };
  } catch (error) {
    console.error("Erro a criar conversa do projeto:", error);
    showGlobalToast("Ocorreu um erro. Tenta novamente.");
    return null;
  }
};

const openProjectConversation = (conversationReference) => {
  const conversation = conversations.find(
    (item) =>
      item?.localKey === conversationReference ||
      item?.id === conversationReference
  );

  if (!conversation) return false;

  activateConversation({
    conversationId: conversation.id,
    mode: conversation.mode,
    modelId: conversation.modelId,
  });
  return true;
};

const handleNewCreativeStudioChat = (modelIdOverride) => {
  const newConv = createEmptyConversation(
    "creative_studio",
    typeof modelIdOverride === "string" && modelIdOverride.trim() ? modelIdOverride : activeCreativeModel || "gpt-image-1.5"
  );
  setConversations((prev) => {
    const pruned = prev.filter(
      (c) => !(typeof c.id !== "string" && Array.isArray(c.messages) && c.messages.length === 0)
    );
    return [newConv, ...pruned];
  });
  setActiveId(newConv.id);
  setInput("");
  setOpenMenuId(null);
  setActiveSection("creative");
  setDraftMode("creative");
  if (isMobile) setSidebarCollapsed(true);
};
  
const handleRenameChat = (id) => {
  const conv = conversations.find((c) => c.id === id);
  if (!conv) return;

  setRenameChatId(id);
  setRenameValue(conv.title);
};

const handleProjectConversationRenameRequest = (conversationReference) => {
  const conversation = conversations.find(
    (item) =>
      item?.localKey === conversationReference ||
      item?.id === conversationReference
  );

  if (!conversation) return false;

  handleRenameChat(conversation.id);
  return true;
};

const handleProjectConversationDeleteRequest = (conversationReference) => {
  const conversation = conversations.find(
    (item) =>
      item?.localKey === conversationReference ||
      item?.id === conversationReference
  );

  if (!conversation) return false;

  setDeleteChatId(conversation.id);
  return true;
};

const filteredProjectPickerProjects = useMemo(() => {
  if (!projectPickerState) return [];

  const normalizedQuery = projectPickerQuery.trim().toLowerCase();
  if (!normalizedQuery) return projectPickerState.projects;

  return projectPickerState.projects.filter((project) => {
    const projectName = String(project?.name || "").toLowerCase();
    const projectBrief = String(project?.brief || "").toLowerCase();
    return projectName.includes(normalizedQuery) || projectBrief.includes(normalizedQuery);
  });
}, [projectPickerQuery, projectPickerState]);

const closeProjectPicker = () => {
  projectPickerRequestIdRef.current += 1;
  setProjectPickerState(null);
  setProjectPickerQuery("");
  setIsProjectPickerLoading(false);
};

const ensureConversationReadyForProject = async (conversation) => {
  if (!conversation) return null;

  const nextLocalKey =
    String(conversation.localKey || "").trim() || createProjectLinkId();

  if (typeof conversation.id === "string") {
    if (!conversation.localKey) {
      setConversations((prev) =>
        prev.map((item) =>
          item.id === conversation.id
            ? {
                ...item,
                localKey: nextLocalKey,
              }
            : item
        )
      );
    }

    return {
      conversationId: conversation.id,
      localKey: nextLocalKey,
    };
  }

  const remoteConversation = await ensureConversationExistsRemotely({
    draftId: conversation.id,
    title:
      String(conversation.title || DEFAULT_CONVERSATION_TITLE).trim() ||
      DEFAULT_CONVERSATION_TITLE,
    mode: conversation.mode || "chat",
  });

  if (!remoteConversation?.id || typeof remoteConversation.id !== "string") {
    return null;
  }

  setConversations((prev) =>
    prev.map((item) =>
      item.id === conversation.id
        ? {
            ...item,
            id: remoteConversation.id,
            mode: remoteConversation.mode || item.mode || "chat",
            localKey: nextLocalKey,
          }
        : item
    )
  );

  if (activeId === conversation.id) {
    setActiveId(remoteConversation.id);
  }

  return {
    conversationId: remoteConversation.id,
    localKey: nextLocalKey,
  };
};

const getConversationProjectMatch = (conversation) =>
  findConversationProjectMatch(readStoredProjectsIndex(), {
    conversationId: conversation?.id ?? null,
    conversationRefId: conversation?.localKey || null,
  });

const chatMatchesConversationReference = (chat, { conversationId, conversationRefId }) => {
  if (conversationId != null && chat?.conversationId === conversationId) return true;
  if (conversationRefId && chat?.conversationRefId === conversationRefId) return true;
  return false;
};

const writeOptimisticConversationProjectAssignment = ({
  projects,
  projectId,
  conversation,
  conversationRefId,
  projectChatId,
  projectName,
}) => {
  const updatedAt = new Date().toISOString();
  const conversationId = typeof conversation?.id === "string" ? conversation.id : null;
  const chatTitle =
    String(conversation?.title || DEFAULT_CONVERSATION_TITLE).trim() || DEFAULT_CONVERSATION_TITLE;
  const chatMessages = Array.isArray(conversation?.messages) ? conversation.messages : [];

  return writeStoredProjectsIndex(
    (Array.isArray(projects) ? projects : []).map((project) => {
      const existingChats = Array.isArray(project?.chats) ? project.chats : [];
      const remainingChats = existingChats.filter(
        (chat) =>
          !chatMatchesConversationReference(chat, {
            conversationId,
            conversationRefId,
          })
      );

      if (project?.id !== projectId) {
        const nextActiveChatId =
          project?.activeChatId && remainingChats.some((chat) => chat.id === project.activeChatId)
            ? project.activeChatId
            : remainingChats[0]?.id || null;

        if (remainingChats.length === existingChats.length && nextActiveChatId === project?.activeChatId) {
          return project;
        }

        return {
          ...project,
          chats: remainingChats,
          chatsCount: remainingChats.length,
          activeChatId: nextActiveChatId,
          updatedAt,
        };
      }

      const nextChat = {
        id: projectChatId,
        title: chatTitle,
        messages: chatMessages,
        conversationId,
        conversationRefId,
        updatedAt,
      };
      const nextChats = [nextChat, ...remainingChats];

      return {
        ...project,
        name: projectName || project?.name || "",
        chats: nextChats,
        chatsCount: nextChats.length,
        activeChatId: projectChatId,
        updatedAt,
      };
    })
  );
};

const writeOptimisticConversationProjectRemoval = ({
  projects,
  conversation,
}) => {
  const updatedAt = new Date().toISOString();
  const conversationId = typeof conversation?.id === "string" ? conversation.id : null;
  const conversationRefId = String(conversation?.localKey || "").trim() || null;

  return writeStoredProjectsIndex(
    (Array.isArray(projects) ? projects : []).map((project) => {
      const existingChats = Array.isArray(project?.chats) ? project.chats : [];
      const nextChats = existingChats.filter(
        (chat) =>
          !chatMatchesConversationReference(chat, {
            conversationId,
            conversationRefId,
          })
      );

      if (nextChats.length === existingChats.length) {
        return project;
      }

      const nextActiveChatId =
        project?.activeChatId && nextChats.some((chat) => chat.id === project.activeChatId)
          ? project.activeChatId
          : nextChats[0]?.id || null;

      return {
        ...project,
        chats: nextChats,
        chatsCount: nextChats.length,
        activeChatId: nextActiveChatId,
        updatedAt,
      };
    })
  );
};

const openConversationProjectPicker = async ({ conversation, mode, projectMatch = null }) => {
  if (!conversation) return;
  if (!accessToken) {
    showGlobalToast("Log in to use projects.");
    openAuth?.("login");
    return;
  }

  const sourceProjectId = projectMatch?.project?.id || null;
  const sourceProjectName = projectMatch?.project?.name || "";
  const requestId = projectPickerRequestIdRef.current + 1;
  projectPickerRequestIdRef.current = requestId;
  const allProjects = sortProjectTargets(readStoredProjectsIndex());
  const nextProjects =
    mode === "move" && sourceProjectId
      ? allProjects.filter((project) => project?.id !== sourceProjectId)
      : allProjects;

  setProjectPickerQuery("");
  setProjectPickerState({
    conversationId: conversation.id,
    mode,
    sourceProjectId,
    sourceProjectName,
    projects: nextProjects,
  });
  setIsProjectPickerLoading(allProjects.length === 0);
  setOpenMenuId(null);
  setOpenMenuProjectMatch(null);

  if (allProjects.length > 0) return;

  try {
    const remoteProjects = sortProjectTargets(await loadProjectsFromApi());
    if (projectPickerRequestIdRef.current !== requestId) return;
    const nextRemoteProjects =
      mode === "move" && sourceProjectId
        ? remoteProjects.filter((project) => project?.id !== sourceProjectId)
        : remoteProjects;

    setProjectPickerState((current) => {
      if (
        !current ||
        current.conversationId !== conversation.id ||
        current.mode !== mode ||
        current.sourceProjectId !== sourceProjectId
      ) {
        return current;
      }

      return {
        ...current,
        sourceProjectName,
        projects: nextRemoteProjects,
      };
    });
  } catch (error) {
    if (projectPickerRequestIdRef.current !== requestId) return;
    console.error("Erro a carregar projetos para o picker:", error);
  } finally {
    if (projectPickerRequestIdRef.current === requestId) {
      setIsProjectPickerLoading(false);
    }
  }
};

const handleAttachConversationToProject = (conversation) => {
  void openConversationProjectPicker({
    conversation,
    mode: "add",
  });
};

const handleMoveConversationToProject = (conversation, projectMatch) => {
  void openConversationProjectPicker({
    conversation,
    mode: "move",
    projectMatch,
  });
};

const handleRemoveConversationFromProject = async (conversation, projectMatchOverride = null) => {
  if (!conversation) return;

  const projectMatch = projectMatchOverride || getConversationProjectMatch(conversation);
  if (!projectMatch?.project?.id || !projectMatch?.chat?.id) {
    setOpenMenuId(null);
    setOpenMenuProjectMatch(null);
    return;
  }

  const previousProjectsSnapshot = readStoredProjectsIndex();

  setConversations((prev) =>
    prev.map((item) =>
      item.id === conversation.id
        ? {
            ...item,
            projectId: null,
            projectName: "",
            projectChatId: null,
          }
        : item
    )
  );
  writeOptimisticConversationProjectRemoval({
    projects: previousProjectsSnapshot,
    conversation,
  });

  setOpenMenuId(null);
  setOpenMenuProjectMatch(null);

  try {
    await removeConversationFromProjectRequest({
      projectId: projectMatch.project.id,
      projectChatId: projectMatch.chat.id,
    });
    void loadProjectsFromApi().catch(() => {});
  } catch (error) {
    console.error("Erro a remover conversa do projeto:", error);
    setConversations((prev) =>
      prev.map((item) =>
        item.id === conversation.id
          ? {
              ...item,
              projectId: projectMatch.project.id,
              projectName: projectMatch.project.name || "",
              projectChatId: projectMatch.chat.id,
            }
          : item
      )
    );
    writeStoredProjectsIndex(previousProjectsSnapshot);
    showGlobalToast("Ocorreu um erro. Tenta novamente.");
  }
};

const handleSelectProjectForConversation = async (projectId) => {
  if (!projectPickerState?.conversationId || !projectId) return;

  const conversation =
    conversations.find((item) => item.id === projectPickerState.conversationId) || null;
  if (!conversation) {
    closeProjectPicker();
    return;
  }
  const pickerStateSnapshot = projectPickerState;
  const selectedProject =
    pickerStateSnapshot.projects.find((project) => project?.id === projectId) ||
    readStoredProjectsIndex().find((project) => project?.id === projectId) ||
    null;
  if (!selectedProject) {
    closeProjectPicker();
    return;
  }

  const previousProjectsSnapshot = readStoredProjectsIndex();
  const previousProjectMatch =
    findConversationProjectMatch(previousProjectsSnapshot, {
      conversationId: conversation?.id ?? null,
      conversationRefId: conversation?.localKey || null,
    }) || null;
  const nextLocalKey =
    String(conversation.localKey || "").trim() || createProjectLinkId();
  const optimisticProjectChatId = createProjectLinkId();

  setConversations((prev) =>
    prev.map((item) =>
      item.id === conversation.id
        ? {
            ...item,
            localKey: nextLocalKey,
            projectId,
            projectName: selectedProject.name || "",
            projectChatId: optimisticProjectChatId,
          }
        : item
    )
  );

  writeOptimisticConversationProjectAssignment({
    projects: previousProjectsSnapshot,
    projectId,
    conversation: {
      ...conversation,
      localKey: nextLocalKey,
    },
    conversationRefId: nextLocalKey,
    projectChatId: optimisticProjectChatId,
    projectName: selectedProject.name || "",
  });

  closeProjectPicker();

  try {
    const preparedConversation = await ensureConversationReadyForProject({
      ...conversation,
      localKey: nextLocalKey,
    });
    if (!preparedConversation?.conversationId) {
      throw new Error("PROJECT_ATTACH_PREPARE_FAILED");
    }

    const result = await syncConversationProjectLink({
      conversationId: preparedConversation.conversationId,
      draftId: typeof conversation.id === "string" ? null : conversation.id,
      localKey: preparedConversation.localKey || nextLocalKey,
      projectId,
      projectName: selectedProject.name || "",
      projectChatId: null,
    });

    setConversations((prev) =>
      prev.map((item) => {
        const matchesId =
          item.id === conversation.id || item.id === preparedConversation.conversationId;
        const matchesLocalKey =
          (preparedConversation.localKey || nextLocalKey) &&
          item.localKey === (preparedConversation.localKey || nextLocalKey);

        if (!matchesId && !matchesLocalKey) return item;

        return {
          ...item,
          id:
            typeof item.id === "string"
              ? item.id
              : preparedConversation.conversationId,
          localKey: preparedConversation.localKey || nextLocalKey,
          projectId: result?.projectId || projectId,
          projectName: result?.projectName || selectedProject.name || "",
          projectChatId: result?.projectChatId || item.projectChatId || null,
        };
      })
    );
  } catch (error) {
    console.error("Erro a associar conversa ao projeto:", error);

    setConversations((prev) =>
      prev.map((item) => {
        const matchesId = item.id === conversation.id;
        const matchesLocalKey = nextLocalKey && item.localKey === nextLocalKey;

        if (!matchesId && !matchesLocalKey) return item;

        return {
          ...item,
          localKey: nextLocalKey,
          projectId: previousProjectMatch?.project?.id || null,
          projectName: previousProjectMatch?.project?.name || "",
          projectChatId: previousProjectMatch?.chat?.id || null,
        };
      })
    );

    writeStoredProjectsIndex(previousProjectsSnapshot);
    showGlobalToast("Ocorreu um erro. Tenta novamente.");
  }
};

const handleConfirmDeleteChat = async () => {
  if (!deleteChatId) return;

  const idToDelete = deleteChatId;
  const conversationToDelete =
    conversations.find((conversation) => conversation.id === idToDelete) || null;
  const previousProjectsSnapshot = readStoredProjectsIndex();

  if (conversationToDelete) {
    writeOptimisticConversationProjectRemoval({
      projects: previousProjectsSnapshot,
      conversation: conversationToDelete,
    });
  }

  void deleteRemoteConversation(idToDelete);

  const remaining = conversations.filter((c) => c.id !== idToDelete);
  setConversations(remaining);
  clearCreativeEditTargetForConversation(idToDelete);

  if (remaining.length === 0) {
    setActiveId(null);
    if (activeSection === "creative") handleNewCreativeStudioChat();
    else handleNewChat();
  } else if (idToDelete === activeId) {
    setActiveId(remaining[0].id);
  }

  setDeleteChatId(null);
  setOpenMenuId(null);
};

  const formatBytes = (bytes) => {
    if (!bytes && bytes !== 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    let v = bytes;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  };

  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    if (incoming.length === 0) return;

    setAttachments((prev) => {
      const remaining = Math.max(0, messageAttachmentLimit - prev.length);
      if (remaining <= 0) {
        showGlobalToast(`This plan allows up to ${messageAttachmentLimit} attachment${messageAttachmentLimit === 1 ? "" : "s"} per message.`);
        return prev;
      }

      const slice = incoming.slice(0, Math.max(0, remaining));
      if (slice.length < incoming.length) {
        showGlobalToast(`You can attach up to ${messageAttachmentLimit} file${messageAttachmentLimit === 1 ? "" : "s"} per message on this plan.`);
      }

      const mapped = slice.map((file) => {
        const isImage = file.type?.startsWith("image/");
        const isVideo = file.type?.startsWith("video/");
        const previewUrl = isImage || isVideo ? URL.createObjectURL(file) : null;

        return {
          id: (typeof crypto !== "undefined" && crypto.randomUUID)
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`,
          file,
          name: file.name,
          size: file.size,
          type: file.type,
          isImage,
          isVideo,
          previewUrl,
        };
      });

      return [...prev, ...mapped];
    });

    // permitir re-selecionar o mesmo ficheiro
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (id) => {
    setAttachments((prev) => {
      const item = prev.find((x) => x.id === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((x) => x.id !== id);
    });
  };

  const clearAttachments = () => {
    setAttachments((prev) => {
      prev.forEach((x) => {
        if (x.previewUrl) URL.revokeObjectURL(x.previewUrl);
      });
      return [];
    });
  };

  const {
    isDragActive: isComposerFileDragActive,
    dropTargetProps: composerFileDropProps,
  } = useFileDropTarget({
    onFiles: addFiles,
    disabled: !activeConversation,
  });

  const handleComposerPaste = async (event) => {
    const files = await extractTransferFiles(event.clipboardData);
    if (files.length === 0) return;

    event.preventDefault();
    addFiles(files);
  };

  const clearSupportFiles = () => {
    setSupportFiles([]);
    if (supportFileInputRef.current) supportFileInputRef.current.value = "";
  };

  const closeSupportModal = () => {
    setSupportOpen(false);
    setSupportMessage("");
    setSupportSubmitting(false);
    clearSupportFiles();
  };

  const addSupportFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    if (incoming.length === 0) return;

    setSupportFiles((prev) => {
      const next = [...prev];
      let totalBytes = next.reduce((sum, file) => sum + Number(file.size || 0), 0);

      for (const file of incoming) {
        if (next.length >= SUPPORT_MAX_FILES) {
          showGlobalToast(`You can attach up to ${SUPPORT_MAX_FILES} files.`);
          break;
        }
        if (file.size > SUPPORT_MAX_FILE_SIZE_BYTES) {
          showGlobalToast(`${file.name} is larger than 5 MB.`);
          continue;
        }
        if (totalBytes + file.size > SUPPORT_MAX_TOTAL_BYTES) {
          showGlobalToast("Attachments are too large in total.");
          continue;
        }
        totalBytes += file.size;
        next.push(file);
      }

      return next;
    });

    if (supportFileInputRef.current) supportFileInputRef.current.value = "";
  };

  const removeSupportFile = (index) => {
    setSupportFiles((prev) => prev.filter((_, i) => i !== index));
    if (supportFileInputRef.current) supportFileInputRef.current.value = "";
  };

  const readFileAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(r.error || new Error("FILE_READ_ERROR"));
      r.readAsDataURL(file);
    });

  const readBlobAsDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(r.error || new Error("BLOB_READ_ERROR"));
      r.readAsDataURL(blob);
    });

  const submitSupportRequest = async () => {
    const message = String(supportMessage || "").trim();
    if (message.length === 0 || supportSubmitting) return;

    setSupportSubmitting(true);
    try {
      const attachmentsPayload = await Promise.all(
        supportFiles.map(async (file) => ({
          name: file.name,
          type: file.type,
          size: file.size,
          dataUrl: await readFileAsDataUrl(file),
        }))
      );

      await api.post("/support", {
        message,
        attachments: attachmentsPayload,
        reporter: {
          email: user?.email || undefined,
          name: user?.name || undefined,
        },
      });

      closeSupportModal();
      showGlobalToast("Support request sent.");
    } catch (err) {
      const msg = String(err?.message || "");
      console.error("[support] submit failed", err);
      if (msg === "SUPPORT_ATTACHMENT_TOO_LARGE") {
        showGlobalToast("One attachment is too large.");
      } else if (msg === "SUPPORT_ATTACHMENTS_TOO_LARGE") {
        showGlobalToast("Attachments are too large in total.");
      } else {
        showGlobalToast(`Support error: ${msg || "REQUEST_FAILED"}`);
      }
      setSupportSubmitting(false);
    }
  };

  const readImageAsScaledDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const dataUrl = String(r.result || "");
        const img = new Image();
        img.onload = () => {
          try {
            const maxSide = 1280;
            const w0 = img.naturalWidth || img.width || 0;
            const h0 = img.naturalHeight || img.height || 0;
            if (!w0 || !h0) return resolve(dataUrl);

            const scale = Math.min(1, maxSide / Math.max(w0, h0));
            const w = Math.max(1, Math.round(w0 * scale));
            const h = Math.max(1, Math.round(h0 * scale));

            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            if (!ctx) return resolve(dataUrl);
            ctx.drawImage(img, 0, 0, w, h);

            // Use JPEG to shrink payload; Gemini/OpenAI/Claude accept it fine.
            const out = canvas.toDataURL("image/jpeg", 0.85);
            return resolve(out || dataUrl);
          } catch {
            return resolve(dataUrl);
          }
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      };
      r.onerror = () => reject(r.error || new Error("FILE_READ_ERROR"));
      r.readAsDataURL(file);
    });

  const readFileAsText = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(r.error || new Error("FILE_READ_ERROR"));
      r.readAsText(file);
    });

  const isTextLikeFile = (file) => {
    const t = String(file?.type || "");
    if (t.startsWith("text/")) return true;
    const name = String(file?.name || "");
    const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
    return [
      "txt",
      "md",
      "markdown",
      "json",
      "csv",
      "tsv",
      "js",
      "ts",
      "jsx",
      "tsx",
      "py",
      "java",
      "c",
      "cpp",
      "cs",
      "go",
      "rs",
      "php",
      "rb",
      "sql",
      "yaml",
      "yml",
      "html",
      "css",
      "xml",
    ].includes(ext);
  };

  const buildUserContentForAi = async ({ text, sentAttachments, modelId, webSearchEnabled }) => {
    const MAX_IMAGES = 10;
    const MAX_IMAGE_BYTES = 25_000_000; // raw bytes (we will downscale before sending)
    const MAX_PDF_BYTES = 6_000_000;
    const MAX_TEXT_FILE_CHARS = 12_000;
    const MAX_TOTAL_TEXT_CHARS = 24_000;

    const parts = [];
    if (text) parts.push({ type: "text", text });

    let imagesUsed = 0;
    let totalTextUsed = text ? text.length : 0;

    for (const a of sentAttachments || []) {
      const f = a?.file;
      if (!f) continue;

      if (a.isImage) {
        if (imagesUsed >= MAX_IMAGES) continue;
        if (typeof f.size === "number" && f.size > MAX_IMAGE_BYTES) {
          parts.push({
            type: "text",
            text: `\n\n[Imagem demasiado grande para analisar: ${a.name} (${formatBytes(a.size)})]`,
          });
          continue;
        }

        try {
          const dataUrl = await readImageAsScaledDataUrl(f);
          if (dataUrl) {
            parts.push({ type: "image_url", image_url: { url: dataUrl } });
            imagesUsed += 1;
          }
        } catch {
          parts.push({
            type: "text",
            text: `\n\n[Erro a ler imagem: ${a.name}]`,
          });
        }

        continue;
      }

      const name = String(a.name || f.name || "");
      const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
      const isPdf = String(f.type || "") === "application/pdf" || ext === "pdf";
      if (isPdf) {
        if (typeof f.size === "number" && f.size > MAX_PDF_BYTES) {
          parts.push({
            type: "text",
            text: `\n\n[PDF demasiado grande para analisar: ${a.name} (${formatBytes(a.size)})]`,
          });
          continue;
        }
        try {
          const dataUrl = await readFileAsDataUrl(f);
          if (dataUrl) {
            parts.push({
              type: "file",
              file: {
                url: dataUrl,
                name: a.name,
                mimeType: f.type || "application/pdf",
              },
            });
            continue;
          }
        } catch {
          parts.push({
            type: "text",
            text: `\n\n[Erro a ler PDF: ${a.name}]`,
          });
          continue;
        }
      }

      if (isTextLikeFile(f)) {
        try {
          const raw = await readFileAsText(f);
          const remaining = Math.max(0, MAX_TOTAL_TEXT_CHARS - totalTextUsed);
          if (remaining <= 0) continue;

          const clipped = raw.slice(0, Math.min(MAX_TEXT_FILE_CHARS, remaining));
          totalTextUsed += clipped.length;

          parts.push({
            type: "text",
            text:
              `\n\nFicheiro: ${a.name}\n` +
              "```text\n" +
              clipped +
              (raw.length > clipped.length ? "\n...[truncado]" : "") +
              "\n```",
          });
        } catch {
          parts.push({
            type: "text",
            text: `\n\n[Ficheiro anexado (nao foi possivel ler): ${a.name} (${formatBytes(a.size)})]`,
          });
        }
        continue;
      }

      parts.push({
        type: "text",
        text: `\n\n[Ficheiro anexado: ${a.name} (${formatBytes(a.size)}${a.type ? `, ${a.type}` : ""})]`,
      });
    }

    // Keep backwards compatibility when the message is just plain text.
    if (parts.length === 1 && parts[0]?.type === "text") return parts[0].text;
    return parts;
  };

const sendConversationMessage = async ({
  customText,
  conversationId = activeId,
  conversationOverride = activeConversation,
  attachmentsOverride = attachments,
  sectionOverride = activeSection,
  webSearchEnabledOverride = webSearchEnabled,
  reasoningEnabledOverride = reasoningEnabled,
  resetComposer = true,
  shouldScrollAfterSend = true,
}) => {
  const extractCreativeAssistantMedia = (message, expectedType = "image") => {
    if (!message || message.role !== "assistant") return null;

    const attachment = Array.isArray(message.attachments)
      ? message.attachments.find((item) =>
          expectedType === "video"
            ? Boolean(item?.isVideo) || String(item?.type || "").startsWith("video/")
            : expectedType === "audio"
              ? Boolean(item?.isAudio) || String(item?.type || "").startsWith("audio/")
              : Boolean(item?.isImage) || String(item?.type || "").startsWith("image/")
        )
      : null;

    const attachmentUrl =
      (typeof attachment?.url === "string" && attachment.url) ||
      (typeof attachment?.previewUrl === "string" && attachment.previewUrl) ||
      null;

    if (attachmentUrl) {
      return {
        url: attachmentUrl,
        mediaType: expectedType,
        message,
      };
    }

    const contentUrl =
      typeof message.content === "string" ? message.content.match(/https?:\/\/\S+/)?.[0] ?? null : null;
    if (!contentUrl) return null;

    return {
      url: contentUrl,
      mediaType: expectedType,
      message,
    };
  };

  const waitForCreativeAssistantResult = async ({ conversationId, expectedType = "image", timeoutMs = 240000 }) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      try {
        const out = await authedRequest(`/conversations/${encodeURIComponent(conversationId)}`);
        const remoteMessages = Array.isArray(out?.conversation?.messages)
          ? out.conversation.messages.map((message) => normalizePersistedConversationMessage(message))
          : [];
        for (let idx = remoteMessages.length - 1; idx >= 0; idx -= 1) {
          const found = extractCreativeAssistantMedia(remoteMessages[idx], expectedType);
          if (found?.url) return found;
        }
      } catch {
        // ignore transient poll errors
      }
      await new Promise((resolve) => window.setTimeout(resolve, 4000));
    }
    return null;
  };

  const baseConversation =
    conversationOverride ||
    conversations.find((conversation) => conversation.id === conversationId) ||
    null;
  const text = String(customText ?? input ?? "").trim();
  const draftId = conversationId ?? baseConversation?.id;
  const activeSelectedQuote =
    sectionOverride === "chat" &&
    customText == null &&
    selectedAssistantQuote &&
    selectedAssistantQuote.conversationId === draftId
      ? selectedAssistantQuote
      : null;
  const textForAi = buildQuotedUserPrompt(text, activeSelectedQuote?.text);
  const messageQuote = activeSelectedQuote
    ? {
        text: activeSelectedQuote.text,
        previewText:
          activeSelectedQuote.previewText || buildQuotedPreviewText(activeSelectedQuote.text),
      }
    : null;
  const sentAttachments = Array.isArray(attachmentsOverride) ? attachmentsOverride : [];
  const creativeEditTargetSnapshot =
    draftId != null ? creativeEditTargetsByConversation[getCreativeEditTargetKey(draftId)] || null : null;
  const startsInCreativeStudio =
    sectionOverride === "creative" ||
    baseConversation?.mode === "creative_studio";

  if ((!text && sentAttachments.length === 0) || loading || !baseConversation) return null;

  if (!accessToken) {
    showGlobalToast("Log in to use the chat.");
    openAuth?.("login");
    return null;
  }

  if (draftId == null) return null;

  if (resetComposer) {
    if (isMobile) collapseMobileComposerKeyboard();
    setInput("");
    setAttachments([]);
    setSelectedAssistantQuote((prev) =>
      prev && prev.conversationId === draftId ? null : prev
    );
    if (startsInCreativeStudio && draftId != null) {
      clearCreativeEditTargetForConversation(draftId);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  const attachmentMeta = sentAttachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    size: attachment.size,
    type: attachment.type,
    isImage: attachment.isImage,
    isVideo: attachment.isVideo,
  }));
  const newTitle =
    typeof baseConversation.title === "string" && baseConversation.title.trim()
      ? baseConversation.title
      : DEFAULT_CONVERSATION_TITLE;
  const projectContext = {
    projectId: baseConversation.projectId || null,
    projectName: baseConversation.projectName || "",
    projectChatId: baseConversation.projectChatId || null,
    localKey: String(baseConversation.localKey || "").trim(),
  };

  setLoadingHint(webSearchEnabledOverride ? "web" : null);
  setLoading(true);
  setOpenMenuId(null);

  let currentId = draftId;
  let streamRenderer = null;
  let createdMode = baseConversation.mode || "chat";
  const startsInCreativeStudioRequest =
    startsInCreativeStudio || createdMode === "creative_studio";
  const modelIdForChatRaw = baseConversation.modelId || activeModel || DEFAULT_MODEL;
  const modelIdForChat = normalizeChatModelId(modelIdForChatRaw) || DEFAULT_MODEL;

  setConversations((prev) =>
    prev.map((conv) => {
      if (conv.id !== draftId) return conv;

      const baseCount = Math.max(
        typeof conv.messageCount === "number" ? conv.messageCount : 0,
        Array.isArray(conv.messages) ? conv.messages.length : 0
      );

      return {
        ...conv,
        title: newTitle,
        updatedAt: Date.now(),
        messageCount: baseCount + 2,
        messages: [
          ...conv.messages,
          {
            role: "user",
            content: text,
            quotedSelection: messageQuote,
            attachments: sentAttachments.map((attachment) => ({
              id: attachment.id,
              name: attachment.name,
              size: attachment.size,
              type: attachment.type,
              isImage: attachment.isImage,
              isVideo: attachment.isVideo,
              previewUrl: attachment.previewUrl,
            })),
          },
          { role: "assistant", content: startsInCreativeStudioRequest ? "Generating..." : "" },
        ],
      };
    })
  );

  if (!startsInCreativeStudioRequest && !isChatModelAllowedForPlan(userPlanLabel, modelIdForChat)) {
    showModelUpgradeRequiredState({
      conversationId: draftId,
      plan: userPlanLabel,
      modelId: modelIdForChat,
    });

    void (async () => {
      const remoteConversation = await ensureConversationExistsRemotely({
        draftId,
        title: newTitle,
        mode: createdMode,
      });

      let nextConversationId = draftId;
      let nextMode = createdMode;

      if (remoteConversation.createdRemote) {
        nextConversationId = remoteConversation.id;
        nextMode = remoteConversation.mode;

        setConversations((prev) =>
          prev.map((conv) =>
            conv.id === draftId
              ? {
                  ...conv,
                  id: nextConversationId,
                  mode: nextMode,
                }
              : conv
          )
        );
        setActiveId(nextConversationId);
      }

      if (projectContext.projectId && !projectContext.projectChatId && typeof nextConversationId === "string") {
        void syncConversationProjectLink({
          conversationId: nextConversationId,
          draftId,
          localKey: projectContext.localKey,
          projectId: projectContext.projectId,
          projectName: projectContext.projectName,
        });
      }

      void persistMessage({
        conversationId: nextConversationId,
        role: "user",
        content: text,
        attachments: attachmentMeta.length > 0 ? attachmentMeta : null,
        quotedSelection: messageQuote,
      });
    })();

    setLoading(false);
    setLoadingHint(null);
    return { conversationId: draftId, blockedByPlan: true };
  }

  const remoteConversation = await ensureConversationExistsRemotely({
    draftId,
    title: newTitle,
    mode: createdMode,
  });

  if (remoteConversation.createdRemote) {
    currentId = remoteConversation.id;
    createdMode = remoteConversation.mode;

    setConversations((prev) =>
      prev.map((conv) =>
        conv.id === draftId
          ? {
              ...conv,
              id: currentId,
              mode: createdMode,
            }
          : conv
      )
    );
    setActiveId(currentId);
    moveCreativeEditTargetToConversation({ fromId: draftId, toId: currentId });
  }

  if (projectContext.projectId && !projectContext.projectChatId && typeof currentId === "string") {
    void syncConversationProjectLink({
      conversationId: currentId,
      draftId,
      localKey: projectContext.localKey,
      projectId: projectContext.projectId,
      projectName: projectContext.projectName,
    });
  }

  persistMessage({
    conversationId: currentId,
    role: "user",
    content: text,
    attachments: attachmentMeta.length > 0 ? attachmentMeta : null,
    quotedSelection: messageQuote,
  });

  if (shouldScrollAfterSend) {
    setTimeout(() => {
      scrollToBottom("smooth");
    }, 0);
  }

  const isCreativeStudio =
    sectionOverride === "creative" ||
    createdMode === "creative_studio" ||
    baseConversation.mode === "creative_studio";

  if (isCreativeStudio) {
    try {
      const selectedCreativeEditTarget =
        creativeEditTargetSnapshot ||
        (currentId != null ? creativeEditTargetsByConversation[getCreativeEditTargetKey(currentId)] || null : null);
      const firstImageAttachment = sentAttachments.find((attachment) => attachment?.isImage && attachment?.file);
      const firstVideoAttachment = sentAttachments.find((attachment) => attachment?.isVideo && attachment?.file);
      let inputImage = null;
      let inputVideo = null;
      const normalizedCreativeModel =
        typeof activeCreativeModel === "string" ? activeCreativeModel.trim() : "";
      const modelIdToUse = CREATIVE_MODEL_IDS.has(normalizedCreativeModel)
        ? normalizedCreativeModel
        : "gpt-image-1.5";
      const isCreativeVideoModel = CREATIVE_VIDEO_MODEL_IDS.has(modelIdToUse);
      const isCreativeMusicModel = CREATIVE_MUSIC_MODEL_IDS.has(modelIdToUse);

      if (selectedCreativeEditTarget?.url) {
        try {
          const selectedBlob = await apiGetBlob(selectedCreativeEditTarget.url);
          if (isCreativeVideoModel && String(selectedBlob?.type || "").startsWith("video/")) {
            inputVideo = await readBlobAsDataUrl(selectedBlob);
          } else {
            inputImage = await readBlobAsDataUrl(selectedBlob);
          }
        } catch {
          inputImage = selectedCreativeEditTarget.url;
        }
      } else if (isCreativeVideoModel && firstVideoAttachment?.file) {
        try {
          inputVideo = await readFileAsDataUrl(firstVideoAttachment.file);
        } catch {}
      } else if (firstImageAttachment?.file) {
        try {
          inputImage = await readImageAsScaledDataUrl(firstImageAttachment.file);
        } catch {}
      }

      const requestPromise = api.post(
        isCreativeVideoModel
          ? "/ai/creative/video"
          : isCreativeMusicModel
            ? "/ai/creative/music"
            : "/ai/creative/image",
        {
          modelId: modelIdToUse,
          conversationId: isCreativeVideoModel || isCreativeMusicModel ? currentId : undefined,
          prompt: text,
          size: isCreativeVideoModel ? "1280x720" : "1024x1024",
          inputImage: inputImage || undefined,
          inputVideo: inputVideo || undefined,
          attachments: attachmentMeta.length > 0 ? attachmentMeta : undefined,
        },
        {
          headers: {
            ...(authHeaders || {}),
          },
        }
      );
      const wrappedRequestPromise = requestPromise.then(
        (response) => ({ kind: "response", response }),
        (error) => ({ kind: "error", error })
      );

      const creativeResponse = isCreativeVideoModel
        ? await Promise.race([
            wrappedRequestPromise,
            new Promise((resolve) => {
              window.setTimeout(() => resolve({ kind: "timeout" }), 110000);
            }),
          ])
        : await wrappedRequestPromise;

      let out = null;
      let creativePolledResult = null;

      if (creativeResponse.kind === "timeout" && isCreativeVideoModel) {
        creativePolledResult = await Promise.race([
          wrappedRequestPromise,
          waitForCreativeAssistantResult({ conversationId: currentId, expectedType: "video" }).then((result) => ({
            kind: "polled",
            result,
          })),
        ]);
      } else {
        creativePolledResult = creativeResponse;
      }

      if (creativePolledResult?.kind === "polled" && creativePolledResult?.result?.url) {
        const mediaUrl = creativePolledResult.result.url;
        const persistedMessage = creativePolledResult.result.message || null;

        setConversations((prev) =>
          prev.map((conv) => {
            if (conv.id !== currentId) return conv;
            const msgs = Array.isArray(conv.messages) ? conv.messages.slice() : [];
            if (msgs.length === 0) return conv;
            const last = msgs[msgs.length - 1];
            if (last?.role === "assistant") {
              msgs[msgs.length - 1] = {
                ...last,
                id: persistedMessage?.id || last.id,
                content: "",
                attachments: Array.isArray(persistedMessage?.attachments) ? persistedMessage.attachments : last.attachments,
                url: mediaUrl,
                mediaUrl,
                mediaType: "video",
              };
            }
            return { ...conv, messages: msgs, updatedAt: Date.now() };
          })
        );

        setLoading(false);
        setLoadingHint(null);
        void refreshCreativeCreditsSummary();
        return { conversationId: currentId };
      }

      if (creativePolledResult?.kind === "response") {
        out = creativePolledResult.response?.data || {};
      } else if (creativePolledResult?.kind === "error") {
        throw creativePolledResult.error;
      }

      const url = isCreativeVideoModel
        ? out?.videos?.[0]?.url || out?.videos?.[0]?.dataUrl || null
        : isCreativeMusicModel
          ? out?.audios?.[0]?.url || out?.audios?.[0]?.dataUrl || null
          : out?.images?.[0]?.url || out?.images?.[0]?.dataUrl || null;
      const persistedMessage = out?.message || null;

      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id !== currentId) return conv;
          const msgs = Array.isArray(conv.messages) ? conv.messages.slice() : [];
          if (msgs.length === 0) return conv;
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant") {
            msgs[msgs.length - 1] = {
              ...last,
              content: url ? "" : (last.content || ""),
              attachments: Array.isArray(persistedMessage?.attachments) ? persistedMessage.attachments : last.attachments,
              url: url || undefined,
              mediaUrl: url || undefined,
              mediaType: url ? (isCreativeVideoModel ? "video" : isCreativeMusicModel ? "audio" : "image") : undefined,
            };
            return { ...conv, messages: msgs, updatedAt: Date.now() };
          }
          msgs.push({
            role: "assistant",
            content: url ? "" : "A gerar...",
            attachments: Array.isArray(persistedMessage?.attachments) ? persistedMessage.attachments : null,
            url,
            mediaUrl: url,
            mediaType: isCreativeVideoModel ? "video" : isCreativeMusicModel ? "audio" : "image",
          });
          return { ...conv, messages: msgs, updatedAt: Date.now() };
        })
      );

      if (!isCreativeVideoModel && !isCreativeMusicModel) {
        persistMessage({
          conversationId: currentId,
          role: "assistant",
          content: url || "Gerado.",
          attachments: null,
        });
      } else if (out?.message) {
        mergePersistedMessageIntoConversation(currentId, out.message);
      }
    } catch (e) {
      console.error(
        isCreativeVideoModel
          ? "Erro a gerar video:"
          : isCreativeMusicModel
            ? "Erro a gerar música:"
            : "Erro a gerar imagem:",
        e
      );
      const creativeLimitMeta = extractCreativeLimitErrorMeta(e, {
        plan: userPlanLabel,
      });
      if (creativeLimitMeta) {
        showCreativeLimitUpgradeRequiredState({
          conversationId: currentId,
          plan: creativeLimitMeta.plan,
          limit: creativeLimitMeta.limit,
        });
        return { conversationId: currentId, blockedByCreativeLimit: true };
      }
      showGlobalToast(isCreativeVideoModel ? "Erro a gerar video. Tenta novamente." : "Erro a gerar imagem. Tenta novamente.");
    } finally {
      if (activeStreamAbortRef.current?.signal?.aborted || activeStreamAbortRef.current) {
        activeStreamAbortRef.current = null;
      }
      setLoading(false);
      setLoadingHint(null);
      void refreshCreativeCreditsSummary();
    }

    return { conversationId: currentId };
  }

  try {
    const baseContext = Array.isArray(baseConversation.messages) ? baseConversation.messages : [];
    const userContentForAi = await buildUserContentForAi({
      text: textForAi,
      sentAttachments,
      modelId: modelIdForChat,
      webSearchEnabled: webSearchEnabledOverride,
    });

    const styleSystemPrompt = [
      "Reply in the same language as the user. If Portuguese, use PT-PT.",
      "Always format in Markdown.",
      "Use short paragraphs and lists.",
      "Prefer tables for comparisons and numeric summaries.",
      "Use fenced code blocks when relevant.",
      "Do not invent sources or links.",
    ].join("\n");

    const context = [...baseContext, { role: "user", content: userContentForAi }]
      .filter(
        (message) =>
          message &&
          (message.role === "system" || message.role === "user" || message.role === "assistant") &&
          ((typeof message.content === "string" && message.content.trim()) ||
            (Array.isArray(message.content) && message.content.length > 0))
      )
      .slice(-20)
      .map((message) => ({ role: message.role, content: message.content }));

    const contextNoSystem = context.filter((message) => message?.role !== "system");
    const lastMsg = contextNoSystem[contextNoSystem.length - 1];
    const headMsgs = contextNoSystem.slice(0, -1);
    const messagesForApi =
      lastMsg?.role === "user"
        ? [...headMsgs, { role: "system", content: styleSystemPrompt }, lastMsg]
        : [{ role: "system", content: styleSystemPrompt }, ...contextNoSystem];

    const selectedModel =
      modelIdForChat && modelIdForChat !== "__best__" ? modelIdForChat : undefined;
    const selectionMode = selectedModel ? "manual" : "auto";

    const streamController = new AbortController();
    activeStreamAbortRef.current = streamController;

    const res = await apiStream("/ai/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeaders || {}),
      },
      signal: streamController.signal,
      body: JSON.stringify({
        conversationId: typeof currentId === "string" ? currentId : undefined,
        projectId: projectContext.projectId || undefined,
        messages:
          messagesForApi.length > 0
            ? messagesForApi
            : [{ role: "system", content: styleSystemPrompt }, { role: "user", content: userContentForAi }],
        selectedModel,
        selectionMode,
        routingText: text || undefined,
        webSearchEnabled: webSearchEnabledOverride,
        reasoningEnabled: reasoningEnabledOverride,
      }),
    });

    if (!res.ok || !res.body) {
      const bodyText = await res.text().catch(() => "");
      throw new Error(`AI_HTTP_${res.status}: ${bodyText.slice(0, 500)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    let full = "";
    let doneMeta = null;
    let sawDone = false;
    streamRenderer = createAssistantStreamRenderer(currentId);

    const parseEventBlock = (block) => {
      const lines = String(block || "").split("\n");
      let eventName = "message";
      const dataLines = [];

      for (const line of lines) {
        const value = String(line || "").trimEnd();
        if (!value) continue;
        if (value.startsWith("event:")) eventName = value.slice(6).trim();
        if (value.startsWith("data:")) dataLines.push(value.slice(5).trimStart());
      }

      const dataRaw = dataLines.join("\n");
      let data = null;
      try {
        data = dataRaw ? JSON.parse(dataRaw) : null;
      } catch {
        data = { raw: dataRaw };
      }

      return { eventName, data };
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() || "";

      for (const block of parts) {
        const { eventName, data } = parseEventBlock(block);

        if (eventName === "delta") {
          const delta = data?.text;
          if (typeof delta === "string" && delta.length > 0) {
            full += delta;
            streamRenderer.push(delta);
          }
        }

        if (eventName === "conversation") {
          const conversation = data?.conversation;
          if (
            conversation?.id === currentId &&
            typeof conversation?.title === "string" &&
            conversation.title.trim()
          ) {
            setConversations((prev) =>
              prev.map((item) =>
                item.id === currentId
                  ? {
                      ...item,
                      title: conversation.title,
                      updatedAt: conversation.updatedAt ? Date.parse(conversation.updatedAt) : item.updatedAt,
                    }
                  : item
              )
            );
          }
        }

        if (eventName === "artifact") {
          const artifact = data?.artifact;
          if (artifact?.type) {
            setLastAssistantArtifactIntent(currentId, artifact.type);
          }
        }

        if (eventName === "error") {
          const msg = data?.error || "AI_ERROR";
          throw Object.assign(new Error(String(msg)), { details: data });
        }

        if (eventName === "done") {
          doneMeta = data || null;
          sawDone = true;
          break;
        }
      }

      if (sawDone) break;
    }

    if (sawDone) {
      try {
        await reader.cancel().catch(() => {});
      } catch {}
    }

    const artifact = doneMeta?.artifact || null;

    if (!full.trim() && !artifact) {
      full = "Erro: resposta vazia do provider.";
      streamRenderer?.flush(full);
    }

    const remoteModel = String(doneMeta?.remoteModel || "").trim();
    const fallbackFrom = String(doneMeta?.fallbackFrom || "").trim();
    const sources = Array.isArray(doneMeta?.sources) ? doneMeta.sources : null;
    const webSearchUsed =
      Boolean(doneMeta?.webSearch) && Array.isArray(sources) && sources.length > 0;

    if (
      webSearchUsed &&
      (remoteModel === "gpt-5-mini" ||
        fallbackFrom === "gpt-5-mini" ||
        remoteModel === "gpt-5-nano" ||
        fallbackFrom === "gpt-5-nano")
    ) {
      const cleaned = stripSourcesSection(full);
      const sec = buildSourcesSection(sources, language);
      full = sec ? `${cleaned.trimEnd()}\n\n${sec}\n` : cleaned;
    }

    full = full.trim() ? normalizeAssistantMarkdown(full) : "";
    if (artifact) {
      streamRenderer?.stop();
      setLastAssistantArtifact(currentId, artifact, full);
    } else {
      streamRenderer?.flush(full);
    }

    persistMessage({
      conversationId: currentId,
      role: "assistant",
      content: full,
      attachments: null,
      artifact,
    });
  } catch (e) {
    const aborted = e?.name === "AbortError" || /abort/i.test(String(e?.message || ""));
    if (aborted) {
      return { conversationId: currentId, aborted: true };
    }

    const raw = e?.message ? String(e.message) : "Erro ao gerar resposta.";
    const isUnauthorized =
      e?.status === 401 ||
      /AI_HTTP_401\b/.test(raw) ||
      /UNAUTHORIZED/i.test(raw);
    const msg = isUnauthorized ? "Log in to continue." : raw;

    if (isUnauthorized) {
      showGlobalToast("Invalid/expired session. Log in again.");
      openAuth?.("login");
    }

    const modelUpgradeMeta = extractModelPlanUpgradeErrorMeta(e, {
      plan: userPlanLabel,
      modelId: modelIdForChat,
    });
    if (modelUpgradeMeta) {
      showModelUpgradeRequiredState({
        conversationId: currentId,
        plan: modelUpgradeMeta.plan,
        modelId: modelUpgradeMeta.modelId,
      });
      return { conversationId: currentId, blockedByPlan: true };
    }

    const messageLimitMeta = extractMessageLimitErrorMeta(e, {
      plan: userPlanLabel,
      limit: userPlanLabel === "FREE" ? 20 : 0,
      limitWindow: userPlanLabel === "FREE" ? "day" : "month",
    });
    if (messageLimitMeta) {
      showMessageLimitUpgradeRequiredState({
        conversationId: currentId,
        plan: messageLimitMeta.plan,
        limit: messageLimitMeta.limit,
        limitWindow: messageLimitMeta.limitWindow,
        periodEnd: messageLimitMeta.periodEnd,
      });
      return { conversationId: currentId, blockedByMessageLimit: true };
    }

    const attachmentLimitMeta = extractAttachmentLimitErrorMeta(e, {
      plan: userPlanLabel,
      limit: messageAttachmentLimit,
    });
    if (attachmentLimitMeta) {
      const friendlyMessage =
        attachmentLimitMeta.plan === "FREE"
          ? `Free plan allows up to ${attachmentLimitMeta.limit} attachments per message.`
          : `This plan allows up to ${attachmentLimitMeta.limit} attachments per message.`;

      showGlobalToast(friendlyMessage);
      streamRenderer?.stop();
      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id !== currentId) return conv;
          const msgs = Array.isArray(conv.messages) ? conv.messages.slice() : [];
          if (msgs.length > 0 && msgs[msgs.length - 1]?.role === "assistant") {
            msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: friendlyMessage };
            return { ...conv, messages: msgs, updatedAt: Date.now() };
          }
          return {
            ...conv,
            updatedAt: Date.now(),
            messages: [...msgs, { role: "assistant", content: friendlyMessage }],
          };
        })
      );
      return { conversationId: currentId, blockedByAttachmentLimit: true };
    }

    streamRenderer?.stop();
    setConversations((prev) =>
      prev.map((conv) => {
        if (conv.id !== currentId) return conv;
        const msgs = Array.isArray(conv.messages) ? conv.messages.slice() : [];
        if (msgs.length > 0 && msgs[msgs.length - 1]?.role === "assistant") {
          msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: `Erro: ${msg}` };
          return { ...conv, messages: msgs, updatedAt: Date.now() };
        }
        return {
          ...conv,
          updatedAt: Date.now(),
          messages: [...msgs, { role: "assistant", content: `Erro: ${msg}` }],
        };
      })
    );
  } finally {
    streamRenderer?.stop();
    if (activeStreamAbortRef.current?.signal?.aborted || activeStreamAbortRef.current) {
      activeStreamAbortRef.current = null;
    }
    setLoading(false);
    setLoadingHint(null);
  }

  return { conversationId: currentId };
};

const legacyHandleSend = async (customText) => {
  const text = (customText ?? input).trim();
  if (( !text && attachments.length === 0 ) || loading || !activeConversation) return;

  // Backend requires auth for /ai/*; guide user to login instead of showing raw 401.
  if (!accessToken) {
    showGlobalToast("Log in to use the chat.");
    openAuth?.("login");
    return;
  }


    const draftId = activeId;
    const activeSelectedQuote =
      activeSection === "chat" &&
      customText == null &&
      selectedAssistantQuote &&
      selectedAssistantQuote.conversationId === draftId
        ? selectedAssistantQuote
        : null;
    const textForAi = buildQuotedUserPrompt(text, activeSelectedQuote?.text);
    const messageQuote = activeSelectedQuote
      ? {
          text: activeSelectedQuote.text,
          previewText:
            activeSelectedQuote.previewText || buildQuotedPreviewText(activeSelectedQuote.text),
        }
      : null;
    const sentAttachments = attachments; // S& snapshot para enviar

    if (isMobile) collapseMobileComposerKeyboard();

    const attachmentMeta = sentAttachments.map((a) => ({
      id: a.id,
      name: a.name,
      size: a.size,
      type: a.type,
      isImage: a.isImage,
      isVideo: a.isVideo,
    }));

    const remoteCount = typeof activeConversation.messageCount === "number" ? activeConversation.messageCount : 0;
    const isBrandNewConversation = activeConversation.messages.length === 0 && remoteCount === 0;
    const newTitle =
      typeof activeConversation.title === "string" && activeConversation.title.trim()
        ? activeConversation.title
        : DEFAULT_CONVERSATION_TITLE;

    // reset composer
    setInput("");
    setAttachments([]);
    setSelectedAssistantQuote((prev) =>
      prev && prev.conversationId === draftId ? null : prev
    );
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setLoadingHint(webSearchEnabled ? "web" : null);
    setLoading(true);
    setOpenMenuId(null);

    let currentId = draftId;
    let streamRenderer = null;
    let createdRemote = false;
    let createdMode = activeConversation.mode || "chat";
    const startsInCreativeStudio =
      activeSection === "creative" || activeConversation?.mode === "creative_studio";
    // 1) Optimistic UI: push user msg immediately.
    // This prevents a brief empty/black thread while the backend creates the conversation.
    setConversations((prev) =>
      prev.map((conv) => {
        if (conv.id !== draftId) return conv;

        const baseCount = Math.max(
          typeof conv.messageCount === "number" ? conv.messageCount : 0,
          Array.isArray(conv.messages) ? conv.messages.length : 0
        );

        return {
          ...conv,
          title: newTitle,
          updatedAt: Date.now(),
          messageCount: baseCount + 2,
          messages: [
            ...conv.messages,
            {
              role: "user",
              content: text,
              quotedSelection: messageQuote,
              attachments: sentAttachments.map((a) => ({
                id: a.id,
                name: a.name,
                size: a.size,
                type: a.type,
                isImage: a.isImage,
                isVideo: a.isVideo,
                previewUrl: a.previewUrl, // só para UI local
              })),
            },
            { role: "assistant", content: startsInCreativeStudio ? "Generating..." : "" },
          ],
        };
      })
    );

    // Logged-in users: create a DB conversation only when sending the 1st message.
    if (user && accessToken && typeof draftId !== "string") {
      try {
        const out = await authedRequest("/conversations", {
          method: "POST",
          body: JSON.stringify({ title: newTitle, mode: createdMode }),
        });

        const c = out?.conversation;
        if (c?.id) {
          currentId = c.id;
          createdRemote = true;
          createdMode = c.mode || createdMode;
          loadedRemoteConversationsRef.current.add(currentId);
        } else {
          throw new Error("CONVERSATION_CREATE_FAILED");
        }
      } catch (e) {
        console.error("Erro a criar conversa no backend:", e);
        showGlobalToast("Ocorreu um erro. Tenta novamente.");
      }
    }
    // 1b) If we created the conversation remotely, remap the local draft id -> backend id.
    if (createdRemote) {
      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id !== draftId) return conv;
          return {
            ...conv,
            id: currentId,
            mode: createdMode,
          };
        })
      );
      setActiveId(currentId);
    }
// S& limpa anexos do composer APS enviar (sem revogar previewUrl)
    // Persist user message/title to backend (multi-device)
    persistMessage({
      conversationId: currentId,
      role: "user",
      content: text,
      attachments: attachmentMeta.length > 0 ? attachmentMeta : null,
      quotedSelection: messageQuote,
    });

// !️ auto-scroll APENAS quando o utilizador envia mensagem
setTimeout(() => {
  scrollToBottom("smooth");
}, 0);

    const isCreativeStudio =
      activeSection === "creative" || createdMode === "creative_studio" || activeConversation?.mode === "creative_studio";

    // 2) Creative Studio: gera imagem/vídeo (sem SSE por agora)
    if (isCreativeStudio) {
      try {

                const firstImageAttachment = (sentAttachments || []).find((a) => a && a.isImage && a.file);
        const firstVideoAttachment = (sentAttachments || []).find((a) => a && a.isVideo && a.file);
        let inputImage = null;
        let inputVideo = null;
        const normalizedCreativeModel = typeof activeCreativeModel === "string" ? activeCreativeModel.trim() : "";
        let modelIdToUse = CREATIVE_MODEL_IDS.has(normalizedCreativeModel) ? normalizedCreativeModel : "gpt-image-1.5";
        const isCreativeVideoModel = CREATIVE_VIDEO_MODEL_IDS.has(modelIdToUse);
        const isCreativeMusicModel = CREATIVE_MUSIC_MODEL_IDS.has(modelIdToUse);

        if (isCreativeVideoModel && firstVideoAttachment?.file) {
          try {
            inputVideo = await readFileAsDataUrl(firstVideoAttachment.file);
          } catch {}
        } else if (firstImageAttachment?.file) {
          try {
            inputImage = await readImageAsScaledDataUrl(firstImageAttachment.file);
          } catch {}
        }
        const res = await api.post(
          isCreativeVideoModel
            ? "/ai/creative/video"
            : isCreativeMusicModel
              ? "/ai/creative/music"
              : "/ai/creative/image",
          {
            modelId: modelIdToUse,
            prompt: text,
            size: isCreativeVideoModel ? "1280x720" : "1024x1024",
            inputImage: inputImage || undefined,
            inputVideo: inputVideo || undefined,
            attachments: attachmentMeta.length > 0 ? attachmentMeta : undefined,
          },
          {
            headers: {
              ...(authHeaders || {}),
            },
          }
        );

        const out = res?.data || {};
        // Prefer stable URLs (we persist bytes server-side) over inline data URLs.
        const url = isCreativeVideoModel
          ? out?.videos?.[0]?.url || out?.videos?.[0]?.dataUrl || null
          : isCreativeMusicModel
            ? out?.audios?.[0]?.url || out?.audios?.[0]?.dataUrl || null
            : out?.images?.[0]?.url || out?.images?.[0]?.dataUrl || null;
        const persistedMessage = out?.message || null;

        setConversations((prev) =>
          prev.map((conv) => {
            if (conv.id !== currentId) return conv;
            const msgs = Array.isArray(conv.messages) ? conv.messages.slice() : [];
            if (msgs.length === 0) return conv;
            const last = msgs[msgs.length - 1];
            if (last?.role === "assistant") {
              msgs[msgs.length - 1] = {
                ...last,
                content: url ? "" : (last.content || ""),
                attachments: Array.isArray(persistedMessage?.attachments) ? persistedMessage.attachments : last.attachments,
                url: url || undefined,
                mediaUrl: url || undefined,
                mediaType: url ? (isCreativeVideoModel ? "video" : isCreativeMusicModel ? "audio" : "image") : undefined,
              };
              return { ...conv, messages: msgs, updatedAt: Date.now() };
            }
            msgs.push({
              role: "assistant",
              content: url ? "" : "A gerar…",
              attachments: Array.isArray(persistedMessage?.attachments) ? persistedMessage.attachments : null,
              url,
              mediaUrl: url,
              mediaType: isCreativeVideoModel ? "video" : isCreativeMusicModel ? "audio" : "image",
            });
            return { ...conv, messages: msgs, updatedAt: Date.now() };
          })
        );

        // Persist only a small reference (URL) so chat history survives refresh.
        if (!isCreativeVideoModel && !isCreativeMusicModel) {
          persistMessage({
            conversationId: currentId,
            role: "assistant",
            content: url || "Gerado.",
            attachments: null,
          });
        } else if (out?.message) {
          mergePersistedMessageIntoConversation(currentId, out.message);
        }
      } catch (e) {
        console.error(isCreativeVideoModel ? "Erro a gerar video:" : "Erro a gerar imagem:", e);
        const creativeLimitMeta = extractCreativeLimitErrorMeta(e, {
          plan: userPlanLabel,
        });
        if (creativeLimitMeta) {
          showCreativeLimitUpgradeRequiredState({
            conversationId: currentId,
            plan: creativeLimitMeta.plan,
            limit: creativeLimitMeta.limit,
          });
          return;
        }
        showGlobalToast(
          isCreativeVideoModel
            ? "Erro a gerar video. Tenta novamente."
            : isCreativeMusicModel
              ? "Erro a gerar música. Tenta novamente."
              : "Erro a gerar imagem. Tenta novamente."
        );
      } finally {
        setLoading(false);
        void refreshCreativeCreditsSummary();
      }
      return;
    }

    // 2) gerar resposta via backend (/ai/chat) com streaming (SSE)
    try {
      // Contexto que enviamos ao router/modelo (ultimas N mensagens + a mensagem atual)
      const baseContext = Array.isArray(activeConversation?.messages)
        ? activeConversation.messages
        : [];

      const modelIdForChatRaw = activeConversation?.modelId || activeModel || DEFAULT_MODEL;
      const modelIdForChat = normalizeChatModelId(modelIdForChatRaw) || DEFAULT_MODEL;
      const userContentForAi = await buildUserContentForAi({
        text: textForAi,
        sentAttachments,
        modelId: modelIdForChat,
        webSearchEnabled,
      });

      const styleSystemPrompt =
        language === "pt"
          ? [
              "Responde na mesma língua do utilizador (se for português, usa PT-PT).",
              "Formata SEMPRE em Markdown.",
              "Estilo (para ficar consistente entre modelos):",
              "- Começa com 1 linha curta e simpática (sem floreados).",
              "- NÃO uses headings com # (ex.: ###). Para títulos, usa APENAS linhas em **negrito** com emoji (ex.: **📌 Dados**).",
              "- Usa listas e parágrafos curtos; evita blocos grandes de texto (máx. 2–3 frases seguidas).",
              "- Destaca conclusões e números importantes em **negrito**.",
              "- Usa bullets com '✅' para pontos-chave e '•' para listas normais.",
              "- Quando houver comparações, números, custos, latências, etc., prefere uma **tabela Markdown**.",
              "- Espaçamento: deixa sempre 1 linha em branco entre secções, listas, tabelas e parágrafos.",
              "",
              "Matemática/contas:",
              "- Mostra variáveis/assunções (em lista ou tabela).",
              "- Mostra a fórmula em texto simples e os passos do cálculo com substituição numérica.",
              "- Dá um resultado final explícito (ex.: **Resultado: X**).",
              "- Se tiver muitos números, mostra um resumo em tabela.",
              "- NÃO uses LaTeX/MathJax (nada de \\( \\), \\[ \\], \\begin{...}). Usa fórmulas em texto normal (ex.: `custo = pedidos * tokens/1000 * preço`).",
              "- Se o utilizador der números, FAZ as contas e dá valores numéricos (não fiques só por símbolos/fórmulas).",
              "- Valida as contas: re-confere multiplicações/somas e confirma unidades (% vs decimal). Se houver erro, corrige antes de responder.",
              "- Estrutura recomendada quando houver contas: **🧾 Dados** → **🧮 Cálculos** → **✅ Resultado**.",
              "",
              "Código:",
              "- Quando fizer sentido, usa blocos de código com triple backticks e linguagem (ex.: ```python).",
              "- Não mistures código inline grande; prefere blocos pequenos e claros.",
              "",
              "Fontes:",
              "- NÃO inventes fontes/links.",
              "- Só cria a secção **📚 Fontes** se tiveres URLs concretos fornecidos pelo utilizador ou por uma ferramenta.",
              "- Se o utilizador pedir 'pesquisa (web)' e não tiveres fontes, diz isso claramente e não inventes.",
              "",
              "Tom:",
              "- Empático e direto; usa emojis principalmente nos títulos (máx. 3–4 no total).",
              "- Termina com **🧭 Próximos passos** quando houver ações claras.",
            ].join("\n")
          : [
              "Reply in the same language as the user (if Portuguese, use PT-PT).",
              "ALWAYS format in Markdown.",
              "Style (keep consistent across models):",
              "- Start with a short, friendly 1-line opener (no fluff).",
              "- Do NOT use markdown headings with # (e.g., ###). For titles, use ONLY bold lines with an emoji (e.g., **📌 Inputs**).",
              "- Use lists and short paragraphs; avoid big text blocks (max 2–3 sentences in a row).",
              "- Bold key conclusions and numbers (**like this**).",
              "- Use '✅' bullets for key points and '•' for normal lists.",
              "- When there are comparisons/numbers (cost/latency/etc.), prefer a **Markdown table**.",
              "- Spacing: always leave 1 blank line between sections, lists, tables, and paragraphs.",
              "",
              "Math:",
              "- State variables/assumptions (list or table).",
              "- Show the formula in plain text and the calculation steps with numeric substitution.",
              "- Provide an explicit final line (e.g., **Result: X**).",
              "- If there are many numbers, include a compact summary table.",
              "- Do NOT use LaTeX/MathJax (no \\( \\), \\[ \\], \\begin{...}). Use plain-text formulas (e.g., `cost = requests * tokens/1000 * price`).",
              "- If the user provides numbers, DO the math and output numeric values (don’t stop at symbols/formulas).",
              "- Validate calculations: re-check multiplications/additions and units (% vs decimals). If you find a mistake, fix it before answering.",
              "- Suggested structure for math: **🧾 Inputs** → **🧮 Calculations** → **✅ Result**.",
              "",
              "Code:",
              "- Use fenced code blocks with language tags when relevant (e.g., ```python).",
              "- Keep snippets small and readable.",
              "",
              "Sources:",
              "- Do NOT invent sources/links.",
              "- Only add a **📚 Sources** section if you have concrete URLs provided by the user or a tool.",
              "- If the user asks for web research and you have no sources, say so clearly and do not fabricate.",
              "",
              "Tone:",
              "- Empathetic and direct; use emojis mainly in headings (max 3–4 total).",
              "- End with **🧭 Next steps** when actionable.",
            ].join("\n");

      const context = [...baseContext, { role: "user", content: userContentForAi }]
        .filter(
          (m) =>
            m &&
            (m.role === "system" || m.role === "user" || m.role === "assistant") &&
            ((typeof m.content === "string" && m.content.trim()) ||
              (Array.isArray(m.content) && m.content.length > 0))
        )
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content }));

      // Keep response style consistent across models (helps avoid "tone jumps" on fallback models).
      // Put the style instruction immediately before the last user message so it remains high-priority
      // even if the backend injects its own system messages at the top.
      const contextNoSystem = context.filter((m) => m?.role !== "system");
      const lastMsg = contextNoSystem[contextNoSystem.length - 1];
      const headMsgs = contextNoSystem.slice(0, -1);
      const messagesForApi =
        lastMsg?.role === "user"
          ? [...headMsgs, { role: "system", content: styleSystemPrompt }, lastMsg]
          : [{ role: "system", content: styleSystemPrompt }, ...contextNoSystem];

      const selectedModel = modelIdForChat && modelIdForChat !== "__best__" ? modelIdForChat : undefined;
      const selectionMode = selectedModel ? "manual" : "auto";

      const streamController = new AbortController();
      activeStreamAbortRef.current = streamController;

      const res = await apiStream(`/ai/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authHeaders || {}),
        },
        signal: streamController.signal,
        body: JSON.stringify({
          conversationId: typeof currentId === "string" ? currentId : undefined,
          messages:
            messagesForApi.length > 0
              ? messagesForApi
              : [{ role: "system", content: styleSystemPrompt }, { role: "user", content: userContentForAi }],
          selectedModel,
          selectionMode,
          routingText: text || undefined,
          webSearchEnabled,
          reasoningEnabled,
        }),
      });

      if (!res.ok || !res.body) {
        const bodyText = await res.text().catch(() => "");
        throw new Error(`AI_HTTP_${res.status}: ${bodyText.slice(0, 500)}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buf = "";
      let full = "";
      let doneMeta = null;
      let sawDone = false;
      streamRenderer = createAssistantStreamRenderer(currentId);

      const parseEventBlock = (block) => {
        const lines = String(block || "").split("\n");
        let eventName = "message";
        const dataLines = [];

        for (const line of lines) {
          const l = String(line || "").trimEnd();
          if (!l) continue;
          if (l.startsWith("event:")) eventName = l.slice(6).trim();
          if (l.startsWith("data:")) dataLines.push(l.slice(5).trimStart());
        }

        const dataRaw = dataLines.join("\n");
        let data = null;
        try {
          data = dataRaw ? JSON.parse(dataRaw) : null;
        } catch {
          data = { raw: dataRaw };
        }

        return { eventName, data };
      };

       while (true) {
         const { value, done } = await reader.read();
         if (done) break;

        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() || "";

         for (const block of parts) {
           const { eventName, data } = parseEventBlock(block);

          if (eventName === "delta") {
            const delta = data?.text;
            if (typeof delta === "string" && delta.length > 0) {
              full += delta;
              streamRenderer.push(delta);
            }
          }

          if (eventName === "conversation") {
            const convo = data?.conversation;
            if (convo?.id === currentId && typeof convo?.title === "string" && convo.title.trim()) {
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === currentId
                    ? {
                        ...c,
                        title: convo.title,
                        updatedAt: convo.updatedAt ? Date.parse(convo.updatedAt) : c.updatedAt,
                      }
                    : c
                )
              );
            }
          }

          if (eventName === "artifact") {
            const artifact = data?.artifact;
            if (artifact?.type) {
              setLastAssistantArtifactIntent(currentId, artifact.type);
            }
          }

          if (eventName === "error") {
            const msg = data?.error || "AI_ERROR";
            throw Object.assign(new Error(String(msg)), { details: data });
          }

           if (eventName === "done") {
             doneMeta = data || null;
             sawDone = true;
             break;
           }
         }

         if (sawDone) break;
       }

       if (sawDone) {
         try {
           // We already got the final metadata; we can stop reading the stream.
           await reader.cancel().catch(() => {});
         } catch {
           // ignore
         }
       }

      const artifact = doneMeta?.artifact || null;

       if (!full.trim() && !artifact) {
         full = "Erro: resposta vazia do provider.";
         streamRenderer?.flush(full);
       }

      // If web search was used, prefer a canonical sources section (avoid model-specific formatting).
      // We only force this behavior for Mini (and legacy Nano) to keep other models' behavior unchanged.
      const remoteModel = String(doneMeta?.remoteModel || "").trim();
      const fallbackFrom = String(doneMeta?.fallbackFrom || "").trim();
      const sources = Array.isArray(doneMeta?.sources) ? doneMeta.sources : null;
      const webSearchUsed = Boolean(doneMeta?.webSearch) && Array.isArray(sources) && sources.length > 0;

      if (
        webSearchUsed &&
        (remoteModel === "gpt-5-mini" ||
          fallbackFrom === "gpt-5-mini" ||
          remoteModel === "gpt-5-nano" ||
          fallbackFrom === "gpt-5-nano")
      ) {
        const cleaned = stripSourcesSection(full);
        const sec = buildSourcesSection(sources, language);
        full = sec ? `${cleaned.trimEnd()}\n\n${sec}\n` : cleaned;
      }

      // Normalize final assistant markdown before persisting (keeps display consistent across sessions).
      full = full.trim() ? normalizeAssistantMarkdown(full) : "";
      if (artifact) {
        streamRenderer?.stop();
        setLastAssistantArtifact(currentId, artifact, full);
      } else {
        streamRenderer?.flush(full);
      }

      // Persiste a resposta final no backend
      persistMessage({
        conversationId: currentId,
        role: "assistant",
        content: full,
        attachments: null,
        artifact,
      });
    } catch (e) {
      const aborted =
        e?.name === "AbortError" ||
        /abort/i.test(String(e?.message || ""));
      if (aborted) {
        return;
      }

      const raw = e?.message ? String(e.message) : "Erro ao gerar resposta.";
      const isUnauthorized =
        e?.status === 401 ||
        /AI_HTTP_401\b/.test(raw) ||
        /UNAUTHORIZED/i.test(raw);
      const msg = isUnauthorized ? "Log in to continue." : raw;

      if (isUnauthorized) {
        showGlobalToast("Invalid/expired session. Log in again.");
        openAuth?.("login");
      }

      streamRenderer?.stop();
      // Em erro, escreve na ultima mensagem do assistant (a que criamos vazia)
      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id !== currentId) return conv;
          const msgs = Array.isArray(conv.messages) ? conv.messages.slice() : [];
          if (msgs.length > 0 && msgs[msgs.length - 1]?.role === "assistant") {
            msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: `Erro: ${msg}` };
            return { ...conv, messages: msgs, updatedAt: Date.now() };
          }
          return {
            ...conv,
            updatedAt: Date.now(),
            messages: [...msgs, { role: "assistant", content: `Erro: ${msg}` }],
          };
        })
      );
    } finally {
      streamRenderer?.stop();
      if (activeStreamAbortRef.current?.signal?.aborted || activeStreamAbortRef.current) {
        activeStreamAbortRef.current = null;
      }
      setLoading(false);
      setLoadingHint(null);
    }

  };

  const handleSend = async (customText) => {
    await sendConversationMessage({ customText });
  };

  const onSubmit = (e) => {
    e.preventDefault();
    handleSend();
  };

  const hasMessages = !!activeConversation && activeConversation.messages.length > 0;
  const isHydratingActive = typeof activeId === "string" && loadingConversationId === activeId;
  const showThread = hasMessages || isHydratingActive || loading;

  // Mobile: reserve EXACT space for the fixed composer so the last message actions
  // (copy/like/share/try again) and "thinking/searching" lines are reachable without iOS rubber-band.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;

    const shouldMeasure = activeSection === "chat" && showThread && !isCreativeChat;

    if (!shouldMeasure) {
      root.style.removeProperty("--chat-input-h");
      setScrollDownButtonBottom(200);
      return;
    }

    const el = chatInputWrapperRef.current;
    if (!el) return;

    let rafId = 0;
    const apply = () => {
      rafId = 0;
      const h = Math.ceil(el.getBoundingClientRect().height || 0);
      if (isMobile && h > 0) {
        // Measure the fixed composer height so the scroll area can reserve just enough room.
        root.style.setProperty("--chat-input-h", `${h}px`);
      } else {
        root.style.removeProperty("--chat-input-h");
      }

      const nextBottom = Math.max(200, h + 14);
      setScrollDownButtonBottom((prev) => (prev === nextBottom ? prev : nextBottom));
    };
    const schedule = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(apply);
    };

    schedule();

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    try {
      ro?.observe(el);
    } catch {
      // ignore
    }

    const vv = window.visualViewport;
    vv?.addEventListener("resize", schedule);
    vv?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);

    return () => {
      ro?.disconnect();
      vv?.removeEventListener("resize", schedule);
      vv?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [isMobile, activeSection, showThread, isCreativeChat]);

  const composerQuotePreviewText = currentComposerQuote
    ? buildQuotedPreviewText(
        currentComposerQuote.text || currentComposerQuote.previewText,
        isMobile || isTabletViewport ? 34 : 80
      )
    : "";

  const composerQuotePreview = currentComposerQuote ? (
    <div className="composer-quote-preview" data-nosnippet>
      <div className="composer-quote-preview-icon" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 10 5 5-5 5" />
          <path d="M4 4v7a4 4 0 0 0 4 4h12" />
        </svg>
      </div>
      <div className="composer-quote-preview-text">"{composerQuotePreviewText}"</div>
      <button
        type="button"
        className="composer-quote-preview-dismiss"
        onClick={clearComposerQuote}
        aria-label="Clear quoted excerpt"
        title="Clear quoted excerpt"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  ) : null;

  const assistantSelectionActionPortal =
    activeSection === "chat" &&
    assistantSelectionAction &&
    assistantSelectionAction.conversationId === activeId &&
    typeof document !== "undefined"
      ? createPortal(
          <button
            ref={assistantSelectionBubbleRef}
            type="button"
            className="assistant-selection-action"
            style={{
              top: `${assistantSelectionAction.top}px`,
              left: `${assistantSelectionAction.left}px`,
            }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={handleAskAboutAssistantSelection}
          >
            <span className="assistant-selection-action-icon" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />
                <path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />
              </svg>
            </span>
            <span>Ask Core AI</span>
          </button>,
          document.body
        )
      : null;

  return (
    <Routes>
      <Route path="/terms" element={<LegalPage kind="terms" />} />
      <Route path="/privacy" element={<LegalPage kind="privacy" />} />
      <Route
        path="/*"
        element={
          <div
            className={`app ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${isMobile ? "is-mobile" : ""} ${
              isMobile && !sidebarCollapsed ? "mobile-sidebar-open" : ""
            }`}
          >
            {isMobile && !sidebarCollapsed && (
              <div className="mobile-backdrop" role="presentation" onClick={() => setSidebarCollapsed(true)} />
            )}
            {/* SIDEBAR */}
            <aside className="sidebar">
              {/* COLLAPSED RAIL (só + e seta) */}
              {sidebarCollapsed && (
                <div className="sidebar-rail">
                  <button
                    className="rail-btn rail-plus"
                    type="button"
                    onClick={handleNewChat}
                    aria-label="New chat"
                    title="New chat"
                  
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path
                        d="M12 5v14M5 12h14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>

                  <button
                    className="rail-btn rail-expand"
                    type="button"
                    onClick={() => setSidebarCollapsed(false)}
                    aria-label="Open sidebar"
                    title="Open sidebar"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M9 6l6 6-6 6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  

                </div>
              )}
{/* S& Toast global (canto inferior direito) */}
{globalToast && (
  <div className="global-toast" role="status" aria-live="polite">
    <span className="global-toast-check" aria-hidden="true">✓</span>
    <span className="global-toast-text">{globalToast.text}</span>
  </div>
)}
              {/* SIDEBAR NORMAL */}
              {!sidebarCollapsed && (
                <>
                  {/* HEADER: logo + botão fechar */}
                  <div className="sidebar-header">
                    <img className="sidebar-logo" src={coreLogo} alt="Core AI" />

                    <button
                      className="sidebar-collapse-btn"
                      type="button"
                      onClick={() => setSidebarCollapsed(true)}
                      aria-label="Close sidebar"
                      title="Close sidebar"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M15 6l-6 6 6 6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>

<nav className="nav">
  <div className="nav-group">
    <button
      className={`nav-btn ${activeSection === "chat" ? "active" : ""}`}
      onClick={() => {
        // se estás num creative_studio (ou noutra secção), ao clicar Chat tens de ir para o Snovo chat normal⬝
        if (activeConversation?.mode !== "chat") {
          handleNewChat();
          setDraftMode("chat");
          return;
        }

        setActiveSection("chat");
        setDraftMode("chat");
        setInput("");
      }}
    >
      <span className="nav-ico" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.25 9.75h7.5M8.25 13.5h4.5M21 12c0 4.418-4.03 8-9 8a9.77 9.77 0 01-4.39-.99L3 20l1.26-3.78A7.91 7.91 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
      </span>
      Chat
    </button>
<button
      className={`nav-btn ${activeSection === "creative" ? "active" : ""}`}
      onClick={() => {
        // abre sempre um Snovo chat⬝ do Creative Studio (hero+gradiente até 1ª msg)
        handleNewCreativeStudioChat();
      }}
    >
      <span className="nav-ico" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
</svg>
      </span>
      Creative Studio
    </button>
    <button
      className={`nav-btn ${activeSection === "projects" ? "active" : ""}`}
      onClick={() => {
        setActiveSection("projects");
        if (isMobile) setSidebarCollapsed(true);
      }}
    >
      <span className="nav-ico" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="size-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
        </svg>
      </span>
      Projects
    </button>
    <button
      className="nav-btn"
      onClick={() => {
        setSearchOpen(true);
        if (isMobile) setSidebarCollapsed(true);
      }}
    >
      <span className="nav-ico" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
          <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </span>
      Search chats
    </button>

    <button
      className={`nav-btn ${activeSection === "explore" ? "active" : ""}`}
      onClick={() => {
        setActiveSection("explore");
        if (isMobile) setSidebarCollapsed(true);
      }}
    >
      <span className="nav-ico" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
          <path d="M14.5 9.5l-5 5l1.5-4l3.5-1z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      </span>
      Explore
    </button>
  </div>
</nav>

                  {/* CHATS LIST */}
                  <div className="sidebar-chats">
                    <button className="new-chat-btn" onClick={handleNewChat}>
                      + New chat
                    </button>

                    {!user && (
                      <div
                        className="sidebar-login-hint"
                        style={{
                          marginTop: 20,
                          textAlign: "center",
                          color: "rgba(255,255,255,0.68)",
                          fontSize: 14,
                          lineHeight: 1.35,
                        }}
                      >
                        Log in to save our conversations.
                      </div>
                    )}

                    <div className="chat-list-section">
                      <span className="nav-section"></span>

                      <div className="chat-list">
  {orderedConversations
  .filter((conv) => {
    // Only show chats in history after the 1st message (local or remote).
    const localCount = Array.isArray(conv.messages) ? conv.messages.length : 0;
    const remoteCount = typeof conv.messageCount === "number" ? conv.messageCount : 0;
    return localCount > 0 || remoteCount > 0;
  })
  .map((conv) => (
                          <div
                            key={conv.id}
                            className={`chat-list-item-wrapper ${conv.id === sidebarActiveConversationId ? "active" : ""}${openMenuId === conv.id ? " menu-open" : ""}`}
                          >
                            <div
                              className={`chat-list-item ${conv.id === sidebarActiveConversationId ? "active" : ""}`}
                               onClick={() => {
   setActiveId(conv.id);
   if (conv.mode === "creative_studio") {
    const m = typeof conv?.modelId === "string" ? conv.modelId.trim() : "";
    setActiveCreativeModel(m && CREATIVE_MODEL_IDS.has(m) ? m : "gpt-image-1.5");
   } else {
     const normalized = normalizeChatModelId(conv?.modelId);
     if (normalized && MODELS.some((m) => m.id === normalized)) setActiveModel(normalized);
     else setActiveModel(DEFAULT_MODEL);
   }
  // Prevent the "new chat" empty-state from flashing while we fetch messages for an existing chat.
  if (user && accessToken) {
    const localCount = Array.isArray(conv.messages) ? conv.messages.length : 0;
    const remoteCount = typeof conv.messageCount === "number" ? conv.messageCount : 0;
    if (
      typeof conv.id === "string" &&
      remoteCount > 0 &&
      localCount === 0 &&
      !loadedRemoteConversationsRef.current.has(conv.id)
    ) {
      setLoadingConversationId(conv.id);
    }
  }
  setOpenMenuId(null);
  setActiveSection(conv.mode === "creative_studio" ? "creative" : "chat");
setDraftMode(conv.mode === "creative_studio" ? "creative" : "chat");
  if (isMobile) setSidebarCollapsed(true);
 }}
                             >
                              <div className="chat-list-title-row">
  {conv.pinned && (
    <span className="chat-pin-icon" aria-label="Afixado" title="Afixado">
      <Pin
        size={15}
        strokeWidth={1.25}
        className="chat-pin-svg pinned-left"
      />
    </span>
  )}

  <span className="chat-list-title">{conv.title}</span>
</div>

                              <button
  className="chat-more-btn"
  aria-label="Mais"
  aria-expanded={openMenuId === conv.id ? "true" : "false"}
onClick={(e) => {
  e.stopPropagation();

  const button = e.currentTarget;
  const wrapper = button.closest(".chat-list-item-wrapper");

  if (!wrapper) return;

  const buttonRect = button.getBoundingClientRect();
  const vv = window.visualViewport;
  const viewportTop = vv?.offsetTop ?? 0;
  const viewportRight = (vv?.offsetLeft ?? 0) + (vv?.width ?? window.innerWidth);
  const viewportBottom = viewportTop + (vv?.height ?? window.innerHeight);
  const conversationProjectMatch = getConversationProjectMatch(conv);
  const estimatedMenuHeight = conversationProjectMatch?.project ? 192 : 158;

  const edgeGap = 8;
  const menuGap = 4;
  const downTop = buttonRect.bottom + menuGap;
  const upTop = buttonRect.top - estimatedMenuHeight - menuGap;
  const spaceBelow = Math.max(0, viewportBottom - downTop - edgeGap);
  const spaceAbove = Math.max(0, buttonRect.top - viewportTop - edgeGap);
  const shouldOpenUpward = spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow;
  const nextTop = shouldOpenUpward
    ? Math.max(viewportTop + edgeGap, upTop)
    : Math.max(
        viewportTop + edgeGap,
        Math.min(downTop, viewportBottom - estimatedMenuHeight - edgeGap)
      );
  const nextRight = Math.max(edgeGap, viewportRight - buttonRect.right);

  setMenuPosition({ top: nextTop, right: nextRight });
  setOpenMenuId((prev) => (prev === conv.id ? null : conv.id));
}}
>
  <MoreHorizontal size={16} aria-hidden="true" />
</button>
               </div>

                            {openMenuId === conv.id && (
                              createPortal(
                                <>
                                  <div className="chat-menu-backdrop" onClick={() => setOpenMenuId(null)} />
                                  <div
                                    ref={chatMenuRef}
                                    className="chat-menu sidebar-chat-menu"
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                      top: menuPosition ? `${menuPosition.top}px` : undefined,
                                      right: menuPosition ? `${menuPosition.right}px` : undefined,
                                    }}
                                  >
                                    {(() => {
                                      const menuProjectMatch = getConversationProjectMatch(conv);
                                      const isConversationInProject = Boolean(menuProjectMatch?.project);

                                      return (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              handleTogglePinChat(conv.id);
                                              setOpenMenuId(null);
                                            }}
                                          >
                                            {conv.pinned ? <PinOff size={16} className="menu-icon" /> : <Pin size={16} className="menu-icon" />}
                                            <span>{conv.pinned ? "Unpin chat" : "Pin chat"}</span>
                                          </button>

                                          <button
                                            type="button"
                                            onClick={() => {
                                              handleRenameChat(conv.id);
                                              setOpenMenuId(null);
                                            }}
                                          >
                                            <Pencil size={16} className="menu-icon" />
                                            <span>Rename</span>
                                          </button>

                                          {isConversationInProject ? (
                                            <>
                                              <button
                                                type="button"
                                                onClick={() => handleMoveConversationToProject(conv, menuProjectMatch)}
                                              >
                                                <IconFolderSync className="menu-icon" />
                                                <span>Change project</span>
                                              </button>

                                              <button
                                                type="button"
                                                onClick={() => handleRemoveConversationFromProject(conv, menuProjectMatch)}
                                              >
                                                <IconFolderX className="menu-icon" />
                                                <span>Remove from project</span>
                                              </button>
                                            </>
                                          ) : (
                                            <button
                                              type="button"
                                              onClick={() => handleAttachConversationToProject(conv)}
                                            >
                                              <IconFolderPlus className="menu-icon" />
                                              <span>Add to project</span>
                                            </button>
                                          )}

                                          <div className="chat-menu-divider" aria-hidden="true" />

                                          <button
                                            type="button"
                                            className="danger"
                                            onMouseDown={(e) => {
                                              e.stopPropagation();
                                              setDeleteChatId(conv.id);
                                              setOpenMenuId(null);
                                            }}
                                          >
                                            <IconTrash className="menu-icon" />
                                            <span>Delete</span>
                                          </button>
                                        </>
                                      );
                                    })()}
                                  </div>
                                </>,
                                document.body
                              )
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
{/* Divider entre conversas e footer */}
<div className="sidebar-divider" />

                  {/* FOOTER */}
{user && (
  <div className="sidebar-footer">
    <button
      type="button"
      className="user-chip"
      aria-haspopup="menu"
      aria-expanded={userMenuOpen ? "true" : "false"}
      onClick={() => setUserMenuOpen((v) => !v)}
    >
      <div className="user-avatar" style={userAvatarStyle}>{userInitial}</div>
      <div className="user-meta">
        <div className="user-name">{userDisplayName}</div>
        <div className="user-plan">{userPlanLabel}</div>
      </div>
      <div className="user-chip-caret" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 24 24">
          <path
            d="M7 14l5-5 5 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <svg width="12" height="12" viewBox="0 0 24 24">
          <path
            d="M7 10l5 5 5-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </button>
  </div>
)}

  {userMenuOpen && (
    <>
      <div
        className="user-menu-backdrop"
        onClick={() => setUserMenuOpen(false)}
      />
      <div className="user-menu" onClick={(e) => e.stopPropagation()}>
        <div className="user-menu-profile">
          <div className="user-menu-avatar" aria-hidden="true" style={userAvatarStyle}>
            {userInitial}
          </div>
          <div className="user-menu-profile-meta">
            <div className="user-menu-name">{userDisplayName}</div>
            <div className="user-menu-sub">
              {user?.email ? String(user.email) : userPlanLabel}
            </div>
          </div>
        </div>

  <button
    type="button"
    className="user-menu-settings"
    onClick={() => {
      setSettingsOpen(true);
      setUserMenuOpen(false);
    }}
  >
    {/* Ícone Definições */}
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992v.255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991v-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
    Settings 
  </button>

  <div className="user-menu-divider" role="separator" aria-hidden="true" />

  <button
  type="button"
  onClick={() => {
    setPlanOpen(true);
    setUserMenuOpen(false);
  }}
>
    {/* Ícone Gerir plano */}
    {/* Ícone Gerir plano */}
<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
  <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 0 1-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 0 0 6.16-12.12A14.98 14.98 0 0 0 9.631 8.41m5.96 5.96a14.926 14.926 0 0 1-5.841 2.58m-.119-8.54a6 6 0 0 0-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 0 0-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 0 1-2.448-2.448 14.9 14.9 0 0 1 .06-.312m-2.24 2.39a4.493 4.493 0 0 0-1.757 4.306 4.493 4.493 0 0 0 4.306-1.758M16.5 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
</svg>
Manage plan
  </button>

  <button
    type="button"
    onClick={() => {
      setMemoryOpen(true);
      setUserMenuOpen(false);
    }}
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="lucide lucide-brain-icon lucide-brain"
      aria-hidden="true"
    >
      <path d="M12 18V5" />
      <path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4" />
      <path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5" />
      <path d="M17.997 5.125a4 4 0 0 1 2.526 5.77" />
      <path d="M18 18a4 4 0 0 0 2-7.464" />
      <path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517" />
      <path d="M6 18a4 4 0 0 1-2-7.464" />
      <path d="M6.003 5.125a4 4 0 0 0-2.526 5.77" />
    </svg>
    Memory
  </button>

  <button
    type="button"
    onClick={() => {
      if (isMobile) setSidebarCollapsed(true);
      setSupportOpen(true);
      setUserMenuOpen(false);
    }}
  >
    {/* Ícone Suporte */}
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379a1.14 1.14 0 0 1 .865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
    </svg>
    Support
  </button>

  <button
  type="button"
  className="danger"
  onClick={() => {
    setUserMenuOpen(false);
    logout(); // S& sai da conta (UI) e limpa localStorage coreai_user/coreai_token
  }}
>
  {/* Ícone Terminar sessão */}
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6A2.25 2.25 0 0 0 5.25 5.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
  </svg>
  Sign out
</button>

  <div className="user-menu-legal" aria-label="Legal">
    <button
      type="button"
      className="user-menu-legal-link"
      onClick={() => {
        setUserMenuOpen(false);
        window.open(
          "https://marked-dive-b9f.notion.site/Terms-Conditions-Core-AI-3175fc6a290d80df9fb8d3c3b33bc6b6",
          "_blank",
          "noopener,noreferrer"
        );
      }}
    >
      Terms
    </button>
    <span className="user-menu-legal-sep" aria-hidden="true">
      |
    </span>
    <button
      type="button"
      className="user-menu-legal-link"
      onClick={() => {
        setUserMenuOpen(false);
        window.open(
          "https://marked-dive-b9f.notion.site/PRIVACY-POLICY-3175fc6a290d80ef804ecaca9b5dfa53",
          "_blank",
          "noopener,noreferrer"
        );
      }}
    >
      Privacy
    </button>
  </div>
</div>
    </>
  )}
                </>
              )}
            </aside>
            

            {/* MAIN */}
            <main className="chat-area">
              <header className="top-bar">
                <div className="top-left-title">
                  {isMobile && sidebarCollapsed && (
                    <button
                      className="mobile-menu-btn"
                      type="button"
                      onClick={() => setSidebarCollapsed(false)}
                      aria-label="Open menu"
                      title="Open menu"
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M4 7h16M4 12h16M4 17h16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  )}
                  <span className="welcome-light"></span>
                  <strong></strong>
                </div>
                <div className="top-right" data-nosnippet>
                 {!user && (
  <>
    <button
      className="top-login"
      onClick={() => openAuth("login")}
    >
      Log in
    </button>

    <button
      className="top-signup"
      onClick={() => openAuth("signup")}
    >
      Sign up
    </button>
  </>
)}
                </div>
              </header>

              <section className="chat-main">
                {/* CHAT */}
                {activeSection === "chat" && (
                  <div className="chat-main-body" ref={chatBodyRef}>
{activeSection === "chat" && showThread ? (
  <>
    <div className="messages">
      {(activeConversation?.messages || []).map((m, i) => {
        const msgKey = getMsgKey(i);
        const isLastMsg = i === (activeConversation?.messages || []).length - 1;
        const isPlanUpgradeError = m.role === "assistant" && isModelPlanUpgradeMessage(m);
        const isMessageLimitError = m.role === "assistant" && isMessageLimitUpgradeMessage(m);
        const hideAssistantActions =
          isPlanUpgradeError || isMessageLimitError || (m.role === "assistant" && loading && isLastMsg);
        const thinkingText = loadingHint === "web" ? "Searching the web..." : "Core is thinking...";


        return (
          <div key={i} className="msg-wrapper">
  {m.role === "user" && m.quotedSelection?.text && (
    <div className="msg-quoted-selection">
      <div className="msg-quoted-selection-icon" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 10 5 5-5 5" />
          <path d="M4 4v7a4 4 0 0 0 4 4h12" />
        </svg>
      </div>
      <div className="msg-quoted-selection-text">
        "{m.quotedSelection.previewText || buildQuotedPreviewText(m.quotedSelection.text)}"
      </div>
    </div>
  )}
  {/* x} anexos do user (por cima da bolha) */}
  {m.role === "user" && Array.isArray(m.attachments) && m.attachments.length > 0 && (
    <div className="msg-attachments">
      {m.attachments.map((a) => (
        <div key={a.id} className="msg-attach-tile">
          {a.isImage && a.previewUrl ? (
            <img className="msg-attach-thumb" src={a.previewUrl} alt={a.name} />
          ) : (
            <div className="msg-attach-file" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="size-6" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                      </svg>
            
            </div>
          )}
          <div className="msg-attach-meta">
            <div className="msg-attach-name">{a.name}</div>
            <div className="msg-attach-sub">{formatBytes(a.size)}</div>
          </div>
        </div>
      ))}
    </div>
  )}

  <div className={`msg ${m.role === "user" ? "msg-user" : "msg-ai"}`}>
    {isPlanUpgradeError ? (
      <PlanUpgradeMessage
        title={`${m.errorMeta?.modelName || getChatModelName(m.errorMeta?.modelId)} isn't available on the ${m.errorMeta?.plan || userPlanLabel} plan.`}
        body="Choose a model included in your plan or upgrade to keep this conversation going."
        onOpenPlan={() => setPlanOpen(true)}
      />
    ) : isMessageLimitError ? (
      <PlanUpgradeMessage
        title={
          buildMessageLimitUpgradeCopy({
            plan: m.errorMeta?.plan || userPlanLabel,
            limit: m.errorMeta?.limit,
            limitWindow: m.errorMeta?.limitWindow,
          }).title
        }
        body={
          buildMessageLimitUpgradeCopy({
            plan: m.errorMeta?.plan || userPlanLabel,
            limit: m.errorMeta?.limit,
            limitWindow: m.errorMeta?.limitWindow,
          }).body
        }
        onOpenPlan={() => setPlanOpen(true)}
      />
    ) : m.role === "assistant" && m.artifact ? (
      <ArtifactCard
        artifact={m.artifact}
        onCopy={async (text) => {
          try {
            await navigator.clipboard.writeText(text);
            showGlobalToast("Copied to clipboard");
          } catch {}
        }}
        onDownload={() => {
          showGlobalToast("Artifact downloaded");
        }}
        onSave={async (nextArtifact) => {
          setConversations((prev) =>
            prev.map((conv) => {
              if (conv.id !== activeId) return conv;
              const msgs = Array.isArray(conv.messages) ? conv.messages.slice() : [];
              const nextIndex = msgs.findIndex((item) => item?.id && item.id === m.id);
              if (nextIndex >= 0) {
                msgs[nextIndex] = {
                  ...msgs[nextIndex],
                  artifact: nextArtifact,
                  artifactPendingSync: true,
                  artifactEditedLocally: true,
                };
              } else if (msgs[i]) {
                msgs[i] = {
                  ...msgs[i],
                  artifact: nextArtifact,
                  artifactPendingSync: true,
                  artifactEditedLocally: true,
                };
              }
              return { ...conv, messages: msgs, updatedAt: Date.now() };
            })
          );
          if (m.id && typeof activeId === "string") {
            try {
              const persisted = await patchConversationMessage({
                conversationId: activeId,
                messageId: m.id,
                content: m.content || "",
                artifact: nextArtifact,
              });
              setConversations((prev) =>
                prev.map((conv) => {
                  if (conv.id !== activeId) return conv;
                  const msgs = Array.isArray(conv.messages) ? conv.messages.slice() : [];
                  const targetIndex = msgs.findIndex((item) => item?.id === m.id);
                  if (targetIndex < 0) return conv;
                  msgs[targetIndex] = {
                    ...msgs[targetIndex],
                    artifact: persisted?.artifact || nextArtifact,
                    artifactPendingSync: false,
                    artifactEditedLocally: true,
                  };
                  return { ...conv, messages: msgs, updatedAt: Date.now() };
                })
              );
              showGlobalToast("Artifact updated");
            } catch {
              setConversations((prev) =>
                prev.map((conv) => {
                  if (conv.id !== activeId) return conv;
                  const msgs = Array.isArray(conv.messages) ? conv.messages.slice() : [];
                  const targetIndex = msgs.findIndex((item) => item?.id === m.id);
                  if (targetIndex < 0) return conv;
                  msgs[targetIndex] = {
                    ...msgs[targetIndex],
                    artifactPendingSync: false,
                    artifactEditedLocally: false,
                  };
                  return { ...conv, messages: msgs, updatedAt: Date.now() };
                })
              );
              showGlobalToast("Couldn't save artifact changes");
            }
          }
        }}
      />
    ) : m.role === "assistant" && m.artifactIntentType ? (
      <ArtifactPreviewCard type={m.artifactIntentType} previewText={m.content} />
    ) : m.content ? (
      m.role === "assistant" ? (
        isThinkingStatusText(m.content) ? (
          <ThinkingStatus text={m.content} />
        ) : isGeneratingStatusText(m.content) ? (
          <GeneratingStatus text={m.content} />
        ) : (
          <div
            className="assistant-selectable-message"
            onMouseUp={handleAssistantSelectionMouseUp}
          >
            <MarkdownMessage
              content={m.content}
              onCopyCode={() => showGlobalToast("Copied to clipboard")}
            />
          </div>
        )
      ) : (
        m.content
      )
    ) : (
      loading &&
      m.role === "assistant" &&
      i === (activeConversation?.messages || []).length - 1 ? (
        <ThinkingStatus text={thinkingText} />
      ) : null
    )}
  </div>

        

            {/* ACTIONS */}
            {m.role === "user" ? (
              <div className="msg-actions msg-actions-user">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Copy"
                  data-tip="Copy"
                  onClick={async () => {
  try {
    await navigator.clipboard.writeText(
      m.artifact ? JSON.stringify(m.artifact, null, 2) : m.content
    );
    showGlobalToast("Copied to clipboard");
  } catch {
    // opcional: showGlobalToast("Falhou ao copiar");
  }
}}
                >
                  <IconCopy />
                </button>

                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Edit"
                  data-tip="Edit"
                  onClick={() => {
  setInput(m.content);

  requestAnimationFrame(() => {
    autoResizeTextarea();
    textareaRef.current?.focus();
  });
}}
                >
                  <IconEdit />
                </button>
              </div>
            ) : (
              hideAssistantActions ? null : (
              <div className="msg-actions msg-actions-ai">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Copy"
                  data-tip="Copy"
                  onClick={async () => {
  try {
    await navigator.clipboard.writeText(m.content);
    showGlobalToast("Copied to clipboard");
  } catch {
    // opcional: showGlobalToast("Falhou ao copiar");
  }
}}
                >
                  <IconCopy />
                </button>

                <button
                  type="button"
                  className={`icon-btn ${msgRatings[msgKey] === "up" ? "is-active" : ""}`}
                  aria-label="Like"
                  data-tip="Like"
                  aria-pressed={msgRatings[msgKey] === "up"}
                  onClick={() => {
                    setMsgRatings((prev) => {
                      const next = { ...prev };
                      next[msgKey] = prev[msgKey] === "up" ? undefined : "up";
                      return next;
                    });
                    
                  }}
                >
                  <IconThumbUp />
                </button>

                <button
                  type="button"
                  className={`icon-btn ${msgRatings[msgKey] === "down" ? "is-active" : ""}`}
                  aria-label="Dislike"
                  data-tip="Dislike"
                  aria-pressed={msgRatings[msgKey] === "down"}
                  onClick={() => {
                    setMsgRatings((prev) => {
                      const next = { ...prev };
                      next[msgKey] = prev[msgKey] === "down" ? undefined : "down";
                      return next;
                    });
                    
                  }}
                >
                  <IconThumbDown />
                </button>

                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Try again"
                  data-tip="Try again"
                  onClick={() => {
                    const prevUser = [...activeConversation.messages]
                      .slice(0, i)
                      .reverse()
                      .find((x) => x.role === "user");

                    if (prevUser) handleSend(prevUser.content);
                  }}
                >
                  <IconRetry />
                </button>
              </div>
              )
            )}
          </div>
        );
      })}

      {!hasMessages && isHydratingActive && <div className="thinking">Loading conversation...</div>}
    </div>
    <button
  className={`scroll-to-bottom ${showScrollDown ? "visible" : ""}`}
  onClick={() => scrollToBottom("smooth")}
  aria-label="Scroll to bottom"
  title="Scroll to bottom"
  style={{ bottom: `calc(${scrollDownButtonBottom}px + env(safe-area-inset-bottom, 0px))` }}
>
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path
      d="M12 16c-.3 0-.6-.1-.8-.3l-5-5a1.1 1.1 0 011.6-1.6L12 13.3l4.2-4.2a1.1 1.1 0 011.6 1.6l-5 5c-.2.2-.5.3-.8.3z"
      fill="currentColor"
    />
  </svg>
</button>
  
  </>
) : (



                      <div className="chat-empty-state" data-nosnippet>
  <div className="chat-empty-inner">
    <img className="chat-empty-logo" src={MODELS[0]?.logo || coreLogo} alt="" aria-hidden="true" />
    <h1 className="chat-empty-title" data-nosnippet>How can I help you?</h1>

    {/* INPUT (centrado)  só aparece no novo chat */}
    <div className={`chat-input-wrapper${isMobile ? "" : " centered"}`}>
      <form onSubmit={onSubmit} className="chat-input-form">
        <div
          className={`composer${currentComposerQuote ? " composer-has-quote" : ""}${
            isComposerFileDragActive ? " composer-drag-active" : ""
          }`}
          {...composerFileDropProps}
        >
          {isComposerFileDragActive ? <ComposerFileDropOverlay /> : null}
          {composerQuotePreview}
          <div className="composer-top">
            <textarea
              data-nosnippet
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={handleComposerChange}
              placeholder="Ask anything..."
              disabled={!activeConversation}
              onPaste={handleComposerPaste}
              onKeyDown={(e) => {
                if (shouldSubmitOnEnter && e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              onFocus={handleComposerFocus}
              onBlur={handleComposerBlur}
              className="composer-textarea"
            />
          </div>

          {/* x} Anexos (Perplexity-like, dentro do composer) */}
          {attachments.length > 0 && (
            <div className="composer-attachments-row">
              {attachments.map((a) => (
                <div key={a.id} className="attach-tile">
                  {a.isImage && a.previewUrl ? (
                    <img className="attach-thumb" src={a.previewUrl} alt={a.name} />
                  ) : (
                    <div className="attach-file-ico" aria-hidden="true">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="size-6" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                      </svg>
                    </div>
                  )}

                  <div className="attach-meta">
                    <div className="attach-name">{a.name}</div>
                    <div className="attach-sub">
                      {formatBytes(a.size)}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="attach-x"
                    onClick={() => removeAttachment(a.id)}
                    aria-label="Remover anexo"
                    title="Remover"
                  >
                    
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="composer-bottom">
            {/* x} Anexos */}
            <div className="composer-tools" ref={composerToolsRef}>
              <input
                ref={fileInputRef}
                type="file"
                className="composer-file"
                multiple
                onChange={(e) => addFiles(e.target.files)}
              />

              <button
                type="button"
                className="composer-attach composer-tools-trigger"
                title="Tools"
                aria-label="Tools"
                aria-haspopup="menu"
                aria-expanded={toolsMenuOpen}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setToolsMenuOpen((v) => !v);
                }}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    d="M12 5v14M5 12h14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>

              {webSearchEnabled && (
                <button
                  type="button"
                  className="tool-pill"
                  onClick={() => setWebSearchEnabled(false)}
                  title="Turn off Web Search"
                >
                  <span className="tool-pill-ico" aria-hidden="true">
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="14" height="14">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
  </svg>
</span>
                  <span className="tool-pill-label">Web Search</span>
                  <span className="tool-pill-x" aria-hidden="true">{"\u00D7"}</span>
                </button>
              )}

              {reasoningEnabled && (
                <button
                  type="button"
                  className="tool-pill"
                  onClick={() => setReasoningEnabled(false)}
                  title="Turn Off Reasoning"
                >
<span className="tool-pill-ico" aria-hidden="true">
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="14" height="14">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
    />
  </svg>
</span>
<span className="tool-pill-label">Reasoning</span>
                  <span className="tool-pill-x" aria-hidden="true">{"\u00D7"}</span></button>
              )}

              {toolsMenuOpen && (
                <div className="composer-tools-menu" role="menu" aria-label="Tools">
                  <button
                    type="button"
                    className="tools-item"
                    role="menuitem"
                    onClick={() => {
                      setToolsMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                  >
                    <span className="tools-item-left">
                      <span className="tools-item-ico" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="18" height="18">
                          <path
                            d="M12 5v14M5 12h14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                          />
                        </svg>
                      </span>
                      Attach file
                    </span>
                  </button>

                  <div className="tools-divider" role="separator" aria-hidden="true" />

                  <button
                    type="button"
                    className="tools-item"
                    role="menuitemcheckbox"
                    aria-checked={webSearchEnabled}
                    onClick={handleToggleWebSearch}
                  >
                    <span className="tools-item-left">
                      <span className="tools-item-ico" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="18" height="18">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418"
                          />
                        </svg>
                      </span>
                      Web search
                    </span>
                    <span
                      className={"tools-switch" + (webSearchEnabled ? " on" : "")}
                      aria-hidden="true"
                    >
                      <span className="tools-switch-thumb" />
                    </span>
                  </button>

                  <button
                    type="button"
                    className="tools-item"
                    role="menuitemcheckbox"
                    aria-checked={reasoningEnabled}
                    onClick={handleToggleReasoning}
                  >
                    <span className="tools-item-left">
                      <span className="tools-item-ico" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="18" height="18">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
                          />
                        </svg>
                      </span>
                      Reasoning
                    </span>
                    <span
                      className={"tools-switch" + (reasoningEnabled ? " on" : "")}
                      aria-hidden="true"
                    >
                      <span className="tools-switch-thumb" />
                    </span>
                  </button>
                </div>
              )}
            </div>
            <div className="composer-actions">
              <div className="model-selector" ref={modelSelectorRef}>
                <button
                  type="button"
                  className="model-trigger"
                  data-nosnippet
                  onClick={() => setModelMenuOpen((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={modelMenuOpen}
                >
                  <img
                    src={MODELS.find((m) => m.id === activeModel)?.logo}
                    alt=""
                    className="model-logo"
                  />
                  <span className="model-name">
                    {MODELS.find((m) => m.id === activeModel)?.name}
                  </span>
                </button>

                {modelMenuOpen && (
                  <div className="model-menu" onClick={(e) => e.stopPropagation()}>
                    <div className="model-menu-head">
                       <input
                         className="model-search"
                         value={modelQuery}
                         onChange={(e) => setModelQuery(e.target.value)}
                         placeholder="Search model"
                        autoFocus={!isMobile && !isTabletViewport}
                       />
                    </div>

                    <div className="model-menu-list">
                      {bestAutoModel ? (
                        <>
                          <button
                            className={`model-item ${bestAutoModel.id === activeModel ? "active" : ""}`}
                            onClick={() => {
                              setModelForActiveConversation(bestAutoModel.id);
                              setModelMenuOpen(false);
                              setModelQuery("");
                            }}
                          >
                            <img src={bestAutoModel.logo} alt="" />
                            <span className="model-item-main">
                              <span className="model-item-name">{bestAutoModel.name}</span>
                            </span>
                          </button>
                          <div className="model-auto-note">Choose the best model for each task.</div>
                          <div className="model-menu-separator" aria-hidden="true" />
                        </>
                      ) : null}

                      {standardFilteredModels.map((model) => (
                        <button
                          key={model.id}
                          className={`model-item ${model.id === activeModel ? "active" : ""}`}
                          onClick={() => {
                            setModelForActiveConversation(model.id);
                            setModelMenuOpen(false);
                            setModelQuery("");
                          }}
                        >
                          <img src={model.logo} alt="" />
                          <span className="model-item-main">
                            <span className="model-item-name">{model.name}</span>
                            {shouldShowFreeModelBadge(model.id) ? (
                              <span className="model-badge model-badge-free">FREE</span>
                            ) : null}
                            {NEW_MODEL_BADGE_IDS.has(model.id) ? (
                              <span className="model-badge model-badge-new">
                                <svg viewBox="0 0 24 24" aria-hidden="true" className="model-badge-icon">
                                  <path
                                    d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                                <span>NEW</span>
                              </span>
                            ) : null}
                          </span>
                        </button>
                      ))}

                      {filteredModels.length === 0 && <div className="model-empty">Sem resultados</div>}
                    </div>
                  </div>
                )}
              </div>

              <button
                type={loading ? "button" : "submit"}
                className="composer-send"
                disabled={!activeConversation}
                title={loading ? "Stop response" : "Send"}
                onClick={loading ? stopCurrentResponse : undefined}
              >
                {loading ? (
                  <span className="send-dots">...</span>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 27 24" aria-hidden="true">
                    <path d="M2 12L22 3L14 21L11 13L2 12Z" fill="currentColor" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  </div>
</div>
                    )}
                  </div>
                )}

                {/* INPUT */}
{activeSection === "chat" && showThread && !isCreativeChat && (
  <div className="chat-input-wrapper chat-thread-input-wrapper" ref={chatInputWrapperRef}>
                  <form onSubmit={onSubmit} className="chat-input-form">
                    <div
                      className={`composer${currentComposerQuote ? " composer-has-quote" : ""}${
                        isComposerFileDragActive ? " composer-drag-active" : ""
                      }`}
                      {...composerFileDropProps}
                    >
                      {isComposerFileDragActive ? <ComposerFileDropOverlay /> : null}
                      {composerQuotePreview}
                      <div className="composer-top">
                        <textarea
                          ref={textareaRef}
                          rows={1}
                          value={input}
                          onChange={handleComposerChange}
                          placeholder="Ask anything..."
                          disabled={!activeConversation}
                          onPaste={handleComposerPaste}
                          onKeyDown={(e) => {
                            if (shouldSubmitOnEnter && e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              handleSend();
                            }
                          }}
                          onFocus={handleComposerFocus}
                          onBlur={handleComposerBlur}
                          className="composer-textarea"
                        />
                      </div>
  {/* x} Anexos (Perplexity-like, dentro do composer) */}
  {attachments.length > 0 && (
    <div className="composer-attachments-row">
      {attachments.map((a) => (
        <div key={a.id} className="attach-tile">
          {a.isImage && a.previewUrl ? (
            <img className="attach-thumb" src={a.previewUrl} alt={a.name} />
          ) : (
            <div className="attach-file-ico" aria-hidden="true">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="size-6" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                      </svg>
            </div>
          )}

          <div className="attach-meta">
            <div className="attach-name">{a.name}</div>
            <div className="attach-sub">{formatBytes(a.size)}</div>
          </div>

          <button
            type="button"
            className="attach-x"
            onClick={() => removeAttachment(a.id)}
            aria-label="Remover anexo"
            title="Remove"
          >
            
          </button>
        </div>
      ))}
    </div>
  )}
                      <div className="composer-bottom">
                        {/* x} Anexos */}
                        <div className="composer-tools" ref={composerToolsRef}>
                          <input
                            ref={fileInputRef}
                            type="file"
                            className="composer-file"
                            multiple
                            onChange={(e) => addFiles(e.target.files)}
                          />

                          <button
                            type="button"
                            className="composer-attach composer-tools-trigger"
                            title="Tools"
                            aria-label="Tools"
                            aria-haspopup="menu"
                            aria-expanded={toolsMenuOpen}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setToolsMenuOpen((v) => !v);
                            }}
                          >
                            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                              <path
                                d="M12 5v14M5 12h14"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                              />
                            </svg>
                          </button>

                          {webSearchEnabled && (
                            <button
                              type="button"
                              className="tool-pill"
                              onClick={() => setWebSearchEnabled(false)}
                              title="Turn off Web Search"
                            >
                              <span className="tool-pill-ico" aria-hidden="true">
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="14" height="14">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
  </svg>
</span>
                              <span className="tool-pill-label">Web Search</span>
                              <span className="tool-pill-x" aria-hidden="true">{"\u00D7"}</span>
                            </button>
                          )}

                          {reasoningEnabled && (
                            <button
                              type="button"
                              className="tool-pill"
                              onClick={() => setReasoningEnabled(false)}
                              title="Turn Off Reasoning"
                            >
<span className="tool-pill-ico" aria-hidden="true">
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="14" height="14">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
    />
  </svg>
</span>
<span className="tool-pill-label">Reasoning</span>
                              <span className="tool-pill-x" aria-hidden="true">{"\u00D7"}</span></button>
                          )}

                          {toolsMenuOpen && (
                            <div className="composer-tools-menu" role="menu" aria-label="Tools">
                              <button
                                type="button"
                                className="tools-item"
                                role="menuitem"
                                onClick={() => {
                                  setToolsMenuOpen(false);
                                  fileInputRef.current?.click();
                                }}
                              >
                                <span className="tools-item-left">
                                  <span className="tools-item-ico" aria-hidden="true">
                                    <svg viewBox="0 0 24 24" width="18" height="18">
                                      <path
                                        d="M12 5v14M5 12h14"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.8"
                                        strokeLinecap="round"
                                      />
                                    </svg>
                                  </span>
                                  Attach file
                                </span>
                              </button>

                  <div className="tools-divider" role="separator" aria-hidden="true" />

                              <button
                                type="button"
                                className="tools-item"
                                role="menuitemcheckbox"
                                aria-checked={webSearchEnabled}
                                onClick={handleToggleWebSearch}
                              >
                                <span className="tools-item-left">
                                  <span className="tools-item-ico" aria-hidden="true">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="18" height="18">
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418"
                                      />
                                    </svg>
                                  </span>
                                  Web search
                                </span>
                                <span
                                  className={"tools-switch" + (webSearchEnabled ? " on" : "")}
                                  aria-hidden="true"
                                >
                                  <span className="tools-switch-thumb" />
                                </span>
                              </button>

                              <button
                                type="button"
                                className="tools-item"
                                role="menuitemcheckbox"
                                aria-checked={reasoningEnabled}
                                onClick={handleToggleReasoning}
                              >
                                <span className="tools-item-left">
                                  <span className="tools-item-ico" aria-hidden="true">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="18" height="18">
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
                                      />
                                    </svg>
                                  </span>
                                 Reasoning
                                </span>
                                <span
                                  className={"tools-switch" + (reasoningEnabled ? " on" : "")}
                                  aria-hidden="true"
                                >
                                  <span className="tools-switch-thumb" />
                                </span>
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="composer-actions">
                          <div className="model-selector" ref={modelSelectorRef}>
                            <button
                              type="button"
                              className="model-trigger"
                              data-nosnippet
                              onClick={() => setModelMenuOpen((v) => !v)}
                              aria-haspopup="listbox"
                              aria-expanded={modelMenuOpen}
                            >
                              <img
                                src={MODELS.find((m) => m.id === activeModel)?.logo}
                                alt=""
                                className="model-logo"
                              />
                              <span className="model-name">
                                {MODELS.find((m) => m.id === activeModel)?.name}
                              </span>
                            </button>

                            {modelMenuOpen && (
                              <div className="model-menu" onClick={(e) => e.stopPropagation()}>
                                <div className="model-menu-head">
                                  <input
                                    className="model-search"
                                    value={modelQuery}
                                    onChange={(e) => setModelQuery(e.target.value)}
                                    placeholder="Search model"
                                    autoFocus={!isMobile && !isTabletViewport}
                                  />
                                </div>

                                <div className="model-menu-list">
                                  {bestAutoModel ? (
                                    <>
                                      <button
                                        className={`model-item ${bestAutoModel.id === activeModel ? "active" : ""}`}
                                        onClick={() => {
                                          setModelForActiveConversation(bestAutoModel.id);
                                          setModelMenuOpen(false);
                                          setModelQuery("");
                                        }}
                                      >
                                        <img src={bestAutoModel.logo} alt="" />
                                        <span className="model-item-main">
                                          <span className="model-item-name">{bestAutoModel.name}</span>
                                        </span>
                                      </button>
                                      <div className="model-auto-note">Choose the best model for each task.</div>
                                      <div className="model-menu-separator" aria-hidden="true" />
                                    </>
                                  ) : null}

                                  {standardFilteredModels.map((model) => (
                                    <button
                                      key={model.id}
                                      className={`model-item ${model.id === activeModel ? "active" : ""}`}
                                      onClick={() => {
                                        setModelForActiveConversation(model.id);
                                        setModelMenuOpen(false);
                                        setModelQuery("");
                                      }}
                                    >
                                      <img src={model.logo} alt="" />
                                      <span className="model-item-main">
                                        <span className="model-item-name">{model.name}</span>
                                        {shouldShowFreeModelBadge(model.id) ? (
                                          <span className="model-badge model-badge-free">FREE</span>
                                        ) : null}
                                        {NEW_MODEL_BADGE_IDS.has(model.id) ? (
                                          <span className="model-badge model-badge-new">
                                            <svg viewBox="0 0 24 24" aria-hidden="true" className="model-badge-icon">
                                              <path
                                                d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="1.5"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                              />
                                            </svg>
                                            <span>NEW</span>
                                          </span>
                                        ) : null}
                                      </span>
                                    </button>
                                  ))}

                                  {filteredModels.length === 0 && <div className="model-empty">Sem resultados</div>}
                                </div>
                              </div>
                            )}
                          </div>

                          <button
                            type={loading ? "button" : "submit"}
                            className="composer-send"
                            disabled={!activeConversation}
                            title={loading ? "Stop response" : "Send"}
                            onClick={loading ? stopCurrentResponse : undefined}
                          >
                            {loading ? (
                              <span className="send-dots">...</span>
                            ) : (
                              <svg width="18" height="18" viewBox="0 0 27 24" aria-hidden="true">
                                <path d="M2 12L22 3L14 21L11 13L2 12Z" fill="currentColor" />
                              </svg>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </form>
                </div>
)}
<Definicoes
  open={settingsOpen}
  onClose={() => setSettingsOpen(false)}
  theme={theme}
  setTheme={setTheme}
  language={language}
  setLanguage={setLanguage}
  onOpenPlan={() => setPlanOpen(true)}
/>
<PlanosModal
  open={planOpen}
  onClose={() => setPlanOpen(false)}
  currentPlan={user?.plan}
/>
	<MemoryModal
	  open={memoryOpen}
	  onClose={() => setMemoryOpen(false)}
	  onOpenPlan={() => {
	    setMemoryOpen(false);
	    setPlanOpen(true);
	  }}
	/>
	<SupportModal
	  open={supportOpen}
	  onClose={closeSupportModal}
	  userDisplayName={userDisplayName}
	  message={supportMessage}
	  setMessage={setSupportMessage}
	  files={supportFiles}
	  onPickFiles={() => supportFileInputRef.current?.click()}
	  onFilesSelected={addSupportFiles}
	  onRemoveFile={removeSupportFile}
	  fileInputRef={supportFileInputRef}
	  onSubmit={submitSupportRequest}
	  submitting={supportSubmitting}
	  formatBytes={formatBytes}
	  autoFocus={!isMobile && !isTabletViewport}
	/>
	
               {/* PLACEHOLDERS  páginas futuras */}
{activeSection === "creative" && (
  <div className="chat-main-body creative-studio">
    <CreativeStudio
      hasMessages={showThread}
      activeConversation={activeConversation}
      loading={loading}

      input={input}
      setInput={setInput}
      textareaRef={textareaRef}
      autoResizeTextarea={autoResizeTextarea}
      handleComposerChange={handleComposerChange}
      handleComposerFocus={handleComposerFocus}
      handleComposerBlur={handleComposerBlur}
      handleSend={handleSend}
      onSubmit={onSubmit}

      attachments={attachments}
      addFiles={addFiles}
      removeAttachment={removeAttachment}
      fileInputRef={fileInputRef}
      formatBytes={formatBytes}

      webSearchEnabled={webSearchEnabled}
      setWebSearchEnabled={setWebSearchEnabled}
      reasoningEnabled={reasoningEnabled}
      setReasoningEnabled={setReasoningEnabled}

      activeCreativeModel={activeCreativeModel}
      setActiveCreativeModel={setActiveCreativeModel}
      creativeCredits={creativeCreditsSummary}
      selectedCreativeEditTarget={activeCreativeEditTarget}
      onSelectCreativeEditTarget={({ conversationId, url, previewUrl }) => {
        setCreativeEditTargetForConversation({
          conversationId,
          target: { url, previewUrl },
        });
      }}
      onClearCreativeEditTarget={(conversationId) => {
        clearCreativeEditTargetForConversation(conversationId);
      }}
      onOpenPlan={() => setPlanOpen(true)}
    />
  </div>
)}

{activeSection === "projects" && (
  <div className="chat-main-body">
    <Projects
      conversations={conversations}
      isAuthenticated={Boolean(accessToken)}
      currentPlan={user?.plan}
      showGlobalToast={showGlobalToast}
      onOpenPlan={() => setPlanOpen(true)}
      onRequireAuth={() => openAuth?.("login")}
      onCreateProjectConversation={createProjectConversation}
      onActivateProjectConversation={activateConversation}
      onOpenProjectConversation={openProjectConversation}
      onRequestProjectConversationRename={handleProjectConversationRenameRequest}
      onRequestProjectConversationDelete={handleProjectConversationDeleteRequest}
    />
  </div>
)}

{activeSection === "explore" && (
  <div className="chat-main-body">
    <Explorar />
  </div>
)}
{activeSection === "copilot" && (
  <div className="chat-main-body">
    <CodeCopilot
      hasMessages={showThread}
      activeConversation={activeConversation}

      // S& IGUAL AO CHAT (ações)
      msgRatings={msgRatings}
      setMsgRatings={setMsgRatings}
      getMsgKey={(i) => `${activeId}-${i}`}
      showGlobalToast={showGlobalToast}

      input={input}
      setInput={setInput}
      textareaRef={textareaRef}
      autoResizeTextarea={autoResizeTextarea}
      handleSend={handleSend}
      onSubmit={onSubmit}

      attachments={attachments}
      addFiles={addFiles}
      removeAttachment={removeAttachment}
      fileInputRef={fileInputRef}
      formatBytes={formatBytes}
    />
  </div>
)}
              </section>
            </main>
            {assistantSelectionActionPortal}
{searchOpen && (
  <div
    className="search-modal-backdrop"
    onClick={() => setSearchOpen(false)}
  >
    <div
      className="search-modal"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        className="search-input"
        placeholder="Search chats"
        value={searchQuery}
        autoFocus={!isMobile && !isTabletViewport}
        onChange={(e) => setSearchQuery(e.target.value)}
      />

      <button
        className="search-new-chat"
        onClick={() => {
          setSearchOpen(false);
          handleNewChat();
        }}
      >
        + New Chat
      </button>

      <div className="search-results">
        {orderedConversations
          .filter((c) => {
            const localCount = Array.isArray(c.messages) ? c.messages.length : 0;
            const remoteCount = typeof c.messageCount === "number" ? c.messageCount : 0;
            return (localCount > 0 || remoteCount > 0) && c.title.toLowerCase().includes(searchQuery.toLowerCase());
          })
          .map((c) => (
            <button
              key={c.id}
              className="search-result-item"
              onClick={() => {
  setActiveId(c.id);
  // Same anti-flicker hydration hint as the sidebar list.
  if (user && accessToken) {
    const localCount = Array.isArray(c.messages) ? c.messages.length : 0;
    const remoteCount = typeof c.messageCount === "number" ? c.messageCount : 0;
    if (
      typeof c.id === "string" &&
      remoteCount > 0 &&
      localCount === 0 &&
      !loadedRemoteConversationsRef.current.has(c.id)
    ) {
      setLoadingConversationId(c.id);
    }
  }
setActiveSection(c.mode === "creative_studio" ? "creative" : c.mode === "copilot" ? "copilot" : "chat");
setDraftMode(c.mode === "creative_studio" ? "creative" : c.mode === "copilot" ? "copilot" : "chat");
  setSearchOpen(false);
}}
            >
              {c.title}
            </button>
          ))}
      </div>
    </div>
  </div>
)}
            {projectPickerState && (
              <div
                className="projects-modal-overlay"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) {
                    closeProjectPicker();
                  }
                }}
              >
                <div
                  className="projects-modal projects-modal--move"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <div className="projects-modal__header">
                    <div className="projects-modal__heading">
                      <h2 className="projects-modal__title">
                        {projectPickerState.mode === "move" ? "Move chat" : "Add to project"}
                      </h2>
                      <p className="projects-modal__copy">
                        {projectPickerState.mode === "move"
                          ? `This chat is in ${projectPickerState.sourceProjectName}. Select a different project below.`
                          : "Choose a project to keep this chat organized with related work."}
                      </p>
                    </div>

                    <button
                      type="button"
                      className="projects-modal__close"
                      onClick={closeProjectPicker}
                      aria-label="Close"
                    >
                      <X size={18} />
                    </button>
                  </div>

                  <div className="projects-modal__body projects-modal__body--move">
                    <div className="projects-move-chat-modal__picker">
                      <label className="projects-move-chat-modal__search">
                        <Search size={18} aria-hidden="true" />
                        <input
                          type="text"
                          value={projectPickerQuery}
                          onChange={(event) => setProjectPickerQuery(event.target.value)}
                          placeholder="Search or choose a project"
                          autoFocus={!isMobile && !isTabletViewport}
                        />
                      </label>

                      <div className="projects-move-chat-modal__results">
                        {filteredProjectPickerProjects.length ? (
                          filteredProjectPickerProjects.map((project) => (
                            <button
                              key={project.id}
                              type="button"
                              className="projects-move-chat-modal__project"
                              onClick={() => handleSelectProjectForConversation(project.id)}
                            >
                              <span className="projects-move-chat-modal__project-name">
                                {project.name}
                              </span>
                              <span className="projects-move-chat-modal__project-meta">
                                {formatProjectUpdatedTime(project.updatedAt)}
                              </span>
                            </button>
                          ))
                        ) : (
                          <div className="projects-move-chat-modal__empty">
                            {isProjectPickerLoading
                              ? "Loading projects..."
                              : projectPickerState.projects.length
                              ? "No projects found"
                              : projectPickerState.mode === "move"
                                ? "No other projects available"
                                : "No projects available"}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {/* S& RENAME CHAT MODAL */}
{renameChatId && (
  <div
    className="rename-backdrop"
    onClick={() => setRenameChatId(null)}
    role="dialog"
    aria-modal="true"
  >
    <div
      className="rename-modal"
      onClick={(e) => e.stopPropagation()}
    >
      <h3 className="rename-title">Change chat name</h3>

      <input
        className="rename-input"
        value={renameValue}
        autoFocus={!isMobile}
        onChange={(e) => setRenameValue(e.target.value)}
         onKeyDown={(e) => {
           if (e.key === "Enter" && renameValue.trim()) {
             setConversations((prev) =>
               prev.map((c) =>
                 c.id === renameChatId ? { ...c, title: renameValue.trim() } : c
               )
             );
             persistConversationTitle(renameChatId, renameValue.trim());
             setRenameChatId(null);
           }
         }}
       />

      <div className="rename-actions">
        <button
          type="button"
          className="rename-cancel"
          onClick={() => setRenameChatId(null)}
        >
          Cancel
        </button>

        <button
          type="button"
          className="rename-confirm"
          disabled={!renameValue.trim()}
          onClick={() => {
            setConversations((prev) =>
              prev.map((c) =>
                c.id === renameChatId ? { ...c, title: renameValue.trim() } : c
              )
            );
            persistConversationTitle(renameChatId, renameValue.trim());
            setRenameChatId(null);
          }}
        >
          Save
        </button>
      </div>
    </div>
  </div>
)}

            {/* S& DELETE CHAT MODAL */}
{deleteChatId && (
  <div
    className="delete-backdrop"
    onClick={() => setDeleteChatId(null)}
    role="dialog"
    aria-modal="true"
  >
    <div
      className="delete-modal"
      onClick={(e) => e.stopPropagation()}
    >
      <h3 className="delete-title">Delete conversation?</h3>

      <p className="delete-text">
        This action will delete this conversation and all messages..
      </p>

      <div className="delete-actions">
        <button
          type="button"
          className="delete-cancel"
          onClick={() => setDeleteChatId(null)}
        >
          Cancel
        </button>

        <button
          type="button"
          className="delete-confirm"
          onClick={handleConfirmDeleteChat}
        >
          Delete
        </button>
      </div>
    </div>
  </div>
)}
          </div>
        }
      />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppShell />
      <AuthModal />
    </AuthProvider>
  );
}
export default App;
