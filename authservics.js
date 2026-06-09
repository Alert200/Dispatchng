import bcrypt from "bcryptjs";
import { query } from "../db/pool.js";
import { signToken } from "../middleware/auth.js";
import { createError } from "../middleware/errors.js";

/**
 * Generate a unique alias for a user.
 * Workers: "Agent Lagos-04"  (state assigned later; pre-reg alias = "Agent #<n>")
 * Customers: "Customer #<n>"
 */
async function generateAlias(role) {
  const { rows } = await query(
    `SELECT COUNT(*) AS cnt FROM users WHERE role = $1`,
    [role]
  );
  const n = String(parseInt(rows[0].cnt) + 1).padStart(4, "0");
  return role === "worker" ? `Agent #${n}` : `Customer #${n}`;
}

export async function registerUser({ email, password, role }) {
  // Check duplicate
  const existing = await query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (existing.rows.length > 0) {
    throw createError(409, "Email already registered");
  }

  const password_hash = await bcrypt.hash(password, 12);
  const alias = await generateAlias(role);

  const { rows } = await query(
    `INSERT INTO users (email, password_hash, role, alias)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, role, alias, created_at`,
    [email, password_hash, role, alias]
  );

  const user = rows[0];
  const token = signToken({ id: user.id, email: user.email, role: user.role, alias: user.alias });

  return { user, token };
}

export async function loginUser({ email, password }) {
  const { rows } = await query(
    `SELECT id, email, password_hash, role, alias, is_active FROM users WHERE email = $1`,
    [email]
  );

  if (rows.length === 0) {
    throw createError(401, "Invalid email or password");
  }

  const user = rows[0];

  if (!user.is_active) {
    throw createError(403, "Account has been deactivated. Contact admin.");
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw createError(401, "Invalid email or password");
  }

  const token = signToken({
    id: user.id,
    email: user.email,
    role: user.role,
    alias: user.alias,
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      alias: user.alias,
    },
    token,
  };
}

export async function getProfile(userId) {
  const { rows } = await query(
    `SELECT id, email, role, alias, is_active, created_at FROM users WHERE id = $1`,
    [userId]
  );
  if (rows.length === 0) throw createError(404, "User not found");
  return rows[0];
}

export async function registerDevice(userId, fcmToken) {
  await query(`UPDATE users SET fcm_token = $1 WHERE id = $2`, [fcmToken, userId]);
}
