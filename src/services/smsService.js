import twilio from "twilio";
import { logger } from "../lib/logger.js";

const DESTINATION_NUMBER = "+14374509656";

const formatVisitTime = (visitTime) => {
  if (!visitTime) {
    return "N/A";
  }
  if (visitTime instanceof Date) {
    return visitTime.toISOString();
  }
  const parsed = new Date(visitTime);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }
  return String(visitTime);
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
    `Agent ID: ${safe(payload.agentId)}`,
    `Agent Name: ${safe(payload.agentName)}`,
    `Status: ${safe(payload.status)}`,
  ].join("\n");
};

export const sendNewLeadSms = async (payload) => {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !token || !fromNumber) {
    logger.warn("Twilio SMS not configured", {
      hasSid: Boolean(sid),
      hasToken: Boolean(token),
      hasFromNumber: Boolean(fromNumber),
    });
    return { skipped: true };
  }

  const client = twilio(sid, token);
  const body = buildLeadMessage(payload);

  return client.messages.create({
    to: DESTINATION_NUMBER,
    from: fromNumber,
    body,
  });
};
