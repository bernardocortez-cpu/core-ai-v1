/* Patch frontend Creative Studio to:
 * 1) Render attachments above the sent user message (same as chat UI)
 * 2) Send an input image to the backend Creative API so image-to-image works (v1: OpenAI only)
 *
 * This script is idempotent and creates .bak backups next to files.
 */

const fs = require("fs");
const path = require("path");

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeUtf8WithBackup(filePath, content) {
  const bak = `${filePath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  fs.writeFileSync(bak, readUtf8(filePath), "utf8");
  fs.writeFileSync(filePath, content, "utf8");
  return bak;
}

function mustInclude(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    throw new Error(`PATCH_FAILED: missing marker for ${label}: ${needle}`);
  }
}

function patchCreativeStudioJsx(filePath) {
  const src = readUtf8(filePath);

  // If the previous patch attempt corrupted the file (because of the `=>` token),
  // restore from the most recent .bak backup next to this file.
  let base = src;
  if (base.includes("onClick={() =></button>")) {
    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath);
    const bakPrefix = `${baseName}.bak-`;
    const candidates = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith(bakPrefix))
      .map((n) => ({
        name: n,
        fullPath: path.join(dir, n),
        mtimeMs: fs.statSync(path.join(dir, n)).mtimeMs,
      }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    if (!candidates.length) {
      throw new Error("PATCH_FAILED: CreativeStudio.jsx is corrupted and no .bak backup was found to restore it.");
    }

    base = readUtf8(candidates[0].fullPath);
  }

  let next = base;

  // 1) Remove duplicate "X" in the attach tiles: in App.jsx, the button is empty and CSS draws × via ::before.
  // CreativeStudio.jsx had a literal "×" line inside the button, causing a double X.
  {
    const lines = next.split(/\r?\n/);
    const out = [];
    for (let i = 0; i < lines.length; i += 1) {
      const trimmed = lines[i].trim();
      const isXLine = trimmed === "×" || trimmed === "Ã—";
      if (isXLine) {
        const lookback = lines.slice(Math.max(0, i - 12), i).join("\n");
        const nextLine = lines[i + 1] || "";
        if (lookback.includes('className="attach-x"') && nextLine.includes("</button>")) {
          continue;
        }
      }
      out.push(lines[i]);
    }
    next = out.join("\n");
  }

  const wrapperNeedle = '<div key={i} className="msg-wrapper">';
  const msgNeedle =
    '<div className={`msg ${m.role === "user" ? "msg-user" : "msg-ai"}`}>';

  const hasMsgAttachments = next.includes('className="msg-attachments"') && next.includes("msg-attach-tile");
  if (!hasMsgAttachments) {
    mustInclude(next, wrapperNeedle, "CreativeStudio wrapper");
    mustInclude(next, msgNeedle, "CreativeStudio msg div");

    const wrapperIndex = next.indexOf(wrapperNeedle);
    const insertAt = next.indexOf(msgNeedle, wrapperIndex);
    if (insertAt < 0) {
      throw new Error("PATCH_FAILED: could not locate msg div after wrapper");
    }

    // Same attachments UI used in App.jsx (above the bubble).
    const attachmentBlock =
      `\n            {m.role === "user" && Array.isArray(m.attachments) && m.attachments.length > 0 && (\n` +
      `              <div className="msg-attachments">\n` +
      `                {m.attachments.map((a) => (\n` +
      `                  <div key={a.id || a.name} className="msg-attach-tile">\n` +
      `                    {a.isImage && a.previewUrl ? (\n` +
      `                      <img className="msg-attach-thumb" src={a.previewUrl} alt={a.name} />\n` +
      `                    ) : (\n` +
      `                      <div className="msg-attach-file" aria-hidden="true">\n` +
      `                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="size-6" aria-hidden="true">\n` +
      `                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z\" />\n` +
      `                        </svg>\n` +
      `                      </div>\n` +
      `                    )}\n` +
      `                    <div className="msg-attach-meta">\n` +
      `                      <div className="msg-attach-name">{a.name}</div>\n` +
      `                      <div className="msg-attach-sub">{formatBytes(a.size)}</div>\n` +
      `                    </div>\n` +
      `                  </div>\n` +
      `                ))}\n` +
      `              </div>\n` +
      `            )}\n`;

    next = next.slice(0, insertAt) + attachmentBlock + next.slice(insertAt);
  }

  if (next === src) return { changed: false };
  const bak = writeUtf8WithBackup(filePath, next);
  return { changed: true, backup: bak };
}

function patchAppJsx(filePath) {
  const src = readUtf8(filePath);

  let next = src;

  // Remove the previous auto-switch to GPT Image (we now support img2img for all models via backend fallback).
  next = next.replace(
    /\n\s*if\s*\(\s*inputImage\s*&&\s*modelIdToUse\s*!==\s*"gpt-image-1\.5"\s*&&\s*modelIdToUse\s*!==\s*"gpt-image-1"\s*\)\s*\{[\s\S]*?\n\s*\}\s*\n/g,
    "\n"
  );

  const fetchMarker = "const res = await fetch(`/api/ai/creative/image`, {";
  mustInclude(next, fetchMarker, "App creative fetch");

  const prepBlock =
    `        const firstImageAttachment = (sentAttachments || []).find((a) => a && a.isImage && a.file);\n` +
    `        let inputImage = null;\n` +
    `        let modelIdToUse = activeCreativeModel;\n` +
    `\n` +
    `        if (firstImageAttachment?.file) {\n` +
    `          try {\n` +
    `            inputImage = await readImageAsScaledDataUrl(firstImageAttachment.file);\n` +
    `          } catch {}\n` +
    `        }\n` +
    `\n` +
    `        if (inputImage && modelIdToUse !== \"gpt-image-1.5\" && modelIdToUse !== \"gpt-image-1\") {\n` +
    `          modelIdToUse = \"gpt-image-1.5\";\n` +
    `          if (activeCreativeModel !== modelIdToUse) setActiveCreativeModel(modelIdToUse);\n` +
    `          showGlobalToast(\"Image-to-image so funciona no GPT Image 1.5 (por agora). Troquei automaticamente.\");\n` +
    `        }\n` +
    `\n`;

  // If the block was already inserted, don't insert it again.
  if (!next.includes("const firstImageAttachment = (sentAttachments || []).find")) {
    next = next.replace(fetchMarker, `${prepBlock}${fetchMarker}`);
  }

  const bodyNeedle =
    `body: JSON.stringify({\n            modelId: activeCreativeModel,\n            prompt: text,\n            size: \"1024x1024\",\n          }),`;
  const alreadyPatchedBody = next.includes("inputImage: inputImage") && next.includes("attachments: attachmentMeta");
  if (!alreadyPatchedBody) {
    mustInclude(next, bodyNeedle, "App creative request body");

    const bodyReplace =
      `body: JSON.stringify({\n` +
      `            modelId: modelIdToUse,\n` +
      `            prompt: text,\n` +
      `            size: \"1024x1024\",\n` +
      `            inputImage: inputImage || undefined,\n` +
      `            attachments: attachmentMeta.length > 0 ? attachmentMeta : undefined,\n` +
      `          }),`;

    next = next.replace(bodyNeedle, bodyReplace);
  }

  if (next === src) return { changed: false };
  const bak = writeUtf8WithBackup(filePath, next);
  return { changed: true, backup: bak };
}

function main() {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const appJsx = path.join(repoRoot, "frontend", "src", "App.jsx");
  const creativeStudio = path.join(repoRoot, "frontend", "src", "CreativeStudio.jsx");

  const out = {
    app: patchAppJsx(appJsx),
    creativeStudio: patchCreativeStudioJsx(creativeStudio),
  };

  console.log(JSON.stringify(out, null, 2));
}

main();
