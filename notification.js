import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errors.js";
import { getUserNotifications, markNotificationsRead } from "../services/notificationService.js";

const router = Router();
router.use(authenticate);

// GET /api/notifications
router.get("/", asyncHandler(async (req, res) => {
  const result = await getUserNotifications(req.user.id, {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 30,
  });
  res.json(result);
}));

// PATCH /api/notifications/read — Mark all or specific notifications as read
router.patch("/read", asyncHandler(async (req, res) => {
  const { ids } = req.body; // optional array of UUIDs
  await markNotificationsRead(req.user.id, ids);
  res.json({ message: "Notifications marked as read" });
}));

export default router;
