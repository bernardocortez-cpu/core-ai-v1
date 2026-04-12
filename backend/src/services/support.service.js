const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const prisma = require("../lib/prisma");

const SUPPORT_MAX_ATTACHMENTS = 2;
const SUPPORT_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const SUPPORT_MAX_TOTAL_BYTES = 8 * 1024 * 1024;

function sanitizeFilename(name) {
  const cleaned = String(name || "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "attachment";
}

function parseAttachmentDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) {
    const err = new Error("INVALID_SUPPORT_ATTACHMENT");
    err.status = 400;
    throw err;
  }
  return {
    type: match[1],
    contentBase64: match[2].replace(/\s+/g, ""),
  };
}

function mimeToExtension(mimeType) {
  const mime = String(mimeType || "").trim().toLowerCase();
  const known = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "text/plain": ".txt",
    "application/json": ".json",
    "text/csv": ".csv",
    "application/pdf": ".pdf",
    "application/zip": ".zip",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  };
  return known[mime] || "";
}

async function persistAttachments(attachments) {
  const list = Array.isArray(attachments) ? attachments.slice(0, SUPPORT_MAX_ATTACHMENTS) : [];
  if (list.length === 0) return [];

  const uploadsRoot = path.join(process.cwd(), "uploads");
  const supportDir = path.join(uploadsRoot, "support");
  await fs.mkdir(supportDir, { recursive: true });

  let totalBytes = 0;
  const saved = [];

  for (const item of list) {
    const size = Number(item?.size || 0);
    if (!Number.isFinite(size) || size <= 0 || size > SUPPORT_MAX_FILE_SIZE_BYTES) {
      const err = new Error("SUPPORT_ATTACHMENT_TOO_LARGE");
      err.status = 400;
      throw err;
    }

    totalBytes += size;
    if (totalBytes > SUPPORT_MAX_TOTAL_BYTES) {
      const err = new Error("SUPPORT_ATTACHMENTS_TOO_LARGE");
      err.status = 400;
      throw err;
    }

    const parsed = parseAttachmentDataUrl(item?.dataUrl);
    const originalName = sanitizeFilename(item?.name);
    const ext = path.extname(originalName) || mimeToExtension(parsed.type);
    const safeBase = path.basename(originalName, path.extname(originalName)).slice(0, 80) || "attachment";
    const storedName = `${Date.now()}-${crypto.randomUUID()}-${safeBase}${ext}`;
    const diskPath = path.join(supportDir, storedName);

    await fs.writeFile(diskPath, Buffer.from(parsed.contentBase64, "base64"));

    saved.push({
      name: originalName,
      type: parsed.type || String(item?.type || "").trim() || "application/octet-stream",
      size,
      path: `/media/support/${storedName}`,
      storedName,
    });
  }

  return saved;
}

async function submitSupportRequest({ user, reporter, message, attachments, context }) {
  const authUser = user && typeof user === "object" ? user : null;
  const safeReporter = reporter && typeof reporter === "object" ? reporter : {};
  const reporterEmail = String(safeReporter.email || authUser.email || "").trim();
  const reporterName = String(safeReporter.name || authUser.name || "").trim() || null;

  const cleanMessage = String(message || "").trim();
  if (!cleanMessage) {
    const err = new Error("VALIDATION_ERROR");
    err.status = 400;
    throw err;
  }

  const cleanContext = context && typeof context === "object" ? context : {};
  const savedAttachments = await persistAttachments(attachments);
  const supportRequestId = crypto.randomUUID();
  const uploadsRoot = path.join(process.cwd(), "uploads");
  const requestDir = path.join(uploadsRoot, "support", "requests");

  await fs.mkdir(requestDir, { recursive: true });

  const requestPayload = {
    id: supportRequestId,
    createdAt: new Date().toISOString(),
    userId: authUser?.id || null,
    userEmail: reporterEmail || null,
    userName: reporterName,
    message: cleanMessage,
    attachments: savedAttachments,
    context: cleanContext,
  };

  await fs.writeFile(
    path.join(requestDir, `${supportRequestId}.json`),
    JSON.stringify(requestPayload, null, 2),
    "utf8"
  );

  let record = {
    id: supportRequestId,
    createdAt: requestPayload.createdAt,
    attachments: savedAttachments,
    userEmail: requestPayload.userEmail,
    userName: requestPayload.userName,
    message: cleanMessage,
    storage: "file",
  };

  try {
    const rows = await prisma.$queryRawUnsafe(
      `
        INSERT INTO "SupportRequest"
          ("id", "userId", "userEmail", "userName", "message", "attachments", "context", "createdAt", "updatedAt")
        VALUES
          ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, NOW(), NOW())
        RETURNING "id", "createdAt", "attachments", "userEmail", "userName", "message"
      `,
      supportRequestId,
      authUser?.id || null,
      requestPayload.userEmail,
      requestPayload.userName,
      cleanMessage,
      JSON.stringify(savedAttachments),
      JSON.stringify(cleanContext)
    );
    const dbRecord = Array.isArray(rows) ? rows[0] : rows;
    if (dbRecord) record = { ...dbRecord, storage: "file+db" };
  } catch (e) {
    console.warn("[support] db persistence skipped:", e?.message || e);
  }

  return { ok: true, supportRequest: record };
}

module.exports = { submitSupportRequest };
