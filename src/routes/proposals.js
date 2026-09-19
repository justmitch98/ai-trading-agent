// src/routes/proposals.js
import { Router } from "express";
import pool from "../config/db.js";
//import { requireAuth } from "../middleware/auth.js";
import { generateProposal, executeTrade } from "../services/agent.js";
import { requireAuth, blockIfPaused } from "../middleware/auth.js";

const router = Router();

// All proposal routes require auth
router.use(requireAuth, blockIfPaused);

// POST /api/proposals — agent generates a proposal (no execution)
router.post("/", async (req, res, next) => {
  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== "string" || prompt.length > 500) {
      return res.status(400).json({ error: "prompt is required (max 500 chars)" });
    }

    const draft = await generateProposal({ prompt });

    const result = await pool.query(
      `INSERT INTO proposals
         (user_id, action, symbol, quantity, order_type, limit_price, reasoning, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING_APPROVAL')
       RETURNING *`,
      [
        req.user.id,
        draft.action,
        draft.symbol,
        draft.quantity,
        draft.orderType,
        draft.limitPrice,
        draft.reasoning
      ]
    );

    res.status(201).json({ proposal: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// GET /api/proposals — list the user's proposals
router.get("/", async (req, res, next) => {
  try {
    const status = req.query.status;
    const params = [req.user.id];
    let sql = `SELECT * FROM proposals WHERE user_id = $1`;

    if (status) {
      params.push(status);
      sql += ` AND status = $2`;
    }

    sql += ` ORDER BY created_at DESC LIMIT 100`;

    const result = await pool.query(sql, params);
    res.json({ proposals: result.rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/proposals/:id — view one proposal
router.get("/:id", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT * FROM proposals WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Proposal not found" });
    }

    res.json({ proposal: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// POST /api/proposals/:id/approve — user approves → executes
router.post("/:id/approve", async (req, res, next) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Lock the proposal row so we don't double-execute
    const found = await client.query(
      `SELECT * FROM proposals WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [req.params.id, req.user.id]
    );

    if (found.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Proposal not found" });
    }

    const proposal = found.rows[0];

    if (proposal.status !== "PENDING_APPROVAL") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: `Proposal is ${proposal.status}, cannot approve`
      });
    }

    // Mark approved first, then execute
    await client.query(
      `UPDATE proposals SET status = 'APPROVED' WHERE id = $1`,
      [proposal.id]
    );

    // Execute in sandbox
    const executionResult = await executeTrade({
      userId: req.user.id,
      proposal
    });

    // Log the execution
    await client.query(
      `INSERT INTO executions (proposal_id, user_id, result)
       VALUES ($1, $2, $3)`,
      [proposal.id, req.user.id, executionResult]
    );

    // Mark executed
    const final = await client.query(
      `UPDATE proposals SET status = 'EXECUTED' WHERE id = $1 RETURNING *`,
      [proposal.id]
    );

    await client.query("COMMIT");

    res.json({
      proposal: final.rows[0],
      execution: executionResult
    });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

// POST /api/proposals/:id/deny — user denies
router.post("/:id/deny", async (req, res, next) => {
  try {
    const result = await pool.query(
      `UPDATE proposals
         SET status = 'DENIED'
       WHERE id = $1 AND user_id = $2 AND status = 'PENDING_APPROVAL'
       RETURNING *`,
      [req.params.id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(409).json({
        error: "Proposal not found or not in PENDING_APPROVAL state"
      });
    }

    res.json({ proposal: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;
