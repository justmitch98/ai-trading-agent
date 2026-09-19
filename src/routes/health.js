import { Router } from "express";

const router = Router();

// Used by Render's health checks and your monitoring
router.get("/", (req, res) => {
    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV
    });
});

export default router;
