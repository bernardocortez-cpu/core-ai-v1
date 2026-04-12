console.log("🔥 APP.JS REAL A SER USADO");

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const path = require("path");
const { errorHandler } = require("./middleware/error");

function createApp() {
  const app = express();

  const envOrigins = (process.env.CORS_ORIGINS || process.env.APP_URL || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const allowedOrigins = new Set([
    ...envOrigins,
    // Common dev origins (Vite can hop ports).
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
  ]);

  app.use(
    cors({
      origin(origin, cb) {
        // Allow non-browser clients (curl, Postman) with no Origin header.
        if (!origin) return cb(null, true);

        // In dev, allow localhost/127.0.0.1 on any port to avoid CORS pain.
        if (
          process.env.NODE_ENV !== "production" &&
          /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
        ) {
          return cb(null, true);
        }

        return cb(null, allowedOrigins.has(origin));
      },
      credentials: true,
    })
  );
  app.use(cookieParser());
  // Needed for OAuth providers that POST x-www-form-urlencoded (e.g. Apple with response_mode=form_post)
  const jsonLimit = process.env.JSON_BODY_LIMIT || "10mb";
  app.use(express.urlencoded({ extended: false, limit: jsonLimit }));
  app.use(express.json({ limit: jsonLimit }));

  // Public media (generated images, uploads, etc.). In v1 we serve from local disk.
  // Production can switch to object storage; keep the URL surface stable.
  const uploadsRoot = path.join(process.cwd(), "uploads");
  app.use("/media", express.static(uploadsRoot));

  const authRoutes = require("./routes/auth.routes");
  const conversationRoutes = require("./routes/conversation.routes");
  const planRoutes = require("./routes/plan.routes");
  const aiRoutes = require("./routes/ai.routes");
  const memoryRoutes = require("./routes/memory.routes");
  const supportRoutes = require("./routes/support.routes");
  const projectRoutes = require("./routes/project.routes");

  app.use("/auth", authRoutes);
  app.use("/conversations", conversationRoutes);
  app.use("/plans", planRoutes);
  app.use("/ai", aiRoutes);
  app.use("/memory", memoryRoutes);
  app.use("/support", supportRoutes);
  app.use("/projects", projectRoutes);

  // Centralized JSON errors (keep this last)
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
