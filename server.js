// server.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";

import healthRoutes from "./src/routes/health.js";
// import authRoutes from "./src/routes/auth.js";       // we'll add next
// import proposalRoutes from "./src/routes/proposals.js";

// server.js — add to imports
import authRoutes from "./src/routes/auth.js";

// server.js — add to routes section
app.use("/api/auth", authRoutes);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Middleware ----
app.use(helmet());                              // security headers
app.use(cors({
    origin: process.env.NODE_ENV === "production"
        ? ["https://your-frontend-domain.com"]      // restrict in prod
        : true,                                     // allow all in dev
    credentials: true
}));
app.use(express.json({ limit: "1mb" }));        // parse JSON bodies
app.use(morgan("dev"));                         // request logging

// ---- Routes ----
app.use("/api/health", healthRoutes);
// app.use("/api/auth", authRoutes);
// app.use("/api/proposals", proposalRoutes);

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
