import { Router } from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT e.*, p.symbol, p.action, p.quantity
         FROM executions e
         JOIN proposals p ON p.id = e.proposal_id
        WHERE e.user_id = $1
        ORDER BY e.executed_at DESC
        LIMIT 100`,
      [req.user.id]
    );
    res.json({ executions: result.rows });
  } catch (err) {
    next(err);
  }
});

export default router;
