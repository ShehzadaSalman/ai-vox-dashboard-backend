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
  `Your Candibly verification code is ${code}. It expires in 10 minutes.`;

const buildAppointmentMessage = (payload) => {
  const safe = (value) => (value ? String(value) : "N/A");
  const formattedTime = formatVisitTime(payload.visitTime);
  const link = payload?.calLink ? String(payload.calLink) : "";
  const linkLine = link ? `In case you'd want to change the visit time, you can do so at: ${link}` : "";
  return [
    `Hey ${safe(payload.name)}, your appointment has been confirmed at ${formattedTime}.`,
    linkLine,
  ]
    .filter(Boolean)
    .join(" ");
};

const buildAccountApprovedMessage = () =>
  "Your account has been approved with Candibly. Please login at: https://candibly.vercel.app/";

const getTwilioClient = () => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    logger.warn("Twilio SMS not configured", {
      hasAccountSid: Boolean(accountSid),
      hasAuthToken: Boolean(authToken),
      hasFromNumber: Boolean(fromNumber),
    });
    return null;
  }

  return { client: twilio(accountSid, authToken), fromNumber };
};

const normalizeCountryCode = (value) => {
  if (!value) return "";
  const trimmed = String(value).trim().replace(/\s+/g, "");
  if (!trimmed) return "";
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
};

const normalizePhone = (value, defaultCountryCode = "") => {
  if (!value) return "";
  const trimmed = String(value).trim().replace(/\s+/g, "");
  if (!trimmed) return "";
  if (trimmed.startsWith("+")) {
    return trimmed;
  }
  const normalizedCode = normalizeCountryCode(defaultCountryCode);
  if (trimmed.startsWith("0") && normalizedCode) {
    return `${normalizedCode}${trimmed.replace(/^0+/, "")}`;
  }
  return normalizedCode ? `${normalizedCode}${trimmed}` : trimmed;
};

const sendSmsBatch = async (recipients, body, options = {}) => {
  const defaultCountryCode = options?.defaultCountryCode || "";
  const twilioContext = getTwilioClient();
  if (!twilioContext) {
    return { skipped: true };
  }

  const { client, fromNumber } = twilioContext;
  const targets = (recipients || [])
    .map((phone) => normalizePhone(phone, defaultCountryCode))
    .filter((phone) => phone.length > 0);
  if (targets.length === 0) {
    return { skipped: true };
  }

  let sent = 0;
  let failed = 0;

  await Promise.all(
    targets.map(async (to) => {
      try {
        const message = await client.messages.create({ to, from: fromNumber, body });
        logger.info("Twilio SMS sent", { to, sid: message.sid, status: message.status, errorCode: message.errorCode, errorMessage: message.errorMessage });
        sent++;
      } catch (error) {
        logger.error("Twilio SMS send failed", { to, message: error?.message, code: error?.code });
        failed++;
      }
    })
  );

  return { sent, failed };
};

export const sendNewLeadSms = async (payload, recipients, options = {}) => {
  const body = buildLeadMessage(payload);
  return sendSmsBatch(recipients, body, options);
};

export const sendPhoneVerificationSms = async (phone, code, options = {}) => {
  if (!phone) {
    return { skipped: true };
  }
  const body = buildVerificationMessage(code);
  return sendSmsBatch([phone], body, options);
};

export const sendAppointmentConfirmationSms = async (phone, payload, options = {}) => {
  if (!phone) {
    return { skipped: true };
  }
  const body = buildAppointmentMessage(payload);
  return sendSmsBatch([phone], body, options);
};

export const sendAccountApprovedSms = async (phone, options = {}) => {
  if (!phone) {
    return { skipped: true };
  }
  const body = buildAccountApprovedMessage();
  return sendSmsBatch([phone], body, options);
};
