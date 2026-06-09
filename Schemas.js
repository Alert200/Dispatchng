import { z } from "zod";

// ─── Auth ───────────────────────────────────────────────────────────────────

export const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  role: z.enum(["worker", "customer"], {
    errorMap: () => ({ message: "Role must be worker or customer" }),
  }),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
});

// ─── Orders ─────────────────────────────────────────────────────────────────

export const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa",
  "Benue", "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti",
  "Enugu", "FCT", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina",
  "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo",
  "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara",
];

export const createOrderSchema = z.object({
  state: z.enum(NIGERIAN_STATES, {
    errorMap: () => ({ message: "Invalid Nigerian state" }),
  }),
  content: z.object({
    description: z.string().min(5, "Order description is required"),
    items: z.array(z.string()).optional().default([]),
    quantity: z.number().int().positive().optional(),
    deliveryAddress: z.string().min(5, "Delivery address is required"),
    specialInstructions: z.string().optional(),
  }),
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(["accepted", "processing", "delayed", "delivered", "cancelled"]),
  note: z.string().optional(),
});

// ─── Worker Assignments ─────────────────────────────────────────────────────

export const assignWorkerSchema = z.object({
  workerId: z.string().uuid("Invalid worker ID"),
  states: z
    .array(z.enum(NIGERIAN_STATES))
    .min(1, "At least one state is required")
    .max(5, "Cannot assign more than 5 states at once"),
});

export const unassignWorkerSchema = z.object({
  workerId: z.string().uuid(),
  state: z.enum(NIGERIAN_STATES),
});

// ─── Chat ───────────────────────────────────────────────────────────────────

export const sendMessageSchema = z.object({
  body: z
    .string()
    .min(1, "Message cannot be empty")
    .max(1000, "Message too long (max 1000 chars)"),
});

// ─── Payment ────────────────────────────────────────────────────────────────

export const paymentDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().optional(),
});

// ─── FCM Device ─────────────────────────────────────────────────────────────

export const registerDeviceSchema = z.object({
  fcmToken: z.string().min(10, "Invalid FCM token"),
  platform: z.enum(["android", "ios", "web"]),
});
