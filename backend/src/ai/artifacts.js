const { z } = require("zod");
const { getModel } = require("./models");
const { getProvider } = require("./providers");
const { runInProviderQueue } = require("./queues");

const ARTIFACT_KINDS = ["document", "slides"];
const ARTIFACT_MARKER_PREFIX = "[[CORE_ARTIFACT:";

const artifactIntentSchema = z.object({
  explicit: z.boolean(),
  artifact: z.enum(["none", ...ARTIFACT_KINDS]),
  title: z.string().trim().max(160).optional(),
});

const documentArtifactSchema = z.object({
  type: z.literal("document"),
  title: z.string().trim().min(1).max(160),
  subtitle: z.string().trim().max(240).optional(),
  sections: z
    .array(
      z.object({
        heading: z.string().trim().min(1).max(160),
        paragraphs: z.array(z.string().trim().min(1).max(4000)).max(12).default([]),
        bullets: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
      })
    )
    .min(1)
    .max(16),
});

const slidesArtifactSchema = z.object({
  type: z.literal("slides"),
  title: z.string().trim().min(1).max(160),
  subtitle: z.string().trim().max(240).optional(),
  slides: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(160),
        subtitle: z.string().trim().max(240).optional(),
        bullets: z.array(z.string().trim().min(1).max(320)).max(8).default([]),
        notes: z.string().trim().max(2400).optional(),
      })
    )
    .min(1)
    .max(20),
});

const artifactSchema = z.discriminatedUnion("type", [
  documentArtifactSchema,
  slidesArtifactSchema,
]);

function inferExplicitArtifactRequest(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const lc = raw.toLowerCase();

  const negative =
    /\b(ideias?|sugest(?:ao|oes)|brainstorm|outline|estrutura|estruturar|t[oó]picos?|recomenda(?:c[aã]o|coes)|critica|critique|planear|planejar|ajuda-me a|help me|what should|o que devo|como fazer)\b/.test(
      lc
    );
  if (negative) return null;

  const explicitVerb =
    /\b(faz(?: tu)?|cria(?: tu)?|gera|monta|constroi|produz|escreve|prepara|make|create|generate|build|write|prepare)\b/.test(
      lc
    );
  if (!explicitVerb) return null;

  const isSlides =
    /\b(slides?|apresenta[cç][aã]o|powerpoint|pptx?|deck|keynote)\b/.test(lc);
  const isDocument =
    /\b(documento|doc|texto|relat[oó]rio|report|contrato|carta|plano)\b/.test(lc);

  if (isSlides) return "slides";
  if (isDocument) return "document";
  return null;
}

