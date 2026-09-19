// server.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import pool from "./src/config/db.js";
import healthRoutes from "./src/routes/health.js";
import authRoutes from "./src/routes/auth.js";
import proposalRoutes from "./src/routes/proposals.js";
import executionRoutes from "./src/routes/executions.js";
import { runScheduledProposals } from "./src/jobs/scheduledProposals.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Security headers ----
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// ---- CORS ----
const allowedOrigins = [
  "https://ai-trading-agent-web.surge.sh",
  "https://ai-trading-agent-web.onrender.com",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://localhost:4000"
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);            // curl / Postman
    if (allowedOrigins.includes(origin)) return callback(null, true);
    console.log("[CORS] Rejected origin:", origin);
    callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));   // preflight for every route

// ---- Body parsing & logging ----
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

// ---- Routes ----
app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/proposals", proposalRoutes);
app.use("/api/executions", executionRoutes);

app.post("/api/jobs/run-proposals", async (req, res, next) => {
  const secret = req.headers["x-job-secret"];
  if (!secret || secret !== process.env.JOB_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await runScheduledProposals();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ---- Root ----
app.get("/", (req, res) => {
  res.json({
    name: "AI Trading Agent API",
    version: "0.1.0",
    status: "running"
  });
});

// ---- Temporary diagnostic route ----
app.get("/api/debug/db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() as time");
    res.json({ connected: true, time: result.rows[0].time });
  } catch (err) {
    res.status(500).json({
      connected: false,
      error: err.message,
      code: err.code
    });
  }
});

// ---- 404 Handler ----
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ---- Global Error Handler ----
app.use((err, req, res, next) => {
  console.error("[ERROR]", err.message);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === "production"
      ? "Internal server error"
      : err.message
  });
});

// ---- Start (always last) ----
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV}`);
});
