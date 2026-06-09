import { query } from "../db/pool.js";

let firebaseAdmin = null;

// Lazy-load Firebase to avoid crash if credentials not set
async function getFirebase() {
  if (firebaseAdmin) return firebaseAdmin;
  if (!process.env.FIREBASE_PROJECT_ID) return null;

  try {
    const admin = await import("firebase-admin");
    if (!admin.default.apps.length) {
      admin.default.initializeApp({
        credential: admin.default.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
      });
    }
    firebaseAdmin = admin.default;
    return firebaseAdmin;
  } catch (err) {
    console.error("[FCM] Firebase init failed:", err.message);
    return null;
  }
}

// ─── Core notification function ───────────────────────────────────────────────

/**
 * Save in-app notifications to DB AND send FCM push.
 *
 * @param {Object} opts
 * @param {string[]} opts.userIds      - User IDs to notify in-app
 * @param {string[]} opts.fcmTokens    - FCM tokens for push (subset of users)
 * @param {string}   opts.type         - e.g. "ORDER_ACCEPTED"
 * @param {string}   opts.title
 * @param {string}   opts.body
 * @param {Object}   opts.payload      - Extra data (orderId, state, etc.)
 */
export async function notifyOrderUpdate({ userIds, fcmTokens, type, title, body, payload = {} }) {
  // 1. Save in-app notifications for each user
  if (userIds?.length > 0) {
    const values = userIds
      .map((_, i) => `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`)
      .join(", ");

    const params = userIds.flatMap((uid) => [
      uid,
      type,
      title,
      body,
      JSON.stringify(payload),
    ]);

    await query(
      `INSERT INTO notifications (user_id, type, title, body, payload)
       VALUES ${values}`,
      params
    ).catch((err) => console.error("[Notification] DB insert failed:", err.message));
  }

  // 2. Send FCM push notifications
  const validTokens = fcmTokens?.filter(Boolean) || [];
  if (validTokens.length === 0) return;

  const admin = await getFirebase();
  if (!admin) return;

  try {
    const messaging = admin.messaging();

    if (validTokens.length === 1) {
      await messaging.send({
        token: validTokens[0],
        notification: { title, body },
        data: {
          type,
          orderId: payload.orderId || "",
          ...Object.fromEntries(
            Object.entries(payload).map(([k, v]) => [k, String(v)])
          ),
        },
        android: { priority: "high" },
        apns: { payload: { aps: { contentAvailable: true, badge: 1 } } },
      });
    } else {
      // Batch send (up to 500 tokens per FCM call)
      const chunks = [];
      for (let i = 0; i < validTokens.length; i += 500) {
        chunks.push(validTokens.slice(i, i + 500));
      }
      for (const chunk of chunks) {
        await messaging.sendEachForMulticast({
          tokens: chunk,
          notification: { title, body },
          data: { type, ...Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, String(v)])) },
          android: { priority: "high" },
        });
      }
    }
    console.log(`[FCM] Sent '${type}' to ${validTokens.length} device(s)`);
  } catch (err) {
    console.error("[FCM] Push failed:", err.message);
    // Non-fatal: in-app notification already saved
  }
}

// ─── Get user's notifications ────────────────────────────────────────────────

export async function getUserNotifications(userId, { page = 1, limit = 30 } = {}) {
  const offset = (page - 1) * limit;
  const { rows } = await query(
    `SELECT id, type, title, body, payload, is_read, created_at
     FROM notifications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  const { rows: countRows } = await query(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE is_read = false) AS unread
     FROM notifications WHERE user_id = $1`,
    [userId]
  );

  return {
    notifications: rows,
    total: parseInt(countRows[0].total),
    unread: parseInt(countRows[0].unread),
  };
}

// ─── Mark notifications as read ──────────────────────────────────────────────

export async function markNotificationsRead(userId, notificationIds = null) {
  if (notificationIds?.length > 0) {
    await query(
      `UPDATE notifications SET is_read = true
       WHERE user_id = $1 AND id = ANY($2::uuid[])`,
      [userId, notificationIds]
    );
  } else {
    // Mark all as read
    await query(
      `UPDATE notifications SET is_read = true WHERE user_id = $1`,
      [userId]
    );
  }
}
