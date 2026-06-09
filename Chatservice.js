import { query } from "../db/pool.js";
import { createError } from "../middleware/errors.js";

/**
 * Verify the user is a party to this order before allowing chat access.
 * - Customer: must own the order
 * - Worker: must be assigned to the order's state
 * - Admin: always allowed
 */
async function verifyAccess(orderId, userId, role) {
  const { rows } = await query(
    `SELECT o.customer_id, o.worker_id, o.state, o.status
     FROM orders o WHERE o.id = $1`,
    [orderId]
  );
  if (rows.length === 0) throw createError(404, "Order not found");

  const order = rows[0];

  if (role === "customer" && order.customer_id !== userId) {
    throw createError(403, "Access denied");
  }

  if (role === "worker") {
    const { rows: wa } = await query(
      `SELECT 1 FROM worker_assignments
       WHERE worker_id = $1 AND state = $2 AND is_active = true`,
      [userId, order.state]
    );
    if (wa.length === 0) throw createError(403, "Access denied");
  }

  return order;
}

// ─── Get Messages ────────────────────────────────────────────────────────────

export async function getMessages(orderId, { userId, role }) {
  await verifyAccess(orderId, userId, role);

  const { rows } = await query(
    `SELECT
       m.id,
       m.body,
       m.sender_role,
       m.is_read,
       m.sent_at,
       -- Anonymize sender: customers see "Agent", workers see "Customer"
       CASE
         WHEN m.sender_role = 'worker'   THEN u.alias
         WHEN m.sender_role = 'customer' THEN 'Customer'
         WHEN m.sender_role = 'admin'    THEN 'Support'
       END AS sender_name,
       -- Mark own messages
       (m.sender_id = $2) AS is_mine
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.order_id = $1
     ORDER BY m.sent_at ASC`,
    [orderId, userId]
  );

  // Mark unread messages as read
  await query(
    `UPDATE messages SET is_read = true
     WHERE order_id = $1 AND sender_id != $2 AND is_read = false`,
    [orderId, userId]
  );

  return rows;
}

// ─── Send Message ────────────────────────────────────────────────────────────

export async function sendMessage(orderId, { userId, role, body }) {
  const order = await verifyAccess(orderId, userId, role);

  // Block chat on completed/cancelled orders
  if (["paid", "cancelled"].includes(order.status)) {
    throw createError(400, `Cannot send messages on a ${order.status} order`);
  }

  const { rows } = await query(
    `INSERT INTO messages (order_id, sender_id, sender_role, body)
     VALUES ($1, $2, $3, $4)
     RETURNING id, body, sender_role, sent_at`,
    [orderId, userId, role, body]
  );

  const message = rows[0];

  // Get sender alias for socket emission
  const { rows: userRows } = await query(
    `SELECT alias FROM users WHERE id = $1`,
    [userId]
  );

  return {
    ...message,
    sender_name:
      role === "worker" ? userRows[0].alias :
      role === "customer" ? "Customer" : "Support",
    is_mine: true,
    orderId,
    // For socket routing: the other party's user IDs
    recipientIds: [
      role !== "customer" ? order.customer_id : null,
      role !== "worker" ? order.worker_id : null,
    ].filter(Boolean),
  };
}

// ─── Unread Count ────────────────────────────────────────────────────────────

export async function getUnreadCount(userId) {
  const { rows } = await query(
    `SELECT COUNT(*) AS count
     FROM messages m
     JOIN orders o ON o.id = m.order_id
     WHERE m.is_read = false
       AND m.sender_id != $1
       AND (o.customer_id = $1 OR o.worker_id = $1)`,
    [userId]
  );
  return parseInt(rows[0].count);
}
