import { Resend } from "resend";
import { logger } from "../lib/logger.js";

const getClient = () => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn("Email service not configured", { hasApiKey: false });
    return null;
  }
  return new Resend(apiKey);
};

export const sendEmail = async ({ to, subject, text, html, replyTo }) => {
  const resend = getClient();
  if (!resend) {
    return { skipped: true };
  }

  const from = process.env.EMAIL_FROM;

  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      ...(html ? { html } : {}),
      ...(text ? { text } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
    });

    if (error) {
      logger.error("Email send failed", { error });
      return { sent: false };
    }

    return { sent: true, messageId: data.id };
  } catch (error) {
    logger.error("Email send failed", { message: error?.message });
    return { sent: false };
  }
};

export const sendPasswordResetEmail = async ({ to, code }) => {
  const subject = "Your Candibly Voice password reset code";
  const text = `Your password reset verification code is ${code}. This code will expire in 10 minutes. If you did not request a password reset, please ignore this message.`;

  return sendEmail({ to, subject, text });
};

