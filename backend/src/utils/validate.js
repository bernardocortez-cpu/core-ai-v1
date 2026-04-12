function isValidEmail(email) {
  if (!email || typeof email !== "string") return false;
  const e = email.trim().toLowerCase();
  if (e.length < 5 || e.length > 254) return false;
  // validação pragmática (suficiente para este caso)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

module.exports = { isValidEmail };
