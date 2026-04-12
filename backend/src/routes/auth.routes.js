const express = require("express");
const router = express.Router();

// IMPORT CORRETO (a partir de src/routes → src/controllers)
const authController = require("../controllers/auth.controller");
const { authLimiter } = require("../middleware/rateLimit");
const { requireAuth } = require("../middleware/auth");

// Rotas clássicas de auth (mantêm-se)
router.post("/register", authLimiter, authController.register);
router.post("/request-magic-link", authLimiter, authController.requestMagicLink);
router.get("/magic-link/verify", authController.verifyMagicLink);
router.post("/refresh", authController.refresh);
router.post("/logout", authController.logout);
router.delete("/me", requireAuth, authController.deleteMe);
router.post("/resend-verification", authLimiter, authController.resendVerification);
router.get("/verify-email", authController.verifyEmail);
router.post("/login", authLimiter, authController.login);
router.post("/forgot-password", authLimiter, authController.forgotPassword);
router.post("/reset-password", authLimiter, authController.resetPassword);

// OAuth (Google já preparado)
router.get("/google", authController.googleStart);
router.get("/google/callback", authController.googleCallback);
router.get("/oauth/google/callback", authController.googleCallback);

router.get("/apple", authController.appleStart);
router.get("/apple/callback", authController.appleCallback);
router.post("/apple/callback", authController.appleCallback);
router.get("/oauth/apple/callback", authController.appleCallback);
router.post("/oauth/apple/callback", authController.appleCallback);

module.exports = router;



