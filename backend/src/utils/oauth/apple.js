const jwt = require("jsonwebtoken");
const axios = require("axios");

async function verify(identityToken) {
  const decoded = jwt.decode(identityToken, { complete: true });
  if (!decoded) {
    throw Object.assign(new Error("APPLE_TOKEN_INVALID"), { status: 401 });
  }

  return {
    email: decoded.payload.email,
    providerId: decoded.payload.sub,
    name: null, // Apple não envia nome sempre
  };
}

module.exports = { verify };