function extractJsonObject(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function chooseArtifactIntentModel() {
  const candidates = [
    "gemini-2.5 flash",
    "gpt-5-mini",
    "deepseek-v3.2",
    "qwen3.5-flash",
  ];
  for (const id of candidates) {
    const model = getModel(id);
    if (!model) continue;
    const provider = getProvider(model.provider);
    if (provider?.streamChat) return model;
  }
  return null;
}

function chooseArtifactModel() {
  const candidates = [
    "gpt-5-mini",
    "gemini-2.5 flash",
    "deepseek-v3.2",
    "qwen3.5-flash",
  ];
  for (const id of candidates) {
    const model = getModel(id);
    if (!model) continue;
    const provider = getProvider(model.provider);
    if (provider?.streamChat) return model;
  }
  return null;
}

async function collectModelText({ modelObj, messages, signal, plan }) {
  const provider = getProvider(modelObj?.provider);
  if (!provider?.streamChat) return "";
  let raw = "";
  await runInProviderQueue(
    modelObj.provider,
    ({ signal: qSignal }) =>
      provider.streamChat({
        remoteModel: modelObj.remoteModel,
        messages,
        onDelta: (chunk) => {
          if (typeof chunk === "string") raw += chunk;
        },
        signal: qSignal,
      }),
    { type: "text", plan, signal, maxRetries: 0, priority: 1 }
  );
  return raw;
}

async function detectArtifactIntent({ userText, locale, signal, plan }) {
  const model = chooseArtifactIntentModel();
  if (!model) return { explicit: false, artifact: "none", title: null };

  const system = {
    role: "system",
    content:
      "You classify whether the user EXPLICITLY asked for a deliverable artifact in any language.\n" +
      "Return JSON only: {\"explicit\":boolean,\"artifact\":\"none|document|slides\",\"title\":\"optional\"}.\n" +
      "Use artifact=document for docs/plans/reports/letters/contracts/pages intended as a document.\n" +
      "Use artifact=slides for slides/decks/presentation/PowerPoint/Keynote.\n" +
      "Only mark explicit=true if the user clearly asked you to create the final artifact now, not merely discuss it.\n" +
      "Treat requests for ideas, suggestions, brainstorming, outlines, examples, structure, topics, recommendations, critique, or help about an artifact as explicit=false.\n" +
      "Treat requests like 'give me ideas for slides', 'outline a document', or 'help me plan a presentation' as explicit=false.\n" +
      "Treat explicit requests like 'create the slides', 'make me a document', 'generate the presentation', or equivalent semantics in any language as explicit=true.\n" +
      "When the user is ambiguous or asking for content that could later be turned into an artifact, prefer explicit=false.\n" +
      "This must work semantically in any language; never rely on specific keywords.\n" +
      "If unsure, return explicit=false and artifact=none.",
  };

  const user = {
    role: "user",
    content:
      `Locale hint: ${String(locale || "unknown")}\n` +
      `User message:\n${String(userText || "").slice(0, 4000)}`,
  };

  try {
    const raw = await collectModelText({ modelObj: model, messages: [system, user], signal, plan });
    const parsed = artifactIntentSchema.safeParse(extractJsonObject(raw));
    if (!parsed.success) return { explicit: false, artifact: "none", title: null };
    return {
      explicit: parsed.data.explicit && parsed.data.artifact !== "none",
      artifact: parsed.data.explicit ? parsed.data.artifact : "none",
      title: parsed.data.title || null,
    };
  } catch {
    return { explicit: false, artifact: "none", title: null };
  }
}

function formatArtifactContext(messages) {
  const items = Array.isArray(messages) ? messages : [];
  const lines = [];
  for (const item of items.slice(-10)) {
    const role = String(item?.role || "").toLowerCase();
    if (role !== "user" && role !== "assistant") continue;
    const content = String(item?.content || "").trim();
    if (!content) continue;
    lines.push(`${role.toUpperCase()}: ${content.slice(0, 1200)}`);
  }
  return lines.join("\n\n").slice(0, 8000);
}

function buildArtifactPrompt({ artifactType, locale, titleHint, userText, contextMessages }) {
  const typeInstructions =
    artifactType === "document"
      ? [
          "Create a polished document artifact.",
          "Focus on strong structure, readable sections, and content that stands on its own.",
          "Each section should have concise paragraphs and optional bullets.",
        ]
      : artifactType === "slides"
        ? [
            "Create a presentation artifact.",
            "Each slide must be concise and presentation-ready.",
            "Use short bullets, strong titles, and avoid dense paragraphs inside slides.",
          ]
        : [];

  const jsonShape =
    artifactType === "document"
      ? '{"type":"document","title":"...","subtitle":"optional","sections":[{"heading":"...","paragraphs":["..."],"bullets":["..."]}]}'
      : artifactType === "slides"
        ? '{"type":"slides","title":"...","subtitle":"optional","slides":[{"title":"...","subtitle":"optional","bullets":["..."],"notes":"optional"}]}'
        : "";

  return [
    "Return valid JSON only. No markdown. No prose outside JSON.",
    `Write the artifact in the same language as the user's request. Locale hint: ${String(locale || "unknown")}.`,
    "The artifact should be directly useful, polished, and ready to show in a product UI.",
    ...typeInstructions,
    titleHint ? `Prefer this title if it fits naturally: ${titleHint}` : "",
    `JSON shape: ${jsonShape}`,
    contextMessages?.length
      ? `Recent conversation context:\n${formatArtifactContext(contextMessages)}`
      : "",
    `User request:\n${String(userText || "").slice(0, 8000)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildArtifactPreviewMessages({ artifactType, locale, titleHint, userText, contextMessages }) {
  const typeInstructions =
    artifactType === "document"
      ? "Write the requested document directly as polished readable content with clear sections."
      : artifactType === "slides"
        ? "Write slide-ready presentation content with a strong title and concise slide sections."
        : "";

  const system = {
    role: "system",
    content:
      "You are preparing a final deliverable inside a chat product. " +
      "Answer in the same language as the user. " +
      "Do not mention JSON, artifacts, schemas, or implementation details. " +
      "Write the deliverable itself, not commentary about it.",
  };

  const user = {
    role: "user",
    content: [
      `Locale hint: ${String(locale || "unknown")}`,
      titleHint ? `Prefer this title if natural: ${titleHint}` : "",
      typeInstructions,
      contextMessages?.length
        ? `Recent conversation context:\n${formatArtifactContext(contextMessages)}`
        : "",
      `User request:\n${String(userText || "").slice(0, 8000)}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };

  return [system, user];
}

function buildArtifactModeSystemMessage({ locale }) {
  return {
    role: "system",
    content: [
      "If and only if the user explicitly asks you to create the final deliverable now, you may answer as an artifact.",
      "Artifact types allowed: document, slides.",
      `When you choose artifact mode, the VERY FIRST LINE of your answer must be exactly ${ARTIFACT_MARKER_PREFIX}<type>|<title>]]`,
      "Use type=document or slides.",
      "Do not use the marker for brainstorming, ideas, suggestions, discussion, analysis, outlines, or recommendations about those formats.",
      "If the user is asking for ideas for slides/documents, do NOT use the marker.",
      "After the marker line, write only the artifact content itself in the same language as the user.",
      "For document artifacts, write polished markdown with a top title and section headings.",
      "For slides artifacts, write markdown like: '# Deck Title', then one section per slide using '## Slide Title', then short bullets, and optional 'Notes: ...'.",
      `Locale hint: ${String(locale || "unknown")}.`,
    ].join("\n"),
  };
}

function parseArtifactMarkerLine(line) {
  const raw = String(line || "").trim();
  const match = raw.match(/^\[\[CORE_ARTIFACT:(document|slides)\|([^\]]{1,160})\]\]$/i);
  if (!match) return null;
  return {
    type: String(match[1] || "").toLowerCase(),
    title: String(match[2] || "").trim() || null,
  };
}

