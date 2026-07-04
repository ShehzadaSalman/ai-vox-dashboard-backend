import express from "express";
import Joi from "joi";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/database.js";
import { sendPasswordResetEmail, sendEmailVerificationCode } from "../services/emailService.js";
import {
  asyncHandler,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
} from "../middleware/errorHandler.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

// Brute-force protection for credential guessing (login).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many login attempts. Please try again in 15 minutes.",
});

// Prevents abuse of code-sending endpoints (email/SMS spam, account enumeration).
const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many code requests. Please try again in 15 minutes.",
});

// Prevents brute-forcing the 6-digit verification code.
const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many attempts. Please try again in 15 minutes.",
});

// Limits automated account creation from a single IP.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many accounts created from this IP. Please try again later.",
});

const SELF_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  phone: true,
  phone_verified_at: true,
  created_at: true,
};

const profileUpdateSchema = Joi.object({
  name: Joi.string().max(120).allow("").required(),
});

const passwordChangeSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().min(8).max(128).required(),
});

const phoneSchema = Joi.string()
  .pattern(/^\+?[1-9]\d{6,14}$/)
  .messages({
    "string.pattern.base": "Please enter a valid phone number",
  });

const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).max(128).required(),
  name: Joi.string().max(120).allow("").optional(),
  phone: phoneSchema.required(),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

const phoneStartSchema = Joi.object({
  email: Joi.string().email().required(),
  phone: phoneSchema.optional(),
});

const phoneVerifySchema = Joi.object({
  email: Joi.string().email().required(),
  code: Joi.string().length(6).required(),
});

const passwordResetStartSchema = Joi.object({
  email: Joi.string().email().required(),
});

const passwordResetVerifySchema = Joi.object({
  email: Joi.string().email().required(),
  code: Joi.string().length(6).required(),
});

const passwordResetCompleteSchema = Joi.object({
  email: Joi.string().email().required(),
  code: Joi.string().length(6).required(),
  password: Joi.string().min(8).max(128).required(),
});

const generateVerificationCode = () =>
  String(Math.floor(100000 + Math.random() * 900000));

function signToken(payload) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return jwt.sign(payload, secret, { expiresIn: "7d" });
}

router.post(
  "/register",
  registerLimiter,
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
          case "string.pattern.base":
            if (field === "phone") {
              return "Please enter a valid phone number";
            }
            return detail.message;
          default:
            return detail.message;
        }
      });
      throw new ValidationError(errorMessages[0] || "Validation failed");
    }

    const { email, password, name, phone } = value;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new ValidationError("Email already in use");

    const verificationCode = generateVerificationCode();
    const verificationExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const passwordHash = await bcrypt.hash(password, 12);
    // Convert empty string to null for optional name field
    const userName = name && name.trim() ? name.trim() : null;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name: userName,
        phone,
        status: "PENDING",
        phone_verification_code: verificationCode,
        phone_verification_expires_at: verificationExpiresAt,
        phone_verified_at: null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        created_at: true,
      },
    });

    try {
      await sendEmailVerificationCode({ to: email, code: verificationCode });
    } catch (emailError) {
      // Don't block registration if email fails
    }

    try {
      const trialPlan = await prisma.plan.findUnique({ where: { code: "TRIAL" } });
      if (trialPlan) {
        const now = new Date();
        const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        await prisma.subscription.create({
          data: {
            user_id: user.id,
            plan_id: trialPlan.id,
            status: "active",
            current_period_start: now,
            current_period_end: periodEnd,
          },
        });
      }
    } catch (planError) {
      // Don't block registration if trial plan assignment fails
    }

    res.status(201).json({
      success: true,
      data: user,
      message:
        "Your account is pending approval by a superadmin. A verification code was sent to your email.",
    });
  })
);

router.post(
  "/phone/start",
  otpRequestLimiter,
  asyncHandler(async (req, res) => {
    const { error, value } = phoneStartSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const { email, phone } = value;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new ValidationError("User not found");
    }

    const phoneToUse = phone || user.phone;
    if (!phoneToUse) {
      throw new ValidationError("Phone number is required");
    }

    if (user.phone_verified_at && phoneToUse === user.phone) {
      return res.json({
        success: true,
        verified: true,
        message: "Phone number already verified.",
      });
    }

    const verificationCode = generateVerificationCode();
    const verificationExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.user.update({
      where: { email },
      data: {
        phone: phoneToUse,
        phone_verification_code: verificationCode,
        phone_verification_expires_at: verificationExpiresAt,
        phone_verified_at: null,
      },
    });

    await sendEmailVerificationCode({ to: email, code: verificationCode });

    res.json({
      success: true,
      message: "Verification code sent to your email.",
    });
  })
);

