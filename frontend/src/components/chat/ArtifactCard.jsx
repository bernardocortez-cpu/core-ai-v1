import { useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { Check, Copy, Download, FileText, MonitorPlay, Pencil, ChevronLeft, ChevronRight, X } from "lucide-react";
import "./ArtifactCard.css";

function linesToParagraphs(text) {
  return String(text || "")
    .split(/\n\s*\n/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function renderInlineMarkdown(text, keyPrefix) {
  const source = String(text || "");
  const parts = source.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$/.test(part)) return <em key={key}>{part.slice(1, -1)}</em>;
    if (/^`[^`]+`$/.test(part)) return <code key={key}>{part.slice(1, -1)}</code>;
    return <span key={key}>{part}</span>;
  });
}

function buildPptxRunsFromMarkdown(text, baseOptions = {}) {
  const source = String(text || "");
  const parts = source.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).filter(Boolean);
  return parts.map((part) => {
    const options = { ...baseOptions };
    let value = part;
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      value = part.slice(2, -2);
      options.bold = true;
    } else if (/^\*[^*]+\*$/.test(part)) {
      value = part.slice(1, -1);
      options.italic = true;
    } else if (/^`[^`]+`$/.test(part)) {
      value = part.slice(1, -1);
      options.fontFace = "Courier New";
      options.color = baseOptions.color || "111111";
    }
    return { text: value, options };
  });
}

function RichTextParagraph({ as: Tag = "p", text, className, keyPrefix }) {
  return <Tag className={className}>{renderInlineMarkdown(text, keyPrefix)}</Tag>;
}

function RichTextList({ items, keyPrefix, className }) {
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <ul className={className}>
      {items.map((item, index) => (
        <li key={`${keyPrefix}-${index}`}>{renderInlineMarkdown(item, `${keyPrefix}-${index}`)}</li>
      ))}
    </ul>
  );
}

function RichTextCell({ text, className, keyPrefix }) {
  return <div className={className}>{renderInlineMarkdown(text, keyPrefix)}</div>;
}

function sanitizeEditableHtml(html) {
  if (typeof window === "undefined") return String(html || "");
  const template = window.document.createElement("template");
  template.innerHTML = String(html || "");
  const allowedTags = new Set([
    "DIV", "P", "BR", "H1", "H2", "H3", "H4", "UL", "OL", "LI", "STRONG", "EM", "CODE",
    "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "SPAN",
  ]);
  const walker = window.document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT);
  const toRemove = [];
  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (!allowedTags.has(el.tagName)) {
      toRemove.push(el);
      continue;
    }
    for (const attr of [...el.attributes]) {
      const name = String(attr.name || "").toLowerCase();
      if (name === "contenteditable" || name === "spellcheck" || name === "role" || name.startsWith("data-")) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === "class") continue;
      el.removeAttribute(attr.name);
    }
  }
  for (const el of toRemove) {
    const parent = el.parentNode;
    if (!parent) continue;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }
  return template.innerHTML.trim();
}

function normalizeArtifactHtml(html) {
  if (typeof window === "undefined") return String(html || "");
  const template = window.document.createElement("template");
  template.innerHTML = String(html || "");
  const candidates = template.content.querySelectorAll("p, div, span");
  candidates.forEach((node) => {
    const text = String(node.textContent || "").replace(/\u00a0/g, " ").trim();
    if (!isSeparatorOnlyLine(text)) return;
    const separator = window.document.createElement("div");
    separator.className = "artifact-preview-separator";
    separator.setAttribute("aria-hidden", "true");
    node.replaceWith(separator);
  });
  return template.innerHTML.trim();
}

