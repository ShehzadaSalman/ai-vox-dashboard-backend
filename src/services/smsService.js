import axios from "axios";
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
  "Your account has been approved with sisteme voice. Please login at: https://aivox-dashboard.vercel.app/";

const getClickSendClient = () => {
  const username = process.env.CLICK_SEND_USERNAME;
  const apiKey = process.env.CLICK_SEND_API_KEY;
  const baseUrl = process.env.CLICK_SEND_BASE_URL || "https://rest.clicksend.com/v3";
  const fromNumber = process.env.CLICK_SEND_PHONE_NUMBER;

  if (!username || !apiKey || !baseUrl || !fromNumber) {
    logger.warn("ClickSend SMS not configured", {
      hasUsername: Boolean(username),
      hasApiKey: Boolean(apiKey),
      hasBaseUrl: Boolean(baseUrl),
      hasFromNumber: Boolean(fromNumber),
    });
    return null;
  }

  const sanitizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const client = axios.create({
    baseURL: sanitizedBaseUrl,
    auth: { username, password: apiKey },
    headers: { "Content-Type": "application/json" },
    timeout: 10000,
  });

  return { client, fromNumber };
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
  const clickSendContext = getClickSendClient();
  if (!clickSendContext) {
    return { skipped: true };
  }

  const { client, fromNumber } = clickSendContext;
  const targets = (recipients || [])
    .map((phone) => normalizePhone(phone, defaultCountryCode))
    .filter((phone) => phone.length > 0);
  if (targets.length === 0) {
    return { skipped: true };
  }

  const messages = targets.map((to) => ({
    to,
    from: fromNumber,
    body,
    source: "aivox-dashboard",
  }));

  try {
    console.log("Sending the SMS to the payload: ", messages);
    const response = await client.post("/sms/send", { messages });
    console.log("Response for SMS: ", response?.data?.data);
    const responseCode = response?.data?.response_code;
    if (responseCode && responseCode !== "SUCCESS") {
      logger.warn("ClickSend SMS response not successful", {
        responseCode,
        responseMsg: response?.data?.response_msg,
      });
    }
    return { sent: targets.length, failed: 0 };
  } catch (error) {
    logger.error("ClickSend SMS send failed", {
      message: error?.message,
      data: error?.response?.data,
    });
    return { sent: 0, failed: targets.length };
  }
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

export const sendAppointmentConfirmationSms = async (
  phone,
  payload,
  options = {}
) => {
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