router.post(
  "/phone/verify",
  otpVerifyLimiter,
  asyncHandler(async (req, res) => {
    const { error, value } = phoneVerifySchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const { email, code } = value;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new ValidationError("User not found");
    }

    if (!user.phone_verification_code || !user.phone_verification_expires_at) {
      throw new ValidationError("No verification code requested");
    }

    if (user.phone_verification_code !== code) {
      throw new ValidationError("Invalid verification code");
    }

    if (new Date(user.phone_verification_expires_at).getTime() < Date.now()) {
      throw new ValidationError("Verification code expired");
    }

    await prisma.user.update({
      where: { email },
      data: {
        phone_verified_at: new Date(),
        phone_verification_code: null,
        phone_verification_expires_at: null,
      },
    });

    res.json({
      success: true,
      message: "Phone number verified.",
    });
  })
);

router.post(
  "/password/email/start",
  otpRequestLimiter,
  asyncHandler(async (req, res) => {
    const { error, value } = passwordResetStartSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const { email } = value;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.json({
        success: true,
        message: "If that account exists, a reset code was sent.",
      });
    }

    const resetCode = generateVerificationCode();
    const resetExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.user.update({
      where: { email },
      data: {
        password_reset_code: resetCode,
        password_reset_expires_at: resetExpiresAt,
      },
    });

    await sendPasswordResetEmail({ to: email, code: resetCode });

    res.json({
      success: true,
      message: "If that account exists, a reset code was sent.",
    });
  })
);

router.post(
  "/password/email/verify",
  otpVerifyLimiter,
  asyncHandler(async (req, res) => {
    const { error, value } = passwordResetVerifySchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const { email, code } = value;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.json({ success: true, verified: false });
    }

    if (!user.password_reset_code || !user.password_reset_expires_at) {
      throw new ValidationError("No reset code requested");
    }

    if (user.password_reset_code !== code) {
      throw new ValidationError("Invalid reset code");
    }

    if (new Date(user.password_reset_expires_at).getTime() < Date.now()) {
      throw new ValidationError("Reset code expired");
    }

    res.json({ success: true, verified: true });
  })
);

router.post(
  "/password/email/complete",
  otpVerifyLimiter,
  asyncHandler(async (req, res) => {
    const { error, value } = passwordResetCompleteSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const { email, code, password } = value;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new ValidationError("Invalid reset request");
    }

    if (!user.password_reset_code || !user.password_reset_expires_at) {
      throw new ValidationError("No reset code requested");
    }

    if (user.password_reset_code !== code) {
      throw new ValidationError("Invalid reset code");
    }

    if (new Date(user.password_reset_expires_at).getTime() < Date.now()) {
      throw new ValidationError("Reset code expired");
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await prisma.user.update({
      where: { email },
      data: {
        passwordHash,
        password_reset_code: null,
        password_reset_expires_at: null,
      },
    });

    res.json({ success: true, message: "Password reset successfully." });
  })
);

router.post(
  "/login",
  loginLimiter,
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

    if (user.status !== "APPROVED") {
      throw new ForbiddenError("Account pending approval");
    }

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
          status: true,
          phone: true,
          phone_verified_at: true,
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

// Update the signed-in user's own profile (currently just their display name).
router.patch(
  "/me",
  authMiddleware,
  asyncHandler(async (req, res) => {
    if (!req.user?.id) {
      throw new UnauthorizedError("Authentication required");
    }
    const { error, value } = profileUpdateSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      throw new ValidationError(error.details[0].message);
    }
    const name = value.name && value.name.trim() ? value.name.trim() : null;
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { name },
      select: SELF_USER_SELECT,
    });
    res.json({ success: true, data: user });
  })
);

// Change the signed-in user's password (requires their current password).
router.post(
  "/password/change",
  authMiddleware,
  asyncHandler(async (req, res) => {
    if (!req.user?.id) {
      throw new UnauthorizedError("Authentication required");
    }
    const { error, value } = passwordChangeSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, passwordHash: true },
    });
    if (!user) {
      throw new UnauthorizedError("User not found");
    }
    const matches = await bcrypt.compare(value.currentPassword, user.passwordHash);
    if (!matches) {
      throw new ValidationError("Current password is incorrect");
    }
    if (value.currentPassword === value.newPassword) {
      throw new ValidationError("New password must be different from the current one");
    }
    const passwordHash = await bcrypt.hash(value.newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });
    res.json({ success: true, message: "Password updated" });
  })
);

export default router;