function extractArtifactEnvelope(text) {
  const source = String(text || "");
  if (!source) return { artifact: null, text: "" };
  const newlineIndex = source.indexOf("\n");
  const firstLine = newlineIndex >= 0 ? source.slice(0, newlineIndex) : source;
  const marker = parseArtifactMarkerLine(firstLine);
  if (!marker) return { artifact: null, text: source };
  const remaining = newlineIndex >= 0 ? source.slice(newlineIndex + 1).replace(/^\n+/, "") : "";
  return {
    artifact: marker,
    text: remaining,
  };
}

function parseMarkdownTable(block) {
  const lines = String(block || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  const header = lines[0];
  const divider = lines[1];
  if (!header.includes("|") || !divider.includes("|")) return null;
  const dividerCells = divider
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!dividerCells.length || dividerCells.some((cell) => !/^:?-{3,}:?$/.test(cell))) return null;
  const toCells = (line) =>
    line
      .split("|")
      .map((item) => item.trim())
      .filter((_, index, arr) => !(index === 0 && !arr[0]) && !(index === arr.length - 1 && !arr[arr.length - 1]));
  const columns = toCells(header);
  if (!columns.length) return null;
  const rows = lines.slice(2).map((line) => {
    const cells = toCells(line);
    return columns.map((_, index) => String(cells[index] || "").trim());
  });
  return { columns, rows };
}

