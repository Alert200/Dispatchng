/**
 * Wraps async route handlers to catch errors automatically.
 * Usage: router.get("/", asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Global error handler — place at the end of app middleware stack.
 */
export function errorHandler(err, req, res, next) {
  console.error("[Error]", {
    message: err.message,
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
    path: req.path,
    method: req.method,
    user: req.user?.id,
  });

  // Zod validation errors
  if (err.name === "ZodError") {
    return res.status(400).json({
      error: "Validation failed",
      details: err.errors.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      })),
    });
  }

  // Postgres unique constraint
  if (err.code === "23505") {
    const field = err.detail?.match(/Key \((.+)\)=/)?.[1] || "field";
    return res.status(409).json({ error: `${field} already exists` });
  }

  // Postgres foreign key violation
  if (err.code === "23503") {
    return res.status(400).json({ error: "Referenced record does not exist" });
  }

  // Default
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: status === 500 ? "Internal server error" : err.message,
  });
}

/**
 * Create an HTTP error with a status code.
 * throw createError(404, "Order not found")
 */
export function createError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
