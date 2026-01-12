import twilio from "twilio";
import { logger } from "../lib/logger.js";

const formatVisitTime = (visitTime) => {
  if (!visitTime) {
    return "N/A";
  }
  const parsed = visitTime instanceof Date ? visitTime : new Date(visitTime);
  if (Number.isNaN(parsed.getTime())) {
    return String(visitTime);
  }
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
};

const buildLeadMessage = (payload) => {
  const safe = (value) => (value ? String(value) : "N/A");

  return [
    "New lead captured",
    `Name: ${safe(payload.name)}`,
    `Phone: ${safe(payload.phone)}`,
    `Email: ${safe(payload.email)}`,
    `Address: ${safe(payload.address)}`,
    `Visit Time: ${formatVisitTime(payload.visitTime)}`,
    `Reason: ${safe(payload.reason)}`,
    `Agent Name: ${safe(payload.agentName)}`,
    `Status: ${safe(payload.status)}`,
  ].join("\n");
};

const buildVerificationMessage = (code) =>
  `Your AIVOX verification code is ${code}. It expires in 10 minutes.`;

const getTwilioClient = () => {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !token || !fromNumber) {
    logger.warn("Twilio SMS not configured", {
      hasSid: Boolean(sid),
      hasToken: Boolean(token),
      hasFromNumber: Boolean(fromNumber),
    });
    return null;
  }

  return { client: twilio(sid, token), fromNumber };
};

const sendSmsBatch = async (recipients, body) => {
  const twilioContext = getTwilioClient();
  if (!twilioContext) {
    return { skipped: true };
  }

  const { client, fromNumber } = twilioContext;
  const targets = (recipients || []).filter(Boolean);
  if (targets.length === 0) {
    return { skipped: true };
  }

  const results = await Promise.allSettled(
    targets.map((to) => client.messages.create({ to, from: fromNumber, body }))
  );

  const sent = results.filter((result) => result.status === "fulfilled").length;
  const failed = results.length - sent;
  if (failed > 0) {
    logger.warn("Some SMS messages failed", { sent, failed });
  }

  return { sent, failed };
};

export const sendNewLeadSms = async (payload, recipients) => {
  const body = buildLeadMessage(payload);
  return sendSmsBatch(recipients, body);
};

export const sendPhoneVerificationSms = async (phone, code) => {
  if (!phone) {
    return { skipped: true };
  }
  const body = buildVerificationMessage(code);
  return sendSmsBatch([phone], body);
};
