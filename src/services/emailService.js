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

export const sendEmailVerificationCode = async ({ to, code }) => {
  const subject = "Your Candibly verification code";
  const text = `Your Candibly verification code is ${code}. It expires in 10 minutes.`;

  return sendEmail({ to, subject, text });
};

export const sendNewLeadEmail = async (payload, emailRecipients) => {
  if (!emailRecipients || emailRecipients.length === 0) {
    return { skipped: true };
  }

  const { name, phone, email, company, address, reason, agentName, visitTime } = payload;

  const lines = [
    `A new lead has been captured by agent ${agentName || "unknown"}.`,
    "",
    `Name:    ${name || "—"}`,
    `Phone:   ${phone || "—"}`,
    `Email:   ${email || "—"}`,
    `Company: ${company || "—"}`,
    `Address: ${address || "—"}`,
    `Reason:  ${reason || "—"}`,
    `Visit:   ${visitTime ? new Date(visitTime).toLocaleString() : "—"}`,
  ];

  const text = lines.join("\n");

  const html = `
    <h2 style="margin:0 0 12px">New Lead — ${name || "Unknown"}</h2>
    <table style="border-collapse:collapse;font-size:14px">
      <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Agent</td><td style="padding:4px 0"><strong>${agentName || "—"}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Name</td><td style="padding:4px 0">${name || "—"}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Phone</td><td style="padding:4px 0">${phone || "—"}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Email</td><td style="padding:4px 0">${email || "—"}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Company</td><td style="padding:4px 0">${company || "—"}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Address</td><td style="padding:4px 0">${address || "—"}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Reason</td><td style="padding:4px 0">${reason || "—"}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Visit Time</td><td style="padding:4px 0">${visitTime ? new Date(visitTime).toLocaleString() : "—"}</td></tr>
    </table>
  `.trim();

  const results = await Promise.allSettled(
    emailRecipients.map((to) =>
      sendEmail({ to, subject: `New Lead: ${name || "Unknown"}`, text, html })
    )
  );

  const sent = results.filter((r) => r.status === "fulfilled" && r.value?.sent).length;
  return { sent, total: emailRecipients.length };
};

export const sendAppointmentConfirmationEmail = async (email, payload) => {
  if (!email) {
    return { skipped: true };
  }

  const { name, visitTime, calLink } = payload;
  const formattedTime = visitTime ? new Date(visitTime).toLocaleString() : "N/A";
  const linkLine = calLink
    ? `If you'd like to reschedule, you can do so at: ${calLink}`
    : "";

  const text = [
    `Hey ${name || "there"}, your appointment has been confirmed at ${formattedTime}.`,
    linkLine,
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
    <p>Hey <strong>${name || "there"}</strong>, your appointment has been confirmed at <strong>${formattedTime}</strong>.</p>
    ${calLink ? `<p>If you'd like to reschedule, you can do so at: <a href="${calLink}">${calLink}</a></p>` : ""}
  `.trim();

  return sendEmail({ to: email, subject: "Your Appointment is Confirmed", text, html });
};

export const sendAccountApprovedEmail = async (email) => {
  if (!email) {
    return { skipped: true };
  }

  const text = "Your account has been approved with Candibly. Please login at: https://candibly.vercel.app/";
  const html = `
    <p>Your account has been approved with Candibly.</p>
    <p><a href="https://candibly.vercel.app/">Click here to login</a></p>
  `.trim();

  return sendEmail({ to: email, subject: "Your Candibly Account is Approved", text, html });
};

