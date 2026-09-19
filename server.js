// server.js
import proposalRoutes from "./src/routes/proposals.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import pool from "./src/config/db.js";
import healthRoutes from "./src/routes/health.js";
import authRoutes from "./src/routes/auth.js";
import executionRoutes from "./src/routes/executions.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Middleware ----
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === "production"
    ? ["https://your-frontend-domain.com"]
    : true,
  credentials: true
}));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.use(cors({
  origin: process.env.NODE_ENV === "production"
    ? ["http://localhost:5173", "https://ai-trading-agent-web.surge.sh/"]
    : true,
  credentials: true
}));

// ---- Routes ----
app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/proposals", proposalRoutes);
app.use("/api/executions", executionRoutes);

// ---- Root ----
app.get("/", (req, res) => {
  res.json({
    name: "AI Trading Agent API",
    version: "0.1.0",
    status: "running"
  });
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

// ---- Start ----
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV}`);
});

// Temporary diagnostic route — remove before going to production
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
