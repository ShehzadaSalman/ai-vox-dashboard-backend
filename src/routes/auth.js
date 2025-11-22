import express from "express";
import Joi from "joi";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/database.js";
import {
  asyncHandler,
  ValidationError,
  UnauthorizedError,
} from "../middleware/errorHandler.js";

const router = express.Router();

const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).max(128).required(),
  name: Joi.string().max(120).allow("").optional(),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

function signToken(payload) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return jwt.sign(payload, secret, { expiresIn: "7d" });
}

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { error, value } = registerSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    
    if (error) {
      // Format Joi validation errors into user-friendly messages
      const errorMessages = error.details.map((detail) => {
        const field = detail.path.join(".");
        switch (detail.type) {
          case "string.email":
            return "Please enter a valid email address";
          case "string.min":
            if (field === "password") {
              return "Password must be at least 8 characters long";
            }
            return `${field} is too short`;
          case "string.max":
            return `${field} is too long`;
          case "any.required":
            return `${field} is required`;
          default:
            return detail.message;
        }
      });
      throw new ValidationError(errorMessages[0] || "Validation failed");
    }

    const { email, password, name } = value;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new ValidationError("Email already in use");

    const passwordHash = await bcrypt.hash(password, 12);
    // Convert empty string to null for optional name field
    const userName = name && name.trim() ? name.trim() : null;
    const user = await prisma.user.create({
      data: { email, passwordHash, name: userName },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        created_at: true,
      },
    });

    const token = signToken({ sub: user.id, role: user.role });
    res.status(201).json({ success: true, data: user, token });
  })
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { error, value } = loginSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    
    if (error) {
      // Format Joi validation errors into user-friendly messages
      const errorMessages = error.details.map((detail) => {
        const field = detail.path.join(".");
        switch (detail.type) {
          case "string.email":
            return "Please enter a valid email address";
          case "any.required":
            return `${field} is required`;
          default:
            return detail.message;
        }
      });
      throw new ValidationError(errorMessages[0] || "Validation failed");
    }

    const { email, password } = value;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedError("Invalid credentials");

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedError("Invalid credentials");

    const token = signToken({ sub: user.id, role: user.role });
    res.json({ success: true, token });
  })
);

router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const auth = req.headers.authorization;
    const token = auth && auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) throw new UnauthorizedError("Missing token");

    const secret = process.env.JWT_SECRET;
    try {
      const decoded = jwt.verify(token, secret);
      const user = await prisma.user.findUnique({
        where: { id: decoded.sub },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          created_at: true,
        },
      });
      if (!user) throw new UnauthorizedError("User not found");
      res.json({ success: true, data: user });
    } catch (e) {
      throw new UnauthorizedError("Invalid token");
    }
  })
);

export default router;