function clampText(value, max, fallback = "") {
  const text = String(value || fallback || "").trim();
  if (!text) return String(fallback || "").trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

function sanitizeParagraphs(items, maxItems = 12, maxLen = 4000) {
  return (Array.isArray(items) ? items : [])
    .map((item) => clampText(item, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

function sanitizeBullets(items, maxItems = 20, maxLen = 500) {
  return (Array.isArray(items) ? items : [])
    .map((item) => clampText(item, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

function sanitizeDocumentSections(sections) {
  const normalized = (Array.isArray(sections) ? sections : [])
    .map((section) => ({
      heading: clampText(section?.heading, 160, "Conteúdo"),
      paragraphs: sanitizeParagraphs(section?.paragraphs, 12, 4000),
      bullets: sanitizeBullets(section?.bullets, 20, 500),
    }))
    .filter((section) => section.heading || section.paragraphs.length || section.bullets.length)
    .slice(0, 16);
  return normalized.length
    ? normalized
    : [{ heading: "Conteúdo", paragraphs: ["Conteúdo"], bullets: [] }];
}

function looksLikeDocumentHeading(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return false;
  if (/^#{2,6}\s+/.test(trimmed)) return true;
  if (/^\*\*.+\*\*$/.test(trimmed) && trimmed.length <= 170) return true;
  return false;
}

function normalizeDocumentHeading(line) {
  const trimmed = String(line || "").trim();
  return clampText(
    trimmed
      .replace(/^#{2,6}\s+/, "")
      .replace(/^\*\*(.+)\*\*$/, "$1"),
    160,
    "Conteúdo"
  );
}

function isDocumentBodyListLike(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return false;
  return /^[-*]\s+/.test(trimmed) || /^\d+[\.\)]\s+/.test(trimmed);
}

function parseDocumentArtifactFromText({ text, titleHint }) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  const lines = normalized.split("\n");
  let title = clampText(titleHint, 160);
  let index = 0;
  if (lines[0] && /^#\s+/.test(lines[0])) {
    title = clampText(lines[0].replace(/^#\s+/, "").trim(), 160) || title;
    index = 1;
  }
  if (!title) title = "Documento";

  let subtitle = "";
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }
    if (looksLikeDocumentHeading(line) || isDocumentBodyListLike(line)) break;
    subtitle = clampText(line, 240);
    index += 1;
    break;
  }

  const body = lines.slice(index).join("\n").trim();
  const rawSections = [];
  const sections = [];
  if (body) {
    const bodyLines = body.split("\n");
    const hasExplicitHeadings = bodyLines.some((line) => looksLikeDocumentHeading(line));
    if (!hasExplicitHeadings) {
      rawSections.push(`## Conteúdo\n${body}`);
    } else {
      let current = [];
      for (const line of bodyLines) {
        if (looksLikeDocumentHeading(line) && current.length > 0) {
          rawSections.push(current.join("\n"));
          current = [line];
        } else {
          current.push(line);
        }
      }
      if (current.length > 0) rawSections.push(current.join("\n"));
    }
  }
  if (!rawSections.length && body) rawSections.push(`## Conteúdo\n${body}`);

  for (const rawSection of rawSections) {
    const sectionLines = String(rawSection || "").split("\n");
    const headingLine = sectionLines[0] || "";
    const hasHeading = looksLikeDocumentHeading(headingLine);
    const heading = hasHeading ? normalizeDocumentHeading(sectionLines.shift() || "") : "Conteúdo";
    const paragraphs = [];
    const bullets = [];
    let paragraphBuffer = [];

    const flushParagraph = () => {
      const joined = clampText(paragraphBuffer.join(" ").trim(), 4000);
      if (joined) paragraphs.push(joined);
      paragraphBuffer = [];
    };

    for (const line of sectionLines) {
      const trimmed = String(line || "").trim();
      if (!trimmed) {
        flushParagraph();
        continue;
      }
      if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
        flushParagraph();
        bullets.push(clampText(trimmed.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim(), 500));
        continue;
      }
      paragraphBuffer.push(trimmed);
    }
    flushParagraph();
    if (heading || paragraphs.length || bullets.length) {
      sections.push({ heading, paragraphs, bullets });
    }
  }

  const payload = {
    type: "document",
    title,
    subtitle: subtitle || undefined,
    sections: sanitizeDocumentSections(
      sections.length ? sections : [{ heading: "Conteúdo", paragraphs: [clampText(normalized, 4000, "Conteúdo")], bullets: [] }]
    ),
  };

  const parsed = documentArtifactSchema.safeParse(payload);
  if (parsed.success) return parsed.data;
  return {
    type: "document",
    title: clampText(title, 160, "Documento"),
    subtitle: subtitle ? clampText(subtitle, 240) : undefined,
    sections: sanitizeDocumentSections([{ heading: "Conteúdo", paragraphs: [clampText(normalized, 4000, "Conteúdo")], bullets: [] }]),
  };
}

function parseSlidesArtifactFromText({ text, titleHint }) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  const lines = normalized.split("\n");
  let title = String(titleHint || "").trim();
  let index = 0;
  if (lines[0] && /^#\s+/.test(lines[0])) {
    title = lines[0].replace(/^#\s+/, "").trim() || title;
    index = 1;
  }
  if (!title) title = "Slides";

  let subtitle = "";
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }
    if (/^##\s+/.test(line)) break;
    subtitle = line;
    index += 1;
    break;
  }

  const body = lines.slice(index).join("\n").trim();
  const rawSlides = body ? body.split(/\n(?=##\s+)/g) : [];
  const slides = [];

  for (const rawSlide of rawSlides) {
    const slideLines = String(rawSlide || "").split("\n");
    const headingLine = slideLines.shift() || "";
    const slideTitle = headingLine.replace(/^##\s+/, "").trim() || "Slide";
    let slideSubtitle = "";
    const bullets = [];
    const notes = [];

    for (const line of slideLines) {
      const trimmed = String(line || "").trim();
      if (!trimmed) continue;
      if (!slideSubtitle && !/^[-*]\s+/.test(trimmed) && !/^Notes?:/i.test(trimmed)) {
        slideSubtitle = trimmed;
        continue;
      }
      if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
        bullets.push(trimmed.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim());
        continue;
      }
      if (/^Notes?:/i.test(trimmed)) {
        notes.push(trimmed.replace(/^Notes?:/i, "").trim());
        continue;
      }
      bullets.push(trimmed);
    }

    slides.push({
      title: slideTitle,
      subtitle: slideSubtitle || undefined,
      bullets,
      notes: notes.length ? notes.join(" ") : undefined,
    });
  }

  return slidesArtifactSchema.parse({
    type: "slides",
    title,
    subtitle: subtitle || undefined,
    slides: slides.length ? slides : [{ title, bullets: normalized ? [normalized] : ["Conteúdo"] }],
  });
}

function artifactFromTextEnvelope({ type, title, text }) {
  if (!ARTIFACT_KINDS.includes(type)) return null;
  try {
    if (type === "document") return parseDocumentArtifactFromText({ text, titleHint: title });
    return parseSlidesArtifactFromText({ text, titleHint: title });
  } catch {
    if (type === "document") {
      return {
        type: "document",
        title: clampText(title, 160, "Documento"),
        sections: sanitizeDocumentSections([{ heading: "Conteúdo", paragraphs: [clampText(text, 4000, "Conteúdo")], bullets: [] }]),
      };
    }
    if (type === "slides") {
      return {
        type: "slides",
        title: clampText(title, 160, "Slides"),
        slides: [{ title: clampText(title, 160, "Slide 1"), bullets: [clampText(text, 320, "Conteúdo")] }],
      };
    }
    return {
      type: "slides",
      title: clampText(title, 160, "Slides"),
      slides: [{ title: clampText(title, 160, "Slide 1"), bullets: [clampText(text, 320, "Conteúdo")] }],
    };
  }
}

async function generateArtifact({
  artifactType,
  modelObj,
  locale,
  titleHint,
  userText,
  contextMessages,
  signal,
  plan,
}) {
  const system = {
    role: "system",
    content:
      "You generate structured artifacts for a chat product. " +
      "The artifact must be complete and polished. Return JSON only.",
  };
  const user = {
    role: "user",
    content: buildArtifactPrompt({ artifactType, locale, titleHint, userText, contextMessages }),
  };

  const raw = await collectModelText({
    modelObj,
    messages: [system, user],
    signal,
    plan,
  });

  const parsed = artifactSchema.safeParse(extractJsonObject(raw));
  if (!parsed.success || parsed.data.type !== artifactType) {
    const err = new Error("ARTIFACT_GENERATION_FAILED");
    err.status = 502;
    err.details = { artifactType };
    throw err;
  }
  return parsed.data;
}

function artifactToClipboardText(artifact) {
  if (!artifact || typeof artifact !== "object") return "";
  if (artifact.type === "document") {
    const lines = [artifact.title];
    if (artifact.subtitle) lines.push(artifact.subtitle);
    for (const section of artifact.sections || []) {
      lines.push("");
      lines.push(section.heading);
      for (const p of section.paragraphs || []) lines.push(p);
      for (const bullet of section.bullets || []) lines.push(`- ${bullet}`);
    }
    return lines.join("\n").trim();
  }
  if (artifact.type === "slides") {
    const lines = [artifact.title];
    if (artifact.subtitle) lines.push(artifact.subtitle);
    for (const slide of artifact.slides || []) {
      lines.push("");
      lines.push(`# ${slide.title}`);
      if (slide.subtitle) lines.push(slide.subtitle);
      for (const bullet of slide.bullets || []) lines.push(`- ${bullet}`);
      if (slide.notes) lines.push(`Notes: ${slide.notes}`);
    }
    return lines.join("\n").trim();
  }
  return "";
}

module.exports = {
  ARTIFACT_KINDS,
  artifactSchema,
  ARTIFACT_MARKER_PREFIX,
  inferExplicitArtifactRequest,
  buildArtifactModeSystemMessage,
  buildArtifactPreviewMessages,
  chooseArtifactIntentModel,
  chooseArtifactModel,
  detectArtifactIntent,
  extractArtifactEnvelope,
  artifactFromTextEnvelope,
  generateArtifact,
  artifactToClipboardText,
};
