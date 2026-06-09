import { query, getClient } from "../db/pool.js";
import { cacheDel } from "../db/redis.js";
import { createError } from "../middleware/errors.js";
import { notifyOrderUpdate } from "./notificationService.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function generatePublicRef() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `ORD-${date}-${rand}`;
}

/**
 * Strip PII based on who is requesting the order.
 * - customer: sees order + workerAlias (no worker identity)
 * - worker: sees order + customerRef (no customer identity)
 * - admin: sees everything
 */
export function sanitizeOrder(order, role) {
  const base = {
    id: order.id,
    publicRef: order.public_ref,
    state: order.state,
    status: order.status,
    paymentStatus: order.payment_status,
    content: order.content,
    note: order.note,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
  };

  if (role === "customer") {
    return {
      ...base,
      workerAlias: order.worker_alias || null,  // e.g. "Agent #0012"
    };
  }

  if (role === "worker") {
    return {
      ...base,
      customerRef: order.public_ref,  // worker only sees order ref, never customer identity
    };
  }

  // Admin sees all
  return {
    ...base,
    customerId: order.customer_id,
    workerId: order.worker_id,
    workerAlias: order.worker_alias,
    customerEmail: order.customer_email,
  };
}

// ─── Create Order ────────────────────────────────────────────────────────────

