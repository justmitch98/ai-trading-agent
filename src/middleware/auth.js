// src/middleware/auth.js
import jwt from "jsonwebtoken";
import pool from "../config/db.js";

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed token" });
  }

  const token = header.slice(7);

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Apply only to routes that should be blocked when the account is paused
// (i.e. proposal generation and execution, NOT pause/resume themselves)
export async function blockIfPaused(req, res, next) {
  try {
    const { rows } = await pool.query(
      "SELECT paused FROM users WHERE id = $1",
      [req.user.id]
    );
    if (rows[0]?.paused) {
      return res.status(423).json({ error: "Account is paused" });
    }
    next();
  } catch (err) {
    next(err);
  }
}
