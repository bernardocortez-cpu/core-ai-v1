const crypto = require("crypto");

/**
 * Gera token seguro (em claro) para enviar no link.
 * Guardamos APENAS o hash na DB (SHA-256).
 */
function generateRawToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex"); // 64 chars se bytes=32
}

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

module.exports = { generateRawToken, sha256 };
