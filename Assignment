import { query } from "../db/pool.js";
import { createError } from "../middleware/errors.js";
import { cacheDel } from "../db/redis.js";

// ─── Assign Worker to States ─────────────────────────────────────────────────

export async function assignWorkerToStates({ workerId, states, adminId }) {
  // Verify worker exists and is actually a worker
  const { rows: workerRows } = await query(
    `SELECT id, alias, role FROM users WHERE id = $1 AND is_active = true`,
    [workerId]
  );
  if (workerRows.length === 0) throw createError(404, "Worker not found");
  if (workerRows[0].role !== "worker") throw createError(400, "User is not a worker");

  const inserted = [];
  for (const state of states) {
    const { rows } = await query(
      `INSERT INTO worker_assignments (worker_id, state, assigned_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (worker_id, state)
       DO UPDATE SET is_active = true, assigned_by = $3, assigned_at = now()
       RETURNING *`,
      [workerId, state, adminId]
    );
    inserted.push(rows[0]);
  }

  cacheDel(`worker:${workerId}:assignments`);
  return { worker: workerRows[0], assignments: inserted };
}

// ─── Unassign Worker from a State ────────────────────────────────────────────

export async function unassignWorkerFromState({ workerId, state, adminId }) {
  const { rowCount } = await query(
    `UPDATE worker_assignments
     SET is_active = false
     WHERE worker_id = $1 AND state = $2`,
    [workerId, state]
  );
  if (rowCount === 0) throw createError(404, "Assignment not found");

  cacheDel(`worker:${workerId}:assignments`);
  return { workerId, state, unassigned: true };
}

// ─── Get Worker's Assignments ─────────────────────────────────────────────────

export async function getWorkerAssignments(workerId) {
  const { rows } = await query(
    `SELECT state, is_active, assigned_at
     FROM worker_assignments
     WHERE worker_id = $1
     ORDER BY assigned_at DESC`,
    [workerId]
  );
  return rows;
}

// ─── List All Workers (Admin) ─────────────────────────────────────────────────

export async function listWorkers({ page = 1, limit = 50 }) {
  const offset = (page - 1) * limit;
  const { rows } = await query(
    `SELECT
       u.id, u.email, u.alias, u.is_active, u.created_at,
       COALESCE(
         json_agg(
           json_build_object('state', wa.state, 'isActive', wa.is_active)
         ) FILTER (WHERE wa.state IS NOT NULL),
         '[]'
       ) AS assignments,
       COUNT(DISTINCT o.id) FILTER (WHERE o.status NOT IN ('cancelled','paid')) AS active_orders
     FROM users u
     LEFT JOIN worker_assignments wa ON wa.worker_id = u.id
     LEFT JOIN orders o ON o.worker_id = u.id
     WHERE u.role = 'worker'
     GROUP BY u.id
     ORDER BY u.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

// ─── List Workers by State (Admin) ───────────────────────────────────────────

export async function getWorkersByState(state) {
  const { rows } = await query(
    `SELECT u.id, u.alias, u.is_active,
            wa.is_active AS assignment_active, wa.assigned_at
     FROM worker_assignments wa
     JOIN users u ON u.id = wa.worker_id
     WHERE wa.state = $1
     ORDER BY wa.assigned_at DESC`,
    [state]
  );
  return rows;
}

// ─── Activate / Deactivate Worker ────────────────────────────────────────────

export async function setWorkerActive(workerId, isActive) {
  const { rows } = await query(
    `UPDATE users SET is_active = $1 WHERE id = $2 AND role = 'worker'
     RETURNING id, alias, is_active`,
    [isActive, workerId]
  );
  if (rows.length === 0) throw createError(404, "Worker not found");
  return rows[0];
}
