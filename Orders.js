import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errors.js";
import { createOrderSchema, updateOrderStatusSchema } from "../validators/schemas.js";
import {
  createOrder, getOrders, getOrderById,
  updateOrderStatus, getOrderHistory,
} from "../services/orderService.js";

const router = Router();

// All order routes require authentication
router.use(authenticate);

// POST /api/orders — Customer creates an order
router.post("/", authorize("customer"), asyncHandler(async (req, res) => {
  const data = createOrderSchema.parse(req.body);
  const order = await createOrder({
    customerId: req.user.id,
    state: data.state,
    content: data.content,
  });
  res.status(201).json({ message: "Order submitted successfully", order });
}));

// GET /api/orders — List orders (role-filtered automatically)
router.get("/", asyncHandler(async (req, res) => {
  const { state, status, page, limit } = req.query;
  const result = await getOrders({
    userId: req.user.id,
    role: req.user.role,
    state,
    status,
    page: parseInt(page) || 1,
    limit: Math.min(parseInt(limit) || 20, 100),
  });
  res.json(result);
}));

// GET /api/orders/:id — Get single order
router.get("/:id", asyncHandler(async (req, res) => {
  const order = await getOrderById(req.params.id, {
    userId: req.user.id,
    role: req.user.role,
  });
  res.json({ order });
}));

// PATCH /api/orders/:id/status — Worker or Admin updates status
router.patch("/:id/status", authorize("worker", "admin"), asyncHandler(async (req, res) => {
  const { status, note } = updateOrderStatusSchema.parse(req.body);
  const result = await updateOrderStatus({
    orderId: req.params.id,
    newStatus: status,
    note,
    userId: req.user.id,
    role: req.user.role,
  });
  res.json({ message: "Order status updated", ...result });
}));

// GET /api/orders/:id/history — Full audit trail (admin or order parties)
router.get("/:id/history", asyncHandler(async (req, res) => {
  const history = await getOrderHistory(req.params.id);
  res.json({ history });
}));

export default router;
