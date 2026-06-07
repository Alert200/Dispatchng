/**
 * Add this to src/services/authService.js (or a new adminService.js)
 * and wire it into src/routes/admin.js
 *
 * POST /api/admin/workers/create
 * Admin creates a worker account, credentials shown on screen + emailed
 */

import bcrypt from "bcryptjs";
import { query } from "../db/pool.js";
import { createError } from "../middleware/errors.js";

// ─── Generate a secure temporary password ────────────────────────────────────
function generateTempPassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const special = "@#!";
  const all = upper + lower + digits + special;

  let pwd = "";
  pwd += upper[Math.floor(Math.random() * upper.length)];
  pwd += digits[Math.floor(Math.random() * digits.length)];
  pwd += special[Math.floor(Math.random() * special.length)];
  for (let i = 0; i < 7; i++) pwd += all[Math.floor(Math.random() * all.length)];

  // Shuffle
  return pwd.split("").sort(() => Math.random() - 0.5).join("");
}

// ─── Generate worker alias ────────────────────────────────────────────────────
async function generateWorkerAlias() {
  const { rows } = await query(`SELECT COUNT(*) AS cnt FROM users WHERE role='worker'`);
  const n = String(parseInt(rows[0].cnt) + 1).padStart(4, "0");
  return `Agent #${n}`;
}

// ─── Create worker (admin action) ────────────────────────────────────────────
export async function adminCreateWorker({ email, adminId }) {
  // Check duplicate
  const { rows: existing } = await query(`SELECT id FROM users WHERE email=$1`, [email]);
  if (existing.length > 0) throw createError(409, "Email already registered");

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 12);
  const alias = await generateWorkerAlias();

  const { rows } = await query(
    `INSERT INTO users (email, password_hash, role, alias)
     VALUES ($1, $2, 'worker', $3)
     RETURNING id, email, role, alias, created_at`,
    [email, passwordHash, alias]
  );

  const worker = rows[0];

  // ── Send email via Nodemailer (configure your SMTP in .env) ──────────────
  let emailSent = false;
  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.default.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    await transporter.sendMail({
      from: `"DispatchNG" <${process.env.SMTP_USER}>`,
      to: email,
      subject: "Your DispatchNG Worker Account",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f8fafc;border-radius:12px;">
          <h2 style="color:#1d4ed8;margin-bottom:4px;">Welcome to DispatchNG 🚚</h2>
          <p style="color:#374151;">Your worker account has been created. Use the credentials below to sign in.</p>

          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin:20px 0;">
            <p style="margin:0 0 12px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">YOUR LOGIN DETAILS</p>
            <p style="margin:0 0 8px;"><strong>Portal:</strong> <a href="${process.env.WORKER_URL}">${process.env.WORKER_URL}</a></p>
            <p style="margin:0 0 8px;"><strong>Email:</strong> ${email}</p>
            <p style="margin:0;"><strong>Password:</strong> <code style="background:#f3f4f6;padding:3px 8px;border-radius:4px;font-size:15px;">${tempPassword}</code></p>
          </div>

          <p style="color:#ef4444;font-size:13px;">⚠️ Please change your password after your first login.</p>
          <p style="color:#6b7280;font-size:12px;">Do not share these details. All communication with customers happens inside the platform only.</p>
        </div>
      `,
    });
    emailSent = true;
  } catch (err) {
    console.error("[Email] Failed to send worker credentials:", err.message);
    // Non-fatal — credentials still shown on screen
  }

  return {
    worker,
    tempPassword,   // Shown on admin screen ONCE
    emailSent,
  };
}

/*
─────────────────────────────────────────────────────────────────────────────
ADD TO src/routes/admin.js:
─────────────────────────────────────────────────────────────────────────────

import { adminCreateWorker } from "../services/adminService.js";
import { z } from "zod";

const createWorkerSchema = z.object({
  email: z.string().email("Enter a valid email"),
});

// POST /api/admin/workers/create
router.post("/workers/create", asyncHandler(async (req, res) => {
  const { email } = createWorkerSchema.parse(req.body);
  const result = await adminCreateWorker({ email, adminId: req.user.id });

  res.status(201).json({
    message: "Worker account created",
    worker: result.worker,
    credentials: {
      email: result.worker.email,
      tempPassword: result.tempPassword,   // Show ONCE — not stored in plain text
    },
    emailSent: result.emailSent,
  });
}));

─────────────────────────────────────────────────────────────────────────────
ADD TO .env.example:
─────────────────────────────────────────────────────────────────────────────

# SMTP (for sending worker credentials by email)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# For Gmail: use an App Password (not your main password)
# Generate at: https://myaccount.google.com/apppasswords

─────────────────────────────────────────────────────────────────────────────
ALTERNATIVE SMTP PROVIDERS (recommended for Nigeria):
─────────────────────────────────────────────────────────────────────────────
- Brevo (Sendinblue) — free 300 emails/day
- Mailgun — reliable delivery
- Resend — modern, dev-friendly, 3000 free/month

All use the same nodemailer config above — just change SMTP_HOST/PORT/USER/PASS
─────────────────────────────────────────────────────────────────────────────
*/
