function intFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Default allows long AI answers without breaking persistence, while still preventing abuse.
// Postgres TEXT can store much larger values; this limit is primarily an API safeguard.
const MAX_MESSAGE_CONTENT_CHARS = intFromEnv("MAX_MESSAGE_CONTENT_CHARS", 200_000);

// Max number of content parts in a single message when using "parts arrays"
// (e.g. OpenAI-style {type:"text"|"image_url"|"file"...}[]).
// This needs to be large enough to support multi-file prompts.
const MAX_MESSAGE_CONTENT_PARTS = intFromEnv("MAX_MESSAGE_CONTENT_PARTS", 32);

module.exports = { MAX_MESSAGE_CONTENT_CHARS, MAX_MESSAGE_CONTENT_PARTS };
