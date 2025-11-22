import { logger } from "../lib/logger.js";
import { UnauthorizedError, ForbiddenError } from "./errorHandler.js";
import jwt from "jsonwebtoken";

/**
 * API Key authentication middleware
 * Checks for API key in Authorization header or x-api-key header
 */
export const authMiddleware = (req, res, next) => {
  try {
    const apiKey = process.env.API_AUTH_KEY;

    if (!apiKey) {
      logger.error("API_AUTH_KEY environment variable not set");
      return res.status(500).json({
        error: true,
        message: "Server configuration error",
      });
    }

    // Prefer JWT if provided
    const authHeader = req.headers.authorization;
    const bearerToken =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;

    if (!bearerToken && !req.headers["x-api-key"]) {
      logger.warn("API request without authentication", {
        ip: req.ip,
        url: req.url,
        method: req.method,
      });
      throw new UnauthorizedError("API key required");
    }

    // Try JWT first
    if (bearerToken && process.env.JWT_SECRET) {
      try {
        const decoded = jwt.verify(bearerToken, process.env.JWT_SECRET);
        req.user = { id: decoded.sub, role: decoded.role };
        logger.debug("JWT authentication successful", { url: req.url });
        return next();
      } catch (e) {
        // fall through to API key auth
      }
    }

    // Fallback to API key authentication
    const providedKey = req.headers["x-api-key"] || bearerToken;
    if (providedKey !== apiKey) {
      logger.warn("API request with invalid credentials", { url: req.url });
      throw new UnauthorizedError("Invalid credentials");
    }

    logger.debug("API key authentication successful", { url: req.url });

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Optional authentication middleware (for public endpoints)
 * Adds user info to request if API key is provided
 */
export const optionalAuthMiddleware = (req, res, next) => {
  try {
    const apiKey = process.env.API_AUTH_KEY;

    if (!apiKey) {
      return next();
    }

    const authHeader = req.headers.authorization;
    const bearerToken =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;

    const apiKeyHeader = req.headers["x-api-key"];
    const providedKey = bearerToken || apiKeyHeader;

    if (providedKey && providedKey === apiKey) {
      req.authenticated = true;
      logger.debug("Optional authentication successful", {
        ip: req.ip,
        url: req.url,
        method: req.method,
      });
    } else {
      req.authenticated = false;
    }

    next();
  } catch (error) {
    req.authenticated = false;
    next();
  }
};

/**
 * Admin-only middleware
 * Requires user to be authenticated and have ADMIN role
 */
export const adminMiddleware = (req, res, next) => {
  try {
    // First ensure user is authenticated
    if (!req.user || !req.user.id) {
      throw new UnauthorizedError("Authentication required");
    }

    // Check if user has ADMIN role
    if (req.user.role !== "ADMIN") {
      logger.warn("Admin access denied", {
        userId: req.user.id,
        role: req.user.role,
        url: req.url,
      });
      throw new ForbiddenError("Admin access required");
    }

    next();
  } catch (error) {
    next(error);
  }
};
