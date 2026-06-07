import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";

import { errorHandler } from "./middleware/errors.js";
import { initSocket } from "./utils/socket.js";

import authRoutes         from "./routes/auth.js";
import orderRoutes        from "./routes/orders.js";
import chatRoutes         from "./routes/chat.js";
import adminRoutes        from "./routes/admin.js";
import notificationRoutes from "./routes/notifications.js";

const app = express();
const httpServer = createServer(app);

// ─── Socket.io ───────────────────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: {
    origin: [
      process.env.CUSTOMER_URL,
      process.env.WORKER_URL,
      process.env.ADMIN_URL,
    ].filter(Boolean),
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

initSocket(io);
app.set("io", io); // Make io accessible in route handlers

// ─── Core Middleware ─────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: (origin, cb) => {
    const allowed = [
      process.env.CUSTOMER_URL,
      process.env.WORKER_URL,
      process.env.ADMIN_URL,
    ].filter(Boolean);
    // Allow requests with no origin (mobile apps, Postman)
    if (!origin || allowed.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin '${origin}' not allowed`));
  },
  credentials: true,
}));
app.use(express.json({ limit: "1mb" }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  message: { error: "Too many requests. Please slow down." },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // Stricter for login/register
  message: { error: "Too many auth attempts. Try again in 15 minutes." },
});

app.use(globalLimiter);

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use("/api/auth",          authLimiter, authRoutes);
app.use("/api/orders",        orderRoutes);
app.use("/api/chat",          chatRoutes);
app.use("/api/admin",         adminRoutes);
app.use("/api/notifications", notificationRoutes);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "dispatch-api",
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
  });
});

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║   Dispatch API running on port ${PORT}      ║
║   Environment: ${(process.env.NODE_ENV || "development").padEnd(26)} ║
║   Health: http://localhost:${PORT}/health   ║
╚═══════════════════════════════════════════╝
  `);
});

export default app;
