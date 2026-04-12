// backend/src/config/auth.js

const EMAIL_VERIFY_TTL_MINUTES = Number(
  process.env.EMAIL_VERIFY_TTL_MINUTES || 30
);

function getAppUrl() {
  const url = process.env.APP_URL || "http://localhost:5173";
  return url.replace(/\/$/, "");
}

module.exports = {
  EMAIL_VERIFY_TTL_MINUTES,
  getAppUrl,
};
