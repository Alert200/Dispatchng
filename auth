import { Router } from "express";
import { asyncHandler } from "../middleware/errors.js";
import { authenticate } from "../middleware/auth.js";
import { registerSchema, loginSchema, registerDeviceSchema } from "../validators/schemas.js";
import { registerUser, loginUser, getProfile, registerDevice } from "../services/authService.js";

const router = Router();

// POST /api/auth/register
router.post("/register", asyncHandler(async (req, res) => {
  const data = registerSchema.parse(req.body);
  const result = await registerUser(data);
  res.status(201).json({
    message: "Account created successfully",
    ...result,
  });
}));

// POST /api/auth/login
router.post("/login", asyncHandler(async (req, res) => {
  const data = loginSchema.parse(req.body);
  const result = await loginUser(data);
  res.json({
    message: "Login successful",
    ...result,
  });
}));

// GET /api/auth/me
router.get("/me", authenticate, asyncHandler(async (req, res) => {
  const user = await getProfile(req.user.id);
  res.json({ user });
}));

// POST /api/auth/devices — Register FCM token for push notifications
router.post("/devices", authenticate, asyncHandler(async (req, res) => {
  const { fcmToken } = registerDeviceSchema.parse(req.body);
  await registerDevice(req.user.id, fcmToken);
  res.json({ message: "Device registered for notifications" });
}));

export default router;
