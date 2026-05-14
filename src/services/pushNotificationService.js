import axios from "axios";
import { logger } from "../lib/logger.js";

const getOneSignalClient = () => {
  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;

  if (!appId || !apiKey) {
    logger.warn("OneSignal push not configured", {
      hasAppId: Boolean(appId),
      hasApiKey: Boolean(apiKey),
    });
    return null;
  }

  const client = axios.create({
    baseURL: "https://onesignal.com/api/v1",
    headers: {
      Authorization: `Basic ${apiKey}`,
      "Content-Type": "application/json",
    },
    timeout: 10000,
  });

  return { client, appId };
};

const sendPush = async ({ userIds, title, body, data = {} }) => {
  const context = getOneSignalClient();
  if (!context) return { skipped: true };

  const targets = (userIds || []).filter(Boolean);
  if (targets.length === 0) return { skipped: true };

  const { client, appId } = context;

  try {
    const response = await client.post("/notifications", {
      app_id: appId,
      include_external_user_ids: targets,
      channel_for_external_user_ids: "push",
      headings: { en: title },
      contents: { en: body },
      data,
    });

    const { id, recipients } = response.data;
    logger.info("Push notification sent", { id, recipients, title });
    return { sent: recipients ?? targets.length };
  } catch (error) {
    logger.error("Push notification failed", {
      message: error?.message,
      data: error?.response?.data,
    });
    return { sent: 0, failed: targets.length };
  }
};

export const sendNewLeadPush = async (payload, userIds) => {
  return sendPush({
    userIds,
    title: "New Lead",
    body: `${payload.name || "A new lead"} has been captured${payload.agentName ? ` for ${payload.agentName}` : ""}.`,
    data: { type: "new_lead", leadId: payload.id },
  });
};

export const sendAppointmentPush = async (phone, payload, userIds) => {
  return sendPush({
    userIds,
    title: "Appointment Confirmed",
    body: `Appointment for ${payload.name || "a lead"} confirmed at ${payload.visitTime || "scheduled time"}.`,
    data: { type: "appointment_confirmed" },
  });
};

export const sendAccountApprovedPush = async (userId) => {
  return sendPush({
    userIds: [userId],
    title: "Account Approved",
    body: "Your Candibly account has been approved. You can now log in.",
    data: { type: "account_approved" },
  });
};
