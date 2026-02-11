import nodemailer from "nodemailer";
import { logger } from "../lib/logger.js";

const getEmailTransport = () => {
  const host = process.env.EMAIL_HOST;
  const port = Number(process.env.EMAIL_PORT || 465);
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  const secure = String(process.env.EMAIL_SECURE || "true").toLowerCase() === "true";

  if (!host || !user || !pass) {
    logger.warn("Email service not configured", {
      hasHost: Boolean(host),
      hasUser: Boolean(user),
      hasPass: Boolean(pass),
    });
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
};

export const sendEmail = async ({ to, subject, text, html, replyTo }) => {
  const transporter = getEmailTransport();
  if (!transporter) {
    return { skipped: true };
  }

  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
      replyTo,
    });

    return { sent: true, messageId: info.messageId };
  } catch (error) {
    logger.error("Email send failed", {
      message: error?.message,
      code: error?.code,
      response: error?.response,
    });
    return { sent: false };
  }
};

export const sendPasswordResetEmail = async ({ to, code }) => {
  const subject = "Your Sisteme Voice password reset code";
  const text = `Your password reset verification code is ${code}. This code will expire in 10 minutes. If you did not request a password reset, please ignore this message.`;

  return sendEmail({ to, subject, text });
};
