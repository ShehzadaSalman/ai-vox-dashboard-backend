import express from "express";
import Joi from "joi";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/database.js";
import { sendPhoneVerificationSms } from "../services/smsService.js";
import { sendPasswordResetEmail } from "../services/emailService.js";
import {
  asyncHandler,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
} from "../middleware/errorHandler.js";

const router = express.Router();

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
      await sendPhoneVerificationSms(phone, verificationCode);
    } catch (smsError) {
      // Don't block registration if SMS fails
    }

    res.status(201).json({
      success: true,
      data: user,
      message:
        "Your account is pending approval by a superadmin. A phone verification code was sent to your number.",
    });
  })
);

router.post(
  "/phone/start",
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

    await sendPhoneVerificationSms(phoneToUse, verificationCode);

    res.json({
      success: true,
      message: "Verification code sent.",
    });
  })
);

router.post(
  "/phone/verify",
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

export default router;
