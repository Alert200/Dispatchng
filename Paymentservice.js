import { query, getClient } from "../db/pool.js";
import { createError } from "../middleware/errors.js";
import { notifyOrderUpdate } from "./notificationService.js";

// ─── Admin approves/rejects payment ──────────────────────────────────────────

export async function processPayment({ orderId, decision, note, adminId }) {
  const client = await getClient();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT o.*, w.fcm_token AS worker_fcm, w.id AS work_id, w.alias AS worker_alias
       FROM orders o
       LEFT JOIN users w ON w.id = o.worker_id
       WHERE o.id = $1 FOR UPDATE`,
      [orderId]
    );

    if (rows.length === 0) throw createError(404, "Order not found");
    const order = rows[0];

    if (order.status !== "delivered") {
      throw createError(400, "Order must be in 'delivered' status before payment decision");
    }

    if (order.payment_status !== "pending") {
      throw createError(400, `Payment already ${order.payment_status}`);
    }

    const newOrderStatus = decision === "approved" ? "paid" : order.status;

    await client.query(
      `UPDATE orders
       SET payment_status = $1, status = $2, note = COALESCE($3, note)
       WHERE id = $4`,
      [decision, newOrderStatus, note, orderId]
    );

    await client.query(
      `INSERT INTO order_history (order_id, changed_by, old_status, new_status, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [orderId, adminId, order.status, newOrderStatus, note || `Payment ${decision} by admin`]
    );

    await client.query("COMMIT");

    // Notify worker
    if (order.work_id) {
      const msg = decision === "approved"
        ? { title: "💰 Payment Approved", body: `Payment for order ${order.public_ref} has been approved` }
        : { title: "❌ Payment Rejected", body: `Payment for order ${order.public_ref} was rejected: ${note || "No reason given"}` };

      await notifyOrderUpdate({
        userIds: [order.work_id],
        fcmTokens: [order.worker_fcm].filter(Boolean),
        type: `PAYMENT_${decision.toUpperCase()}`,
        ...msg,
        payload: { orderId, decision },
      });
    }

    return { orderId, decision, paymentStatus: decision };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── Admin: list pending payments ────────────────────────────────────────────

export async function getPendingPayments({ page = 1, limit = 20 }) {
  const offset = (page - 1) * limit;
  const { rows } = await query(
    `SELECT o.id, o.public_ref, o.state, o.status, o.payment_status,
            o.created_at, o.updated_at,
            w.alias AS worker_alias,
            c.email AS customer_email
     FROM orders o
     LEFT JOIN users w ON w.id = o.worker_id
     LEFT JOIN users c ON c.id = o.customer_id
     WHERE o.status = 'delivered' AND o.payment_status = 'pending'
     ORDER BY o.updated_at ASC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}
