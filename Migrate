/**
 * dispatch-api/src/db/migrate.js
 * Run with: node src/db/migrate.js
 * Creates all tables, indexes, and seed data for development.
 */

import { query } from "./pool.js";

const migrations = [
  // ─── ENUM TYPES ────────────────────────────────────────────────────────────
  `DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('admin', 'worker', 'customer');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  `DO $$ BEGIN
    CREATE TYPE order_status AS ENUM (
      'pending', 'assigned', 'accepted',
      'processing', 'delayed', 'delivered',
      'cancelled', 'paid'
    );
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  `DO $$ BEGIN
    CREATE TYPE payment_status AS ENUM ('pending', 'approved', 'rejected');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  // ─── USERS ─────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          user_role NOT NULL,
    alias         TEXT UNIQUE,
    alias_counter INTEGER DEFAULT 0,
    fcm_token     TEXT,
    is_active     BOOLEAN DEFAULT true,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
  )`,

  // ─── WORKER STATE ASSIGNMENTS ──────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS worker_assignments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state       TEXT NOT NULL,
    assigned_by UUID NOT NULL REFERENCES users(id),
    is_active   BOOLEAN DEFAULT true,
    assigned_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(worker_id, state)
  )`,

  // ─── ORDERS ────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS orders (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_ref     TEXT UNIQUE NOT NULL,
    customer_id    UUID NOT NULL REFERENCES users(id),
    worker_id      UUID REFERENCES users(id),
    state          TEXT NOT NULL,
    content        JSONB NOT NULL,
    status         order_status NOT NULL DEFAULT 'pending',
    payment_status payment_status NOT NULL DEFAULT 'pending',
    note           TEXT,
    created_at     TIMESTAMPTZ DEFAULT now(),
    updated_at     TIMESTAMPTZ DEFAULT now()
  )`,

  // ─── ORDER HISTORY (full audit trail) ─────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS order_history (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    changed_by  UUID NOT NULL REFERENCES users(id),
    old_status  TEXT,
    new_status  TEXT NOT NULL,
    note        TEXT,
    changed_at  TIMESTAMPTZ DEFAULT now()
  )`,

  // ─── MESSAGES ──────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    sender_id   UUID NOT NULL REFERENCES users(id),
    sender_role user_role NOT NULL,
    body        TEXT NOT NULL,
    is_read     BOOLEAN DEFAULT false,
    sent_at     TIMESTAMPTZ DEFAULT now()
  )`,

  // ─── NOTIFICATIONS ─────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS notifications (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    payload    JSONB DEFAULT '{}',
    is_read    BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
  )`,

  // ─── INDEXES ───────────────────────────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_orders_state       ON orders(state)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_customer    ON orders(customer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_worker      ON orders(worker_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_status      ON orders(status)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_created     ON orders(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_assignments_state  ON worker_assignments(state) WHERE is_active = true`,
  `CREATE INDEX IF NOT EXISTS idx_assignments_worker ON worker_assignments(worker_id)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_order     ON messages(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifs_user        ON notifications(user_id, is_read)`,
  `CREATE INDEX IF NOT EXISTS idx_history_order      ON order_history(order_id)`,

  // ─── updated_at TRIGGER ────────────────────────────────────────────────────
  `CREATE OR REPLACE FUNCTION set_updated_at()
   RETURNS TRIGGER AS $$
   BEGIN NEW.updated_at = now(); RETURN NEW; END;
   $$ LANGUAGE plpgsql`,

  `DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders`,
  `CREATE TRIGGER trg_orders_updated_at
   BEFORE UPDATE ON orders
   FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,

  `DROP TRIGGER IF EXISTS trg_users_updated_at ON users`,
  `CREATE TRIGGER trg_users_updated_at
   BEFORE UPDATE ON users
   FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
];

async function migrate() {
  console.log("🗄️  Running migrations...\n");
  for (const sql of migrations) {
    const label = sql.slice(0, 60).replace(/\n/g, " ").trim();
    try {
      await query(sql);
      console.log(`  ✅ ${label}...`);
    } catch (err) {
      console.error(`  ❌ FAILED: ${label}`);
      console.error("     ", err.message);
      process.exit(1);
    }
  }
  console.log("\n✅ All migrations complete.\n");

  // Seed a default admin if none exists
  const { rows } = await query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
  if (rows.length === 0) {
    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.default.hash("Admin@1234", 12);
    await query(
      `INSERT INTO users (email, password_hash, role, alias)
       VALUES ($1, $2, 'admin', 'Admin')`,
      ["admin@dispatch.com", hash]
    );
    console.log("🔑 Default admin seeded:");
    console.log("   Email:    admin@dispatch.com");
    console.log("   Password: Admin@1234");
    console.log("   ⚠️  Change this password immediately after first login!\n");
  }

  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
