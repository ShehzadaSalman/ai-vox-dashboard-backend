import { logger } from "../lib/logger.js";

/**
 * Error handling middleware for Express
 * Must be used as the last middleware in the app
 */
export const errorHandler = (err, req, res, next) => {
  // Log the error
  logger.error("Unhandled error", {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get("User-Agent"),
  });

  // Default error response
  let statusCode = err.statusCode || err.status || 500;
  let message = err.message || "Internal Server Error";

  // Handle specific error types
  if (err.name === "ValidationError") {
    statusCode = 400;
    message = "Validation Error";
  } else if (err.name === "UnauthorizedError") {
    statusCode = 401;
    message = "Unauthorized";
  } else if (err.name === "ForbiddenError") {
    statusCode = 403;
    message = "Forbidden";
  } else if (err.name === "NotFoundError") {
    statusCode = 404;
    message = "Not Found";
  } else if (err.code === "P2002") {
    // Prisma unique constraint error
    statusCode = 409;
    message = "Resource already exists";
  } else if (err.code === "P2025") {
    // Prisma record not found error
    statusCode = 404;
    message = "Resource not found";
  }

  // Don't expose internal errors in production
  if (process.env.NODE_ENV === "production" && statusCode === 500) {
    message = "Internal Server Error";
  }

  // Send error response
  res.status(statusCode).json({
    error: true,
    message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};

/**
 * Async error wrapper to catch async errors in route handlers
 */
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Custom error classes
 */
export class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed") {
    super(message, 400);
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, 403);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, 404);
    this.name = "NotFoundError";
  }
}
