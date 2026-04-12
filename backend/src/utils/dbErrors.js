function toMessage(err) {
  return String(err?.message || "");
}

function hasConnResetMessage(msg) {
  const m = String(msg || "");
  const ml = m.toLowerCase();

  // Windows commonly reports connection resets with 10054.
  if (m.includes("10054")) return true;

  // Node/network error strings.
  if (m.includes("ECONNRESET") || ml.includes("socket hang up")) return true;
  if (m.includes("ConnectionReset")) return true;

  // Postgres/server-side phrasing.
  if (ml.includes("server closed the connection unexpectedly")) return true;
  if (ml.includes("connection terminated unexpectedly")) return true;

  return false;
}

function isTransientDbError(err) {
  // Prisma known transient codes.
  if (err?.code === "P2024") return true; // connection pool timeout
  if (err?.code === "P1001") return true; // can't reach database server
  if (err?.code === "P1002") return true; // timed out

  const msg = toMessage(err);
  if (hasConnResetMessage(msg)) return true;

  // Prisma message when the DB host/port is unreachable.
  if (msg.includes("Can't reach database server")) return true;
  if (msg.includes("Please make sure your database server is running at")) return true;

  // Sometimes nested causes carry the OS error.
  const causeMsg = toMessage(err?.cause);
  if (hasConnResetMessage(causeMsg)) return true;
  if (causeMsg.includes("Can't reach database server")) return true;

  const msgLower = msg.toLowerCase();

  // Seen with poolers; treat as transient so we don't log users out.
  if (msgLower.includes("prepared statement") && msgLower.includes("does not exist")) {
    return true;
  }

  // Prisma message for pool exhaustion.
  if (msg.includes("Timed out fetching a new connection from the connection pool")) {
    return true;
  }

  return false;
}

module.exports = { isTransientDbError };
