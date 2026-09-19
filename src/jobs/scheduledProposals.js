import pool from "../config/db.js";
import { generateScheduledProposals } from "../services/agent.js";

const MAX_PROPOSALS_PER_USER_PER_DAY = 5;

export async function runScheduledProposals() {
  console.log("[JOB] Starting scheduled proposal generation");

  // Find users who are active (not paused) and under their daily cap
  const { rows: users } = await pool.query(`
    SELECT u.id, u.email
      FROM users u
     WHERE u.paused = false
       AND (
         SELECT COUNT(*) FROM proposals p
          WHERE p.user_id = u.id
            AND p.created_at > NOW() - INTERVAL '24 hours'
       ) < $1
     LIMIT 100
  `, [MAX_PROPOSALS_PER_USER_PER_DAY]);

  console.log(`[JOB] Processing ${users.length} users`);

  let created = 0;
  let failed = 0;

  for (const user of users) {
    try {
      const drafts = await generateScheduledProposals();

      for (const draft of drafts) {
        await pool.query(
          `INSERT INTO proposals
             (user_id, action, symbol, quantity, order_type, limit_price, reasoning, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING_APPROVAL')`,
          [
            user.id,
            draft.action,
            draft.symbol,
            draft.quantity,
            draft.orderType,
            draft.limitPrice ?? null,
            draft.reasoning
          ]
        );
        created++;
      }
    } catch (err) {
      console.error(`[JOB] Failed for user ${user.id}:`, err.message);
      failed++;
    }
  }

  console.log(`[JOB] Done. Created ${created} proposals. Failures: ${failed}`);
  return { created, failed, users: users.length };
}
