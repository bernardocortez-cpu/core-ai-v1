const crypto = require("crypto");

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

module.exports = { randomToken, sha256 };
