const { isTransientDbError } = require("../utils/dbErrors");

function errorHandler(err, req, res, next) {
  let status = err.status || 500;
  if (status >= 500 && isTransientDbError(err)) status = 503;

  // Body parser payload limits (e.g., large multimodal chat payloads).
  if (err && (err.type === "entity.too.large" || err.name === "PayloadTooLargeError")) {
    return res.status(413).json({ error: "PAYLOAD_TOO_LARGE" });
  }

  if (err.name === "ZodError") {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      details: err.issues,
    });
  }

  // Avoid noisy stack traces for expected auth/user errors (401/403/404).
  // Keep full logs for 5xx and when explicitly debugging.
  const debug = process.env.DEBUG_ERRORS === "1";
  const noisy = debug || (status >= 500 && err.message !== "DB_UNAVAILABLE");
  if (noisy) {
    console.error(err);
  } else if (process.env.NODE_ENV !== "production") {
    // Minimal log in dev so you still know what's happening.
    console.warn(`[${status}] ${err.message}`);
  }

  const errorCode = status === 503 ? "DB_UNAVAILABLE" : err.message || "INTERNAL_ERROR";

  res.status(status).json({
    error: errorCode,
    details: err.details || undefined,
  });
}

module.exports = { errorHandler };
