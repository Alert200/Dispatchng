/**
 * STAFF SUB-ACCOUNTS
 * Add this file: src/routes/customerStaff.js
 * Wire into src/index.js: app.use("/api/customer", customerStaffRoutes)
 *
 * Also run the migration below to add the staff table.
 */

// ─── DB Migration (add to migrate.js) ────────────────────────────────────────
/*
`CREATE TABLE IF NOT EXISTS customer_staff (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  email        TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now()
)`,
`CREATE INDEX IF NOT EXISTS idx_staff_owner ON customer_staff(owner_id)`,
*/

// ─── Routes ───────────────────────────────────────────────────────────────────
import { Router } from "express";
import bcrypt from "bcryptjs";
import { query } from "../db/pool.js";
import { authenticate, authorize, signToken } from "../middleware/auth.js";
import { asyncHandler, createError } from "../middleware/errors.js";
import { z } from "zod";

const router = Router();
router.use(authenticate);

const addStaffSchema = z.object({
  name:     z.string().min(2, "Name required"),
  email:    z.string().email("Valid email required"),
  password: z.string().min(6, "At least 6 characters"),
});

// ── GET /api/customer/staff ── List staff under this owner ───────────────────
router.get("/staff", authorize("customer"), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, email, is_active, created_at
     FROM customer_staff WHERE owner_id = $1 ORDER BY created_at ASC`,
    [req.user.id]
  );
  res.json({ staff: rows });
}));

// ── POST /api/customer/staff ── Add a staff member ───────────────────────────
router.post("/staff", authorize("customer"), asyncHandler(async (req, res) => {
  // Check limit
  const { rows: countRows } = await query(
    `SELECT COUNT(*) AS cnt FROM customer_staff WHERE owner_id = $1 AND is_active = true`,
    [req.user.id]
  );
  if (parseInt(countRows[0].cnt) >= 5) {
    throw createError(400, "Maximum 5 staff members allowed per account");
  }

  const { name, email, password } = addStaffSchema.parse(req.body);

  // Check email not already taken (users or staff tables)
  const { rows: existUsers } = await query(`SELECT id FROM users WHERE email=$1`,[email]);
  const { rows: existStaff } = await query(`SELECT id FROM customer_staff WHERE email=$1`,[email]);
  if (existUsers.length || existStaff.length) throw createError(409, "Email already in use");

  const passwordHash = await bcrypt.hash(password, 10);

  const { rows } = await query(
    `INSERT INTO customer_staff (owner_id, name, email, password_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, email, is_active, created_at`,
    [req.user.id, name, email, passwordHash]
  );

  res.status(201).json({ staff: rows[0] });
}));

// ── DELETE /api/customer/staff/:id ── Remove a staff member ─────────────────
router.delete("/staff/:id", authorize("customer"), asyncHandler(async (req, res) => {
  const { rowCount } = await query(
    `DELETE FROM customer_staff WHERE id = $1 AND owner_id = $2`,
    [req.params.id, req.user.id]
  );
  if (rowCount === 0) throw createError(404, "Staff member not found");
  res.json({ message: "Staff member removed" });
}));

export default router;

// ─────────────────────────────────────────────────────────────────────────────
// STAFF LOGIN — update src/services/authService.js loginUser() to also check
// the customer_staff table. Replace the loginUser function with this:
// ─────────────────────────────────────────────────────────────────────────────
export async function loginUserWithStaff({ email, password }) {
  // 1. Check main users table first
  const { rows: userRows } = await query(
    `SELECT id, email, password_hash, role, alias, is_active FROM users WHERE email=$1`,
    [email]
  );

  if (userRows.length > 0) {
    const user = userRows[0];
    if (!user.is_active) throw createError(403, "Account deactivated");
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) throw createError(401, "Invalid email or password");
    const token = signToken({ id:user.id, email:user.email, role:user.role, alias:user.alias });
    return { user:{ id:user.id, email:user.email, role:user.role, alias:user.alias }, token };
  }

  // 2. Check customer_staff table
  const { rows: staffRows } = await query(
    `SELECT cs.id, cs.name, cs.email, cs.password_hash, cs.is_active,
            cs.owner_id, u.alias AS owner_alias
     FROM customer_staff cs
     JOIN users u ON u.id = cs.owner_id
     WHERE cs.email = $1`,
    [email]
  );

  if (staffRows.length > 0) {
    const staff = staffRows[0];
    if (!staff.is_active) throw createError(403, "Staff account deactivated");
    const valid = await bcrypt.compare(password, staff.password_hash);
    if (!valid) throw createError(401, "Invalid email or password");

    // Staff token carries owner_id so all order queries scope to the owner's account
    const token = signToken({
      id:       staff.id,
      email:    staff.email,
      role:     "staff",           // staff role
      alias:    staff.name,
      ownerId:  staff.owner_id,    // ← key: used to scope order access
    });
    return {
      user:{ id:staff.id, email:staff.email, role:"staff", alias:staff.name, ownerId:staff.owner_id },
      token,
    };
  }

  throw createError(401, "Invalid email or password");
}

// ─────────────────────────────────────────────────────────────────────────────
// ORDER SCOPING FOR STAFF — update orderService.js getOrders() customer branch:
// ─────────────────────────────────────────────────────────────────────────────
/*
  if (role === "customer") {
    conditions.push(`o.customer_id = $${i++}`);
    params.push(userId);
  } else if (role === "staff") {
    // Staff see their owner's orders
    conditions.push(`o.customer_id = $${i++}`);
    params.push(ownerId);   // ownerId comes from JWT payload
  }
*/

// ─────────────────────────────────────────────────────────────────────────────
// WIRE UP in src/index.js — add these two lines:
// ─────────────────────────────────────────────────────────────────────────────
/*
  import customerStaffRoutes from "./routes/customerStaff.js";
  app.use("/api/customer", customerStaffRoutes);
*/

// ─────────────────────────────────────────────────────────────────────────────
// ADD TO .env.example — no new vars needed for staff; uses existing DB
// ─────────────────────────────────────────────────────────────────────────────