export async function createOrder({ customerId, state, content }) {
  const client = await getClient();
  try {
    await client.query("BEGIN");

    const publicRef = generatePublicRef();

    // Insert order
    const { rows: [order] } = await client.query(
      `INSERT INTO orders (public_ref, customer_id, state, content, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING *`,
      [publicRef, customerId, state, JSON.stringify(content)]
    );

    // Log history
    await client.query(
      `INSERT INTO order_history (order_id, changed_by, old_status, new_status, note)
       VALUES ($1, $2, NULL, 'pending', 'Order created')`,
      [order.id, customerId]
    );

    // Find active workers assigned to this state
    const { rows: workers } = await client.query(
      `SELECT w.id, w.alias, w.fcm_token
       FROM worker_assignments wa
       JOIN users w ON w.id = wa.worker_id
       WHERE wa.state = $1 AND wa.is_active = true AND w.is_active = true`,
      [state]
    );

    if (workers.length > 0) {
      // Auto-assign to first available worker (round-robin can replace this)
      const assigned = workers[0];
      await client.query(
        `UPDATE orders SET status = 'assigned', worker_id = $1 WHERE id = $2`,
        [assigned.id, order.id]
      );
      await client.query(
        `INSERT INTO order_history (order_id, changed_by, old_status, new_status, note)
         VALUES ($1, $2, 'pending', 'assigned', 'Auto-assigned to worker')`,
        [order.id, customerId]
      );
      order.status = "assigned";
      order.worker_id = assigned.id;

      // Notify assigned workers in this state
      await notifyOrderUpdate({
        userIds: workers.map((w) => w.id),
        fcmTokens: workers.map((w) => w.fcm_token).filter(Boolean),
        type: "NEW_ORDER",
        title: "New Order Available",
        body: `New order ${publicRef} in ${state}`,
        payload: { orderId: order.id, state },
      });
    } else {
      // No workers — notify admin
      const { rows: admins } = await client.query(
        `SELECT id, fcm_token FROM users WHERE role = 'admin' AND is_active = true`
      );
      await notifyOrderUpdate({
        userIds: admins.map((a) => a.id),
        fcmTokens: admins.map((a) => a.fcm_token).filter(Boolean),
        type: "NO_WORKER_AVAILABLE",
        title: "⚠️ No Worker for Order",
        body: `Order ${publicRef} in ${state} has no assigned worker`,
        payload: { orderId: order.id, state },
      });
    }

    await client.query("COMMIT");
    return order;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── Get Orders (role-filtered) ──────────────────────────────────────────────

export async function getOrders({ userId, role, state, status, page = 1, limit = 20 }) {
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];
  let i = 1;

  // Role-based filtering — workers only see their state
  if (role === "customer") {
    conditions.push(`o.customer_id = $${i++}`);
    params.push(userId);
  } else if (role === "worker") {
    // Worker sees orders from their assigned states only
    conditions.push(
      `o.state IN (
        SELECT state FROM worker_assignments
        WHERE worker_id = $${i++} AND is_active = true
      )`
    );
    params.push(userId);
    // Also filter to show only unaccepted OR their own orders
    conditions.push(
      `(o.status = 'assigned' OR o.worker_id = $${i++})`
    );
    params.push(userId);
  }
  // Admin: no filtering

  if (state) {
    conditions.push(`o.state = $${i++}`);
    params.push(state);
  }
  if (status) {
    conditions.push(`o.status = $${i++}`);
    params.push(status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const { rows } = await query(
    `SELECT
       o.*,
       w.alias AS worker_alias,
       c.email AS customer_email
     FROM orders o
     LEFT JOIN users w ON w.id = o.worker_id
     LEFT JOIN users c ON c.id = o.customer_id
     ${where}
     ORDER BY o.created_at DESC
     LIMIT $${i++} OFFSET $${i++}`,
    [...params, limit, offset]
  );

  const { rows: countRows } = await query(
    `SELECT COUNT(*) FROM orders o ${where}`,
    params
  );

  return {
    orders: rows.map((o) => sanitizeOrder(o, role)),
    total: parseInt(countRows[0].count),
    page,
    limit,
  };
}

// ─── Get Single Order ────────────────────────────────────────────────────────

export async function getOrderById(orderId, { userId, role }) {
  const { rows } = await query(
    `SELECT o.*, w.alias AS worker_alias, c.email AS customer_email
     FROM orders o
     LEFT JOIN users w ON w.id = o.worker_id
     LEFT JOIN users c ON c.id = o.customer_id
     WHERE o.id = $1`,
    [orderId]
  );

  if (rows.length === 0) throw createError(404, "Order not found");
  const order = rows[0];

  // Enforce access
  if (role === "customer" && order.customer_id !== userId) {
    throw createError(403, "Access denied");
  }
  if (role === "worker") {
    // Must be assigned to this order's state
    const { rows: assigned } = await query(
      `SELECT 1 FROM worker_assignments
       WHERE worker_id = $1 AND state = $2 AND is_active = true`,
      [userId, order.state]
    );
    if (assigned.length === 0) throw createError(403, "Access denied");
  }

  return sanitizeOrder(order, role);
}

// ─── Update Order Status ─────────────────────────────────────────────────────

const VALID_TRANSITIONS = {
  worker: {
    assigned:   ["accepted"],
    accepted:   ["processing", "cancelled"],
    processing: ["delayed", "delivered"],
    delayed:    ["processing", "delivered"],
  },
  admin: {
    pending:    ["cancelled"],
    assigned:   ["cancelled"],
    delivered:  ["paid"],
    paid:       [],
  },
};

export async function updateOrderStatus({ orderId, newStatus, note, userId, role }) {
  const client = await getClient();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT o.*, w.fcm_token AS worker_fcm, c.fcm_token AS customer_fcm,
              c.id AS cust_id, w.id AS work_id
       FROM orders o
       LEFT JOIN users w ON w.id = o.worker_id
       LEFT JOIN users c ON c.id = o.customer_id
       WHERE o.id = $1 FOR UPDATE`,
      [orderId]
    );

    if (rows.length === 0) throw createError(404, "Order not found");
    const order = rows[0];

    // Worker must own this order
    if (role === "worker" && order.worker_id !== userId) {
      throw createError(403, "You are not assigned to this order");
    }

    // Validate transition
    const allowed = VALID_TRANSITIONS[role]?.[order.status] || [];
    if (!allowed.includes(newStatus)) {
      throw createError(
        400,
        `Cannot transition from '${order.status}' to '${newStatus}' as ${role}`
      );
    }

    // Update
    await client.query(
      `UPDATE orders SET status = $1, note = COALESCE($2, note) WHERE id = $3`,
      [newStatus, note, orderId]
    );

    await client.query(
      `INSERT INTO order_history (order_id, changed_by, old_status, new_status, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [orderId, userId, order.status, newStatus, note || null]
    );

    await client.query("COMMIT");

    // ── Notifications ──
    const notifyTargets = [];
    const statusMessages = {
      accepted:   { title: "Order Accepted", body: `Your order ${order.public_ref} has been accepted` },
      processing: { title: "Order Processing", body: `Your order ${order.public_ref} is being processed` },
      delayed:    { title: "Order Delayed", body: `Your order ${order.public_ref} has been delayed` },
      delivered:  { title: "Order Delivered", body: `Your order ${order.public_ref} has been delivered` },
      cancelled:  { title: "Order Cancelled", body: `Order ${order.public_ref} was cancelled` },
      paid:       { title: "Payment Approved", body: `Payment for order ${order.public_ref} has been approved` },
    };

    const msg = statusMessages[newStatus];

    if (order.cust_id && newStatus !== "paid") {
      notifyTargets.push({ userId: order.cust_id, fcmToken: order.customer_fcm });
    }
    if (order.work_id && newStatus === "paid") {
      notifyTargets.push({ userId: order.work_id, fcmToken: order.worker_fcm });
    }

    if (msg && notifyTargets.length > 0) {
      await notifyOrderUpdate({
        userIds: notifyTargets.map((t) => t.userId),
        fcmTokens: notifyTargets.map((t) => t.fcmToken).filter(Boolean),
        type: `ORDER_${newStatus.toUpperCase()}`,
        ...msg,
        payload: { orderId, status: newStatus },
      });
    }

    cacheDel(`order:${orderId}`);
    return { orderId, newStatus };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── Order History ───────────────────────────────────────────────────────────

export async function getOrderHistory(orderId) {
  const { rows } = await query(
    `SELECT oh.*, u.alias AS changed_by_alias
     FROM order_history oh
     JOIN users u ON u.id = oh.changed_by
     WHERE oh.order_id = $1
     ORDER BY oh.changed_at ASC`,
    [orderId]
  );
  return rows;
}