function extractPlainTextFromHtml(html) {
  if (typeof window === "undefined") return String(html || "");
  const template = window.document.createElement("template");
  template.innerHTML = String(html || "");
  return String(template.content.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractMarkdownFromHtml(html) {
  if (typeof window === "undefined") return String(html || "").trim();
  const template = window.document.createElement("template");
  template.innerHTML = String(html || "");

  const normalizeText = (value) =>
    String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+\n/g, "\n")
      .replace(/\n\s+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();

  const inlineToMarkdown = (node) => {
    if (!node) return "";
    if (node.nodeType === Node.TEXT_NODE) {
      return String(node.textContent || "").replace(/\u00a0/g, " ");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node;
    const text = Array.from(el.childNodes).map(inlineToMarkdown).join("");
    if (el.tagName === "STRONG") return `**${text}**`;
    if (el.tagName === "EM") return `*${text}*`;
    if (el.tagName === "CODE") return `\`${text}\``;
    if (el.tagName === "BR") return "\n";
    return text;
  };

  const tableToMarkdown = (table) => {
    const rows = Array.from(table.querySelectorAll("tr"))
      .map((row) =>
        Array.from(row.children)
          .filter((cell) => cell.tagName === "TH" || cell.tagName === "TD")
          .map((cell) => normalizeText(Array.from(cell.childNodes).map(inlineToMarkdown).join("")))
      )
      .filter((row) => row.length);
    if (!rows.length) return "";
    const [header, ...body] = rows;
    const columns = header.map((cell) => cell || " ");
    const divider = columns.map(() => "---");
    const serializeRow = (row) => `| ${columns.map((_, index) => normalizeText(row[index] || " ")).join(" | ")} |`;
    return [serializeRow(columns), serializeRow(divider), ...body.map(serializeRow)].join("\n");
  };

  const blockToMarkdown = (node, context = { seenTitle: false }) => {
    if (!node) return [];
    if (node.nodeType === Node.TEXT_NODE) {
      const text = normalizeText(node.textContent || "");
      return text ? [text] : [];
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return [];
    const el = node;
    const tag = el.tagName;

    if (tag === "TABLE") {
      const table = tableToMarkdown(el);
      return table ? [table] : [];
    }

    if (tag === "UL" || tag === "OL") {
      return Array.from(el.children)
        .filter((child) => child.tagName === "LI")
        .map((child, index) => {
          const prefix = tag === "OL" ? `${index + 1}. ` : "- ";
          return `${prefix}${normalizeText(Array.from(child.childNodes).map(inlineToMarkdown).join(""))}`;
        })
        .filter(Boolean);
    }

    if (tag === "LI") {
      const text = normalizeText(Array.from(el.childNodes).map(inlineToMarkdown).join(""));
      return text ? [`- ${text}`] : [];
    }

    if (tag === "H1" || tag === "H2" || tag === "H3" || tag === "H4") {
      const text = normalizeText(Array.from(el.childNodes).map(inlineToMarkdown).join(""));
      if (!text) return [];
      if (!context.seenTitle) {
        context.seenTitle = true;
        return [text];
      }
      return [`## ${text}`];
    }

    if (el.classList.contains("artifact-preview-separator")) {
      return ["---"];
    }

    if (tag === "P" || tag === "DIV" || tag === "SPAN") {
      const hasBlockChildren = Array.from(el.children).some((child) =>
        ["TABLE", "UL", "OL", "H1", "H2", "H3", "H4"].includes(child.tagName) ||
        child.classList.contains("artifact-preview-separator")
      );
      if (hasBlockChildren) {
        return Array.from(el.childNodes).flatMap((child) => blockToMarkdown(child, context));
      }
      const text = normalizeText(Array.from(el.childNodes).map(inlineToMarkdown).join(""));
      return text ? [text] : [];
    }

    return Array.from(el.childNodes).flatMap((child) => blockToMarkdown(child, context));
  };

  const blocks = Array.from(template.content.childNodes)
    .flatMap((node) => blockToMarkdown(node))
    .map((block) => String(block || "").trim())
    .filter(Boolean);

  return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function cleanDisplayLine(text) {
  return String(text || "")
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\*\*(.+)\*\*$/u, "$1")
    .trim();
}

function isSeparatorOnlyLine(text) {
  return /^[-_*]{3,}$/.test(String(text || "").trim());
}

function renderPreviewBlock(line, index) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return <div key={`preview-gap-${index}`} className="artifact-preview-gap" />;
  if (isSeparatorOnlyLine(trimmed)) {
    return <div key={`preview-separator-${index}`} className="artifact-preview-separator" aria-hidden="true" />;
  }
  if (/^#{2,6}\s+/.test(trimmed)) {
    return (
      <h3 key={`preview-h3-${index}`} className="artifact-preview-heading">
        {renderInlineMarkdown(trimmed.replace(/^#{2,6}\s+/, ""), `preview-h3-${index}`)}
      </h3>
    );
  }
  if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
    return (
      <div key={`preview-li-${index}`} className="artifact-preview-bullet">
        {renderInlineMarkdown(trimmed.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, ""), `preview-li-${index}`)}
      </div>
    );
  }
  return (
    <p key={`preview-p-${index}`} className="artifact-preview-line">
      {renderInlineMarkdown(trimmed, `preview-p-${index}`)}
    </p>
  );
}

function isMarkdownTableDivider(line) {
  const cells = String(line || "")
    .trim()
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderMarkdownTable(lines, keyPrefix, className = "artifact-markdown-table") {
  const table = parseMarkdownTableRows((Array.isArray(lines) ? lines : []).join("\n"));
  if (!table) return null;
  return (
    <div key={`${keyPrefix}-wrap`} className={`${className}-wrap`}>
      <table className={className}>
        <thead>
          <tr>
            {table.columns.map((column, index) => (
              <th key={`${keyPrefix}-head-${index}`}>
                <RichTextCell
                  text={column}
                  className={`${className}-cell`}
                  keyPrefix={`${keyPrefix}-head-${index}`}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={`${keyPrefix}-row-${rowIndex}`}>
              {table.columns.map((_, columnIndex) => (
                <td key={`${keyPrefix}-cell-${rowIndex}-${columnIndex}`}>
                  <RichTextCell
                    text={row[columnIndex] || ""}
                    className={`${className}-cell`}
                    keyPrefix={`${keyPrefix}-cell-${rowIndex}-${columnIndex}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderMarkdownLikeDocument(markdown, { bodyClassName = "artifact-preview-body", keyPrefix = "doc-preview" } = {}) {
  const text = String(markdown || "");
  const lines = text.split("\n");
  const firstMeaningful =
    lines.find((line) => {
      const trimmed = String(line || "").trim();
      return trimmed && !isSeparatorOnlyLine(trimmed);
    }) || "";
  const title = cleanDisplayLine(firstMeaningful);
  const bodyLines = lines.slice(firstMeaningful ? lines.indexOf(firstMeaningful) + 1 : 0);
  const bodyItems = [];

  for (let index = 0; index < bodyLines.length; index += 1) {
    const line = String(bodyLines[index] || "");
    const trimmed = line.trim();
    const next = String(bodyLines[index + 1] || "").trim();
    if (/^```/.test(trimmed)) {
      let j = index + 1;
      while (j < bodyLines.length) {
        const codeLine = String(bodyLines[j] || "").trim();
        if (/^```/.test(codeLine)) break;
        j += 1;
      }
      index = j;
      continue;
    }
    if (trimmed.includes("|") && isMarkdownTableDivider(next)) {
      const tableLines = [line, bodyLines[index + 1]];
      let j = index + 2;
      while (j < bodyLines.length) {
        const rowLine = String(bodyLines[j] || "");
        if (!rowLine.trim() || !rowLine.includes("|")) break;
        tableLines.push(rowLine);
        j += 1;
      }
      bodyItems.push(renderMarkdownTable(tableLines, `${keyPrefix}-table-${index}`));
      index = j - 1;
      continue;
    }
    bodyItems.push(renderPreviewBlock(line, `${keyPrefix}-${index}`));
  }

  return {
    title,
    body: bodyItems.some(Boolean) ? (
      <div className={bodyClassName}>
        {bodyItems}
      </div>
    ) : null,
  };
}

function renderMarkdownBlocks(lines, { keyPrefix = "blocks", tableClassName = "artifact-markdown-table" } = {}) {
  const items = Array.isArray(lines) ? lines : [];
  const blocks = [];

  for (let index = 0; index < items.length; index += 1) {
    const line = String(items[index] || "");
    const trimmed = line.trim();
    const next = String(items[index + 1] || "").trim();
    if (/^```/.test(trimmed)) {
      let j = index + 1;
      while (j < items.length) {
        const codeLine = String(items[j] || "").trim();
        if (/^```/.test(codeLine)) break;
        j += 1;
      }
      index = j;
      continue;
    }
    if (trimmed.includes("|") && isMarkdownTableDivider(next)) {
      const tableLines = [line, items[index + 1]];
      let j = index + 2;
      while (j < items.length) {
        const rowLine = String(items[j] || "");
        if (!rowLine.trim() || !rowLine.includes("|")) break;
        tableLines.push(rowLine);
        j += 1;
      }
      blocks.push(renderMarkdownTable(tableLines, `${keyPrefix}-table-${index}`, tableClassName));
      index = j - 1;
      continue;
    }
    blocks.push(renderPreviewBlock(line, `${keyPrefix}-${index}`));
  }

  return blocks;
}

function parseDocumentMarkdownBlocks(markdown) {
  const text = String(markdown || "");
  const lines = text.split("\n");
  const firstMeaningful =
    lines.find((line) => {
      const trimmed = String(line || "").trim();
      return trimmed && !isSeparatorOnlyLine(trimmed);
    }) || "";
  const title = cleanDisplayLine(firstMeaningful);
  const bodyLines = lines.slice(firstMeaningful ? lines.indexOf(firstMeaningful) + 1 : 0);
  const blocks = [];

  for (let index = 0; index < bodyLines.length; index += 1) {
    const line = String(bodyLines[index] || "");
    const trimmed = line.trim();
    const next = String(bodyLines[index + 1] || "").trim();

    if (!trimmed) {
      blocks.push({ type: "gap" });
      continue;
    }

    if (/^```/.test(trimmed)) {
      let j = index + 1;
      while (j < bodyLines.length) {
        const codeLine = String(bodyLines[j] || "").trim();
        if (/^```/.test(codeLine)) break;
        j += 1;
      }
      index = j;
      continue;
    }

    if (isSeparatorOnlyLine(trimmed)) {
      blocks.push({ type: "separator" });
      continue;
    }

    if (trimmed.includes("|") && isMarkdownTableDivider(next)) {
      const tableLines = [line, bodyLines[index + 1]];
      let j = index + 2;
      while (j < bodyLines.length) {
        const rowLine = String(bodyLines[j] || "");
        if (!rowLine.trim() || !rowLine.includes("|")) break;
        tableLines.push(rowLine);
        j += 1;
      }
      const table = parseMarkdownTableRows(tableLines.join("\n"));
      if (table) blocks.push({ type: "table", table });
      index = j - 1;
      continue;
    }

    if (/^#{2,6}\s+/.test(trimmed)) {
      blocks.push({
        type: "heading",
        text: trimmed.replace(/^#{2,6}\s+/, ""),
      });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      blocks.push({
        type: "bullet",
        text: trimmed.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, ""),
      });
      continue;
    }

    blocks.push({ type: "paragraph", text: trimmed });
  }

  return { title, blocks };
}

function parseSlidesFromMarkdown(markdown, fallbackArtifact) {
  const text = String(markdown || "").trim();
  if (!text) return null;
  const lines = text.split("\n");
  const firstMeaningful = lines.find((line) => String(line || "").trim()) || "";
  const deckTitle = cleanDisplayLine(firstMeaningful) || fallbackArtifact?.title || "Slides";
  const bodyLines = lines.slice(firstMeaningful ? lines.indexOf(firstMeaningful) + 1 : 0);
  const raw = bodyLines.join("\n").trim();
  const chunks = raw ? raw.split(/\n(?=##\s+)/g) : [];
  const slides = [];

  for (const chunk of chunks) {
    const chunkLines = chunk.split("\n");
    const headingLine = cleanDisplayLine(chunkLines.shift() || "");
    if (!headingLine || isSeparatorOnlyLine(headingLine)) continue;
    let subtitle = "";
    const bullets = [];
    let notes = "";
    const contentLines = [];
    for (let lineIndex = 0; lineIndex < chunkLines.length; lineIndex += 1) {
      const line = chunkLines[lineIndex];
      const trimmed = String(line || "").trim();
      if (!trimmed || isSeparatorOnlyLine(trimmed)) continue;
      const nextLine = String(chunkLines[lineIndex + 1] || "").trim();
      const isTableHeader = trimmed.includes("|") && isMarkdownTableDivider(nextLine);
      if (!subtitle && !/^[-*]\s+/.test(trimmed) && !/^Notes?:/i.test(trimmed) && !isTableHeader) {
        subtitle = cleanDisplayLine(trimmed);
        continue;
      }
      if (/^Notes?:/i.test(trimmed)) {
        notes = trimmed.replace(/^Notes?:/i, "").trim();
        continue;
      }
      if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
        bullets.push(trimmed.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, ""));
      }
      contentLines.push(line);
    }
    if (!subtitle && !bullets.length && !notes && !contentLines.length) continue;
    slides.push({ title: headingLine, subtitle, bullets, notes, contentLines });
  }

  if (!slides.length && fallbackArtifact?.slides?.length) {
    return { title: deckTitle, slides: fallbackArtifact.slides };
  }

  return { title: deckTitle, slides: slides.length ? slides : [{ title: deckTitle, bullets: bodyLines.filter((line) => line.trim()) }] };
}

function parseMarkdownTableRows(markdown) {
  const lines = String(markdown || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const tableStart = lines.findIndex((line) => line.includes("|"));
  if (tableStart < 0 || tableStart + 1 >= lines.length) return null;
  const header = lines[tableStart];
  const divider = lines[tableStart + 1];
  if (!divider.includes("|")) return null;
  const dividerCells = divider.split("|").map((item) => item.trim()).filter(Boolean);
  if (!dividerCells.length || dividerCells.some((cell) => !/^:?-{3,}:?$/.test(cell))) return null;
  const toCells = (line) =>
    line
      .split("|")
      .map((item) => item.trim())
      .filter((_, index, arr) => !(index === 0 && !arr[0]) && !(index === arr.length - 1 && !arr[arr.length - 1]));
  const columns = toCells(header);
  const rows = lines.slice(tableStart + 2).map((line) => {
    const cells = toCells(line);
    return columns.map((_, index) => String(cells[index] || "").trim());
  });
  return { columns, rows };
}

function extractFirstMarkdownTableBlock(lines) {
  const items = Array.isArray(lines) ? lines : [];
  for (let i = 0; i < items.length - 1; i += 1) {
    const line = String(items[i] || "").trim();
    const next = String(items[i + 1] || "").trim();
    if (!line.includes("|") || !isMarkdownTableDivider(next)) continue;
    let end = i + 1;
    let j = i + 2;
    while (j < items.length) {
      const rowLine = String(items[j] || "").trim();
      if (!rowLine || !rowLine.includes("|")) break;
      end = j;
      j += 1;
    }
    return {
      start: i,
      end,
      lines: items.slice(i, end + 1),
    };
  }
  return null;
}

function serializeArtifact(artifact) {
  if (!artifact || typeof artifact !== "object") return "";
  if (artifact.sourceMarkdown) {
    return String(artifact.sourceMarkdown || "").trim();
  }
  if (artifact.type === "document") {
    const lines = [artifact.title];
    if (artifact.subtitle) lines.push(artifact.subtitle);
    for (const section of artifact.sections || []) {
      lines.push("");
      lines.push(`## ${section.heading}`);
      for (const paragraph of section.paragraphs || []) lines.push(paragraph);
      for (const bullet of section.bullets || []) lines.push(`- ${bullet}`);
    }
    return lines.join("\n").trim();
  }
  if (artifact.type === "slides") {
    const lines = [artifact.title];
    if (artifact.subtitle) lines.push(artifact.subtitle);
    for (const slide of artifact.slides || []) {
      lines.push("");
      lines.push(`## ${slide.title}`);
      if (slide.subtitle) lines.push(slide.subtitle);
      for (const bullet of slide.bullets || []) lines.push(`- ${bullet}`);
      if (slide.notes) lines.push(`Notes: ${slide.notes}`);
    }
    return lines.join("\n").trim();
  }
  return "";
}

function buildDownloadPayload(artifact) {
  if (!artifact || typeof artifact !== "object") {
    return { filename: "artifact.txt", mimeType: "text/plain;charset=utf-8", content: "" };
  }
  if (artifact.type === "document") {
    return {
      filename: `${artifact.title || "document"}.md`,
      mimeType: "text/markdown;charset=utf-8",
      content: serializeArtifact(artifact),
    };
  }
  if (artifact.type === "slides") {
    return {
      filename: `${artifact.title || "slides"}.md`,
      mimeType: "text/markdown;charset=utf-8",
      content: serializeArtifact(artifact),
    };
  }
  return {
    filename: "artifact.txt",
    mimeType: "text/plain;charset=utf-8",
    content: serializeArtifact(artifact),
  };
}

function getArtifactLabel(type) {
  if (type === "document") return "Document";
  if (type === "slides") return "Slides";
  return "Artifact";
}

function EditableHtmlSurface({ initialHtml, className, editorRef }) {
  const localRef = useRef(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    const node = localRef.current;
    if (!node || initializedRef.current) return;
    node.innerHTML = String(initialHtml || "");
    initializedRef.current = true;
  }, [initialHtml]);

  return (
    <div
      ref={(node) => {
        localRef.current = node;
        if (typeof editorRef === "function") editorRef(node);
        else if (editorRef) editorRef.current = node;
      }}
      className={className}
      contentEditable
      suppressContentEditableWarning
    />
  );
}

export default function ArtifactCard({ artifact, onCopy, onDownload, onSave, isSaving = false }) {
  const [editing, setEditing] = useState(false);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const pdfRenderRef = useRef(null);
  const editableRef = useRef(null);
  const displayRef = useRef(null);
  const downloadMenuRef = useRef(null);
  const [editableHtml, setEditableHtml] = useState("");
  const isMobileViewport =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(max-width: 720px)").matches;
  const kindLabel = getArtifactLabel(artifact?.type);
  const icon = useMemo(() => {
    if (artifact?.type === "document") return <FileText size={16} />;
    return <MonitorPlay size={16} />;
  }, [artifact?.type]);

  if (!artifact) return null;

  useEffect(() => {
    if (!editing) return;
    if (isMobileViewport) return;
    const node = editableRef.current;
    if (!node) return;
    node.focus();
    const selection = window.getSelection?.();
    const range = document.createRange?.();
    if (selection && range) {
      range.selectNodeContents(node);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }, [editing, isMobileViewport]);

  useEffect(() => {
    if (isMobileViewport && editing) {
      setEditableHtml("");
      setEditing(false);
    }
  }, [isMobileViewport, editing]);

  useEffect(() => {
    if (artifact?.type !== "slides" || editing) return;
    const node = displayRef.current;
    if (!node) return;
    node.scrollTop = 0;
  }, [artifact?.type, artifact?.sourceMarkdown, activeSlideIndex, editing]);

  useEffect(() => {
    if (!downloadMenuOpen) return;
    const handlePointerDown = (event) => {
      if (downloadMenuRef.current?.contains(event.target)) return;
      setDownloadMenuOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [downloadMenuOpen]);

  const handleDownload = async (format = null) => {
    const downloadBlob = (blob, filename) => {
      const safeFilename = filename.replace(/[\\/:*?"<>|]+/g, "-");
      if (
        isMobileViewport &&
        typeof navigator !== "undefined" &&
        typeof File !== "undefined" &&
        typeof navigator.share === "function"
      ) {
        const file = new File([blob], safeFilename, { type: blob.type || "application/octet-stream" });
        if (!navigator.canShare || navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: safeFilename }).catch(() => {});
          return;
        }
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = safeFilename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 250);
    };

    const selectedFormat = format || (artifact.type === "document" ? "pdf" : null);

    if (artifact.type === "document" && selectedFormat === "md") {
      const payload = buildDownloadPayload(artifact);
      const blob = new Blob([payload.content || ""], { type: payload.mimeType || "text/markdown;charset=utf-8" });
      downloadBlob(blob, payload.filename || `${String(artifact.title || "document")}.md`);
      if (typeof onDownload === "function") onDownload(payload);
      return;
    }

    if (artifact.type === "document" && selectedFormat === "docx") {
      const docx = await import("docx");
      const {
        AlignmentType,
        BorderStyle,
        Document,
        HeadingLevel,
        Packer,
        Paragraph,
        Table,
        TableCell,
        TableLayoutType,
        TableRow,
        TextRun,
        WidthType,
      } = docx;
      const runsFromMarkdown = (text) =>
        buildPptxRunsFromMarkdown(text).map((run) =>
          new TextRun({
            text: run.text,
            bold: Boolean(run.options?.bold),
            italics: Boolean(run.options?.italic),
            font: run.options?.fontFace || (run.options?.fontFamily ? run.options.fontFamily : undefined),
          })
        );
      const children = [];
      const parsedDocument =
        artifact.sourceMarkdown
          ? parseDocumentMarkdownBlocks(artifact.sourceMarkdown)
          : { title: String(artifact.title || "Document"), blocks: [] };
      const titleText = String(parsedDocument.title || documentPreview?.title || artifact.title || "Document").trim();
      if (titleText) {
        children.push(
          new Paragraph({
            heading: HeadingLevel.TITLE,
            spacing: { after: 260 },
            children: runsFromMarkdown(titleText),
          })
        );
      }
      if (artifact.subtitle) {
        children.push(
          new Paragraph({
            spacing: { after: 180 },
            children: runsFromMarkdown(String(artifact.subtitle)),
          })
        );
      }

      if (artifact.sourceMarkdown) {
        let lastBlockType = artifact.subtitle ? "subtitle" : "title";
        parsedDocument.blocks.forEach((block) => {
          if (!block) return;

          if (block.type === "gap") {
            if (lastBlockType !== "gap" && lastBlockType !== "separator") {
              children.push(new Paragraph({ spacing: { after: 80 } }));
              lastBlockType = "gap";
            }
            return;
          }

          if (block.type === "separator") {
            lastBlockType = "separator";
            return;
          }

          if (block.type === "heading") {
            children.push(
              new Paragraph({
                heading: HeadingLevel.HEADING_1,
                spacing: {
                  before: lastBlockType === "separator" ? 80 : 220,
                  after: 120,
                },
                children: runsFromMarkdown(block.text),
              })
            );
            lastBlockType = "heading";
            return;
          }

          if (block.type === "bullet") {
            children.push(
              new Paragraph({
                bullet: { level: 0 },
                spacing: { after: 80 },
                children: runsFromMarkdown(block.text),
              })
            );
            lastBlockType = "bullet";
            return;
          }

          if (block.type === "table" && block.table?.columns?.length) {
            const columnCount = Math.max(1, block.table.columns.length);
            const tableWidth = 9000;
            const columnWidth = Math.floor(tableWidth / columnCount);
            const table = new Table({
              width: {
                size: tableWidth,
                type: WidthType.DXA,
              },
              columnWidths: Array(columnCount).fill(columnWidth),
              layout: TableLayoutType.FIXED,
              rows: [
                new TableRow({
                  tableHeader: true,
                  children: block.table.columns.map((column) =>
                    new TableCell({
                      width: {
                        size: columnWidth,
                        type: WidthType.DXA,
                      },
                      shading: { fill: "F8F8F8" },
                      borders: {
                        top: { style: BorderStyle.SINGLE, color: "D6D6D6", size: 1 },
                        bottom: { style: BorderStyle.SINGLE, color: "D6D6D6", size: 1 },
                        left: { style: BorderStyle.SINGLE, color: "D6D6D6", size: 1 },
                        right: { style: BorderStyle.SINGLE, color: "D6D6D6", size: 1 },
                      },
                      margins: { top: 90, bottom: 90, left: 120, right: 120 },
                      children: [
                        new Paragraph({
                          alignment: AlignmentType.LEFT,
                          spacing: { after: 0 },
                          children: runsFromMarkdown(`**${column}**`),
                        }),
                      ],
                    })
                  ),
                }),
                ...block.table.rows.map((row) =>
                  new TableRow({
                    children: block.table.columns.map((_, columnIndex) =>
                      new TableCell({
                        width: {
                          size: columnWidth,
                          type: WidthType.DXA,
                        },
                        borders: {
                          top: { style: BorderStyle.SINGLE, color: "E4E4E7", size: 1 },
                          bottom: { style: BorderStyle.SINGLE, color: "E4E4E7", size: 1 },
                          left: { style: BorderStyle.SINGLE, color: "E4E4E7", size: 1 },
                          right: { style: BorderStyle.SINGLE, color: "E4E4E7", size: 1 },
                        },
                        margins: { top: 90, bottom: 90, left: 120, right: 120 },
                        children: [
                          new Paragraph({
                            alignment: AlignmentType.LEFT,
                            spacing: { after: 0 },
                            children: runsFromMarkdown(String(row[columnIndex] || "")),
                          }),
                        ],
                      })
                    ),
                  })
                ),
              ],
            });
            children.push(table);
            children.push(new Paragraph({ spacing: { after: 120 } }));
            lastBlockType = "table";
            return;
          }

          if (block.type === "paragraph") {
            children.push(
              new Paragraph({
                spacing: { after: 120 },
                children: runsFromMarkdown(block.text),
              })
            );
            lastBlockType = "paragraph";
          }
        });
      } else {
        (artifact.sections || []).forEach((section) => {
          children.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_1,
              spacing: { before: 220, after: 120 },
              children: runsFromMarkdown(String(section.heading || "")),
            })
          );
          (section.paragraphs || []).forEach((paragraph) => {
            children.push(
              new Paragraph({
                spacing: { after: 120 },
                children: runsFromMarkdown(String(paragraph || "")),
              })
            );
          });
          (section.bullets || []).forEach((bullet) => {
            children.push(
              new Paragraph({
                bullet: { level: 0 },
                spacing: { after: 80 },
                children: runsFromMarkdown(String(bullet || "")),
              })
            );
          });
        });
      }
      const doc = new Document({
        sections: [{ properties: {}, children }],
      });
      const blob = await Packer.toBlob(doc);
      const filename = `${String(artifact.title || "document")}.docx`;
      downloadBlob(blob, filename);
      if (typeof onDownload === "function") {
        onDownload({
          filename,
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          content: "",
        });
      }
      return;
    }

    if (artifact.type === "slides") {
      const { default: PptxGenJS } = await import("pptxgenjs");
      const pptx = new PptxGenJS();
      pptx.layout = "LAYOUT_WIDE";
      pptx.author = "Core AI";
      pptx.company = "Core AI";
      pptx.subject = String(slideDeck?.title || artifact.title || "Slides");
      pptx.title = String(slideDeck?.title || artifact.title || "Slides");
      pptx.lang = "pt-PT";

      const slides = resolvedSlides?.length
        ? resolvedSlides
        : Array.isArray(artifact.slides)
          ? artifact.slides
          : [];
      if (!slides.length) return;

      slides.forEach((slide) => {
        const page = pptx.addSlide();
        page.background = { color: "FFFFFF" };
        page.addText(buildPptxRunsFromMarkdown(String(slide.title || artifact.title || "Slide"), {
          fontFace: "Arial",
          color: "111111",
        }), {
          x: 0.6,
          y: 0.5,
          w: 12,
          h: 0.8,
          fontFace: "Arial",
          fontSize: 24,
          bold: true,
          color: "111111",
          margin: 0,
        });

        let cursorY = 1.4;
        if (slide.subtitle) {
          page.addText(buildPptxRunsFromMarkdown(String(slide.subtitle), {
            fontFace: "Arial",
            color: "4B5563",
          }), {
            x: 0.6,
            y: cursorY,
            w: 12,
            h: 0.5,
            fontFace: "Arial",
            fontSize: 14,
            color: "4B5563",
            margin: 0,
          });
          cursorY += 0.7;
        }

        const tableBlock = extractFirstMarkdownTableBlock(slide.contentLines || []);
        if (tableBlock) {
          const table = parseMarkdownTableRows(tableBlock.lines.join("\n"));
          if (table?.columns?.length) {
            const rows = [
              table.columns.map((cell) => ({ text: String(cell || ""), options: { bold: true, color: "111111" } })),
              ...table.rows.map((row) => row.map((cell) => String(cell || ""))),
            ];
            page.addTable(rows, {
              x: 0.6,
              y: cursorY,
              w: 12,
              border: { type: "solid", color: "D1D5DB", pt: 1 },
              fill: "FFFFFF",
              color: "111111",
              fontFace: "Arial",
              fontSize: 11,
              margin: 0.08,
              rowH: 0.35,
            });
            cursorY += Math.min(4.2, 0.5 + rows.length * 0.35);
          }
        } else {
          const bullets = Array.isArray(slide.bullets) && slide.bullets.length
            ? slide.bullets
            : (slide.contentLines || [])
                .map((line) => String(line || "").trim())
                .filter((line) => line && !isSeparatorOnlyLine(line) && !/^##\s+/.test(line) && !/^Notes?:/i.test(line));

          if (bullets.length) {
            const bulletRuns = bullets.flatMap((bullet, index) => {
              const runs = buildPptxRunsFromMarkdown(
                String(bullet).replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, ""),
                { fontFace: "Arial", color: "111111" }
              );
              if (!runs.length) return [];
              runs[0] = {
                ...runs[0],
                options: {
                  ...runs[0].options,
                  bullet: { indent: 14 },
                },
              };
              runs[runs.length - 1] = {
                ...runs[runs.length - 1],
                options: {
                  ...runs[runs.length - 1].options,
                  breakLine: index < bullets.length - 1,
                },
              };
              return runs;
            });
            page.addText(
              bulletRuns,
              {
                x: 0.8,
                y: cursorY,
                w: 11.6,
                h: 4.8,
                fontFace: "Arial",
                fontSize: 16,
                color: "111111",
                paraSpaceAfterPt: 10,
                valign: "top",
                margin: 0,
              }
            );
            cursorY += Math.min(4.6, 0.45 * bullets.length + 0.4);
          }
        }

        if (slide.notes) {
          page.addText(buildPptxRunsFromMarkdown(`Notes: ${String(slide.notes)}`, {
            fontFace: "Arial",
            color: "6B7280",
          }), {
            x: 0.6,
            y: Math.min(6.6, cursorY + 0.2),
            w: 12,
            h: 0.6,
            fontFace: "Arial",
            fontSize: 11,
            italic: true,
            color: "6B7280",
            margin: 0,
          });
        }
      });

      pptx.write({ outputType: "arraybuffer" }).then((pptxBuffer) => {
        const blob = new Blob([pptxBuffer], {
          type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        });
        const filename = `${String(slideDeck?.title || artifact.title || "slides")}.pptx`;
        downloadBlob(blob, filename);
        if (typeof onDownload === "function") {
          onDownload({
            filename,
            mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            content: "",
          });
        }
      }).catch(() => {});
      return;
    }

    const target = pdfRenderRef.current;
    if (!target) return;

    html2canvas(target, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
    })
      .then((canvas) => {
        const pdf = new jsPDF("p", "pt", "a4");
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const imgWidth = pageWidth;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        const pageCanvasHeight = Math.max(1, Math.floor((pageHeight * canvas.width) / pageWidth));
        let offsetY = 0;
        let firstPage = true;

        while (offsetY < canvas.height) {
          const sliceHeight = Math.min(pageCanvasHeight, canvas.height - offsetY);
          const pageCanvas = document.createElement("canvas");
          pageCanvas.width = canvas.width;
          pageCanvas.height = sliceHeight;
          const pageCtx = pageCanvas.getContext("2d");
          if (!pageCtx) break;
          pageCtx.fillStyle = "#ffffff";
          pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
          pageCtx.drawImage(
            canvas,
            0,
            offsetY,
            canvas.width,
            sliceHeight,
            0,
            0,
            canvas.width,
            sliceHeight
          );

          const pageImgData = pageCanvas.toDataURL("image/png");
          const renderedHeight = (sliceHeight * imgWidth) / canvas.width;
          if (!firstPage) pdf.addPage();
          pdf.addImage(pageImgData, "PNG", 0, 0, imgWidth, renderedHeight);
          firstPage = false;
          offsetY += sliceHeight;
        }

        const pdfBuffer = pdf.output("arraybuffer");
        const blob = new Blob([pdfBuffer], { type: "application/pdf" });
        const filename = `${String(artifact.title || artifact.type || "artifact")}.pdf`;
        downloadBlob(blob, filename);
        if (typeof onDownload === "function") onDownload({ filename, mimeType: "application/pdf", content: "" });
      })
      .catch(() => {});
  };

  const handleCopy = async () => {
    const text = serializeArtifact(artifact);
    if (typeof onCopy === "function") {
      await onCopy(text);
      return;
    }
    await navigator.clipboard.writeText(text);
  };

  const activeSlide = artifact.type === "slides" ? artifact.slides[activeSlideIndex] || artifact.slides[0] : null;
  const documentPreview =
    artifact.type === "document" && artifact.sourceMarkdown
      ? renderMarkdownLikeDocument(artifact.sourceMarkdown, {
          bodyClassName: "artifact-document-markdown",
          keyPrefix: "artifact-doc",
        })
      : null;
  const pdfDocumentPreview =
    artifact.type === "document" && artifact.sourceMarkdown
      ? renderMarkdownLikeDocument(artifact.sourceMarkdown, {
          bodyClassName: "artifact-pdf-markdown",
          keyPrefix: "artifact-pdf-doc",
        })
      : null;
  const slideDeck =
    artifact.type === "slides" && artifact.sourceMarkdown
      ? parseSlidesFromMarkdown(artifact.sourceMarkdown, artifact)
      : artifact.type === "slides"
        ? { title: artifact.title, slides: artifact.slides || [] }
        : null;
  const resolvedSlides = slideDeck?.slides || [];
  const resolvedActiveSlide =
    artifact.type === "slides" ? resolvedSlides[activeSlideIndex] || resolvedSlides[0] || activeSlide : null;
  const normalizedSourceHtml = artifact.sourceHtml ? normalizeArtifactHtml(artifact.sourceHtml) : "";

  return (
    <>
      <div className={`artifact-card artifact-card--${artifact.type}`}>
        <div className="artifact-card-topbar">
          <div className="artifact-card-label">
            {icon}
            <span>{kindLabel}</span>
          </div>
          <div className="artifact-card-actions">
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEditableHtml("");
                    setEditing(false);
                  }}
                >
                  <X size={14} />
                  <span>Cancel</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const html = sanitizeEditableHtml(editableRef.current?.innerHTML || "");
                    const markdown = extractMarkdownFromHtml(html);
                    if (typeof onSave === "function") {
                      if (artifact.type === "slides") {
                        const next = Array.isArray(artifact.editedSlidesHtml) ? artifact.editedSlidesHtml.slice() : [];
                        next[activeSlideIndex] = html;
                        onSave({
                          ...artifact,
                          editedSlidesHtml: next,
                          sourceMarkdown: artifact.sourceMarkdown || serializeArtifact(artifact),
                        });
                      } else {
                        onSave({
                          ...artifact,
                          sourceHtml: html,
                          sourceMarkdown: markdown || artifact.sourceMarkdown || serializeArtifact(artifact),
                        });
                      }
                    }
                    setEditableHtml("");
                    setEditing(false);
                  }}
                >
                  <Check size={14} />
                  <span>Save</span>
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={handleCopy}>
                  <Copy size={14} />
                  <span>Copy</span>
                </button>
                {!isMobileViewport ? (
                  <button
                    type="button"
                    onClick={() => {
                      const html = sanitizeEditableHtml(displayRef.current?.innerHTML || "");
                      setEditableHtml(html);
                      setEditing(true);
                    }}
                  >
                    <Pencil size={14} />
                    <span>Edit</span>
                  </button>
                ) : null}
                {artifact.type === "document" ? (
                  <div className="artifact-download-menu-wrap" ref={downloadMenuRef}>
                    <button
                      type="button"
                      onClick={() => setDownloadMenuOpen((open) => !open)}
                    >
                      <Download size={14} />
                      <span>Download</span>
                    </button>
                    {downloadMenuOpen ? (
                      <div className="artifact-download-menu">
                        <button type="button" onClick={() => { setDownloadMenuOpen(false); handleDownload("pdf"); }}>
                          <span>Documento PDF (.pdf)</span>
                        </button>
                        <button type="button" onClick={() => { setDownloadMenuOpen(false); handleDownload("docx"); }}>
                          <span>Documento do Microsoft Word (.docx)</span>
                        </button>
                        <button type="button" onClick={() => { setDownloadMenuOpen(false); handleDownload("md"); }}>
                          <span>Documento Markdown (.md)</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <button type="button" onClick={() => handleDownload()}>
                    <Download size={14} />
                    <span>Download</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {artifact.type === "document" && (
          <div className="artifact-document">
            {editing ? (
              <EditableHtmlSurface
                editorRef={editableRef}
                className="artifact-rich-editable is-editing"
                initialHtml={editableHtml || artifact.sourceHtml || displayRef.current?.innerHTML || ""}
              />
            ) : artifact.sourceHtml ? (
              <div
                ref={displayRef}
                className="artifact-rich-editable"
                dangerouslySetInnerHTML={{ __html: normalizedSourceHtml }}
              />
            ) : documentPreview ? (
              <div ref={displayRef}>
                <h2>{documentPreview.title || artifact.title}</h2>
                {documentPreview.body}
              </div>
            ) : (
              <div ref={displayRef}>
                <h2>{artifact.title}</h2>
                {artifact.subtitle ? (
                  <RichTextParagraph
                    className="artifact-document-subtitle"
                    text={artifact.subtitle}
                    keyPrefix="doc-subtitle"
                  />
                ) : null}
                {artifact.sections.map((section, index) => (
                  <section key={`${section.heading}-${index}`} className="artifact-document-section">
                    <h3>{section.heading}</h3>
                    {(section.paragraphs || []).map((paragraph, paragraphIndex) => (
                      <RichTextParagraph
                        key={`${index}-${paragraphIndex}`}
                        text={paragraph}
                        keyPrefix={`doc-p-${index}-${paragraphIndex}`}
                      />
                    ))}
                    <RichTextList items={section.bullets} keyPrefix={`doc-b-${index}`} />
                  </section>
                ))}
              </div>
            )}
          </div>
        )}

        {artifact.type === "slides" && resolvedActiveSlide && (
          <div className="artifact-slides">
            <div className="artifact-slide-frame">
              <div className="artifact-slide-meta">
                <span>
                  Slide {activeSlideIndex + 1}/{resolvedSlides.length}
                </span>
              </div>
              {editing ? (
                <EditableHtmlSurface
                  editorRef={editableRef}
                  className="artifact-slide-surface artifact-rich-editable is-editing"
                  initialHtml={
                    editableHtml ||
                    (Array.isArray(artifact.editedSlidesHtml) ? artifact.editedSlidesHtml[activeSlideIndex] : "") ||
                    displayRef.current?.innerHTML ||
                    ""
                  }
                />
              ) : (
                <div className="artifact-slide-surface" ref={displayRef}>
                  <div className="artifact-slide-content">
                    {Array.isArray(artifact.editedSlidesHtml) && artifact.editedSlidesHtml[activeSlideIndex] ? (
                      <div
                        dangerouslySetInnerHTML={{
                          __html: normalizeArtifactHtml(artifact.editedSlidesHtml[activeSlideIndex]),
                        }}
                      />
                    ) : (
                      <>
                        <h2>{resolvedActiveSlide.title}</h2>
                        {resolvedActiveSlide.subtitle ? (
                          <RichTextParagraph
                            className="artifact-slide-subtitle"
                            text={resolvedActiveSlide.subtitle}
                            keyPrefix={`slide-subtitle-${activeSlideIndex}`}
                          />
                        ) : null}
                        {Array.isArray(resolvedActiveSlide.contentLines) && resolvedActiveSlide.contentLines.length ? (
                          <div className="artifact-slide-body">
                            {renderMarkdownBlocks(resolvedActiveSlide.contentLines, {
                              keyPrefix: `slide-block-${activeSlideIndex}`,
                              tableClassName: "artifact-slide-table",
                            })}
                          </div>
                        ) : (
                          <RichTextList
                            items={resolvedActiveSlide.bullets || []}
                            keyPrefix={`slide-bullet-${activeSlideIndex}`}
                            className="artifact-slide-list"
                          />
                        )}
                        {resolvedActiveSlide.notes ? (
                          <RichTextParagraph
                            className="artifact-slide-notes"
                            text={resolvedActiveSlide.notes}
                            keyPrefix={`slide-notes-${activeSlideIndex}`}
                          />
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
            {!editing && resolvedSlides.length > 1 ? (
              <div className="artifact-slide-nav">
                <button
                  type="button"
                  onClick={() => setActiveSlideIndex((prev) => Math.max(0, prev - 1))}
                  disabled={activeSlideIndex === 0}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setActiveSlideIndex((prev) => Math.min(resolvedSlides.length - 1, prev + 1))
                  }
                  disabled={activeSlideIndex >= resolvedSlides.length - 1}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            ) : null}
          </div>
        )}

      </div>

      {artifact.type === "document" ? (
        <div className="artifact-pdf-render" aria-hidden="true">
          <div ref={pdfRenderRef} className="artifact-pdf-page">
            <div className="artifact-pdf-inner">
              {artifact.sourceHtml ? (
                <div
                  className="artifact-pdf-rich"
                  dangerouslySetInnerHTML={{ __html: normalizedSourceHtml }}
                />
              ) : documentPreview ? (
                <>
                  <h1>{pdfDocumentPreview?.title || documentPreview.title || artifact.title}</h1>
                  {pdfDocumentPreview?.body}
                </>
              ) : (
                <>
                  <h1>{artifact.title}</h1>
                  {artifact.subtitle ? (
                    <RichTextParagraph
                      className="artifact-pdf-subtitle"
                      text={artifact.subtitle}
                      keyPrefix="pdf-subtitle"
                    />
                  ) : null}
                  {artifact.sections.map((section, index) => (
                    <section key={`pdf-${section.heading}-${index}`} className="artifact-pdf-section">
                      <h2>{section.heading}</h2>
                      {(section.paragraphs || []).map((paragraph, paragraphIndex) => (
                        <RichTextParagraph
                          key={`pdf-p-${index}-${paragraphIndex}`}
                          text={paragraph}
                          keyPrefix={`pdf-p-${index}-${paragraphIndex}`}
                        />
                      ))}
                      <RichTextList items={section.bullets} keyPrefix={`pdf-b-${index}`} />
                    </section>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {artifact.type === "slides" ? (
        <div className="artifact-pdf-render" aria-hidden="true">
          <div ref={pdfRenderRef} className="artifact-pdf-pages">
            {(resolvedSlides || []).map((slide, index) => (
              <div key={`pdf-slide-${index}`} className="artifact-pdf-page artifact-pdf-slide-page">
                <div className="artifact-pdf-slide-meta">
                  <span>
                    Slide {index + 1}/{resolvedSlides.length}
                  </span>
                </div>
                <div className="artifact-pdf-slide-surface">
                  {Array.isArray(artifact.editedSlidesHtml) && artifact.editedSlidesHtml[index] ? (
                    <div
                      className="artifact-pdf-rich artifact-pdf-slide-rich"
                      dangerouslySetInnerHTML={{ __html: normalizeArtifactHtml(artifact.editedSlidesHtml[index]) }}
                    />
                  ) : (
                    <>
                      <h1>{slide.title}</h1>
                      {slide.subtitle ? (
                        <RichTextParagraph
                          className="artifact-pdf-subtitle"
                            text={slide.subtitle}
                            keyPrefix={`pdf-slide-subtitle-${index}`}
                          />
                      ) : null}
                      {Array.isArray(slide.contentLines) && slide.contentLines.length ? (
                        <div className="artifact-pdf-slide-body">
                          {renderMarkdownBlocks(slide.contentLines, {
                            keyPrefix: `pdf-slide-block-${index}`,
                            tableClassName: "artifact-pdf-table",
                          })}
                        </div>
                      ) : (
                        <RichTextList
                          items={slide.bullets}
                          keyPrefix={`pdf-slide-b-${index}`}
                          className="artifact-pdf-slide-list"
                        />
                      )}
                      {slide.notes ? (
                        <div className="artifact-pdf-slide-notes">
                          <h2>Notes</h2>
                          <RichTextParagraph
                            text={slide.notes}
                            keyPrefix={`pdf-slide-notes-${index}`}
                          />
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {null}
    </>
  );
}

export function ArtifactPreviewCard({ type, previewText }) {
  const label = getArtifactLabel(type);
  const icon =
    type === "document" ? <FileText size={16} /> : <MonitorPlay size={16} />;
  const preview = renderMarkdownLikeDocument(previewText, {
    bodyClassName: "artifact-preview-body",
    keyPrefix: "preview",
  });

  return (
    <div className={`artifact-card artifact-card--${type}`}>
      <div className="artifact-card-topbar">
        <div className="artifact-card-label">
          {icon}
          <span>{label}</span>
        </div>
      </div>
      <div className="artifact-document artifact-preview">
        {preview.title ? <h2>{preview.title}</h2> : null}
        {preview.body ? (
          preview.body
        ) : (
          <div className="artifact-preview-loading">...</div>
        )}
      </div>
    </div>
  );
}
