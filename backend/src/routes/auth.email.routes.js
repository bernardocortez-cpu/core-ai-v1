const express = require("express");
const router = express.Router();

console.log("🔥 AUTH EMAIL ROUTER FILE LOADED");

router.post("/request-email", (req, res) => {
  console.log("🔥 POST /auth-email/request-email HIT");
  res.json({ ok: true });
});

module.exports = router;

