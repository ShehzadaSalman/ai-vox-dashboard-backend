import express from "express";
import { prisma } from "../lib/database.js";
import { logger } from "../lib/logger.js";
import { enforcePlanLimitForAgent } from "../lib/planLimit.js";

const router = express.Router();

const buildCallerInfo = (call) => {
  if (call?.caller_info) {
    return call.caller_info;
  }
  const callerInfo = {
    from_number: call?.from_number,
    to_number: call?.to_number,
    direction: call?.direction,
  };
  if (Object.values(callerInfo).every((value) => value == null)) {
    return null;
  }
  return JSON.stringify(callerInfo);
};

const buildCallData = (call) => {
  const startTimestamp = call?.start_timestamp;
  const endTimestamp = call?.end_timestamp;
  const durationMs =
    typeof call?.duration_ms === "number"
      ? call.duration_ms
      : startTimestamp && endTimestamp
        ? Math.max(0, endTimestamp - startTimestamp)
        : null;
  const durationSeconds =
    typeof durationMs === "number" ? Math.floor(durationMs / 1000) : null;
  const costCents = Math.round(call?.call_cost?.combined_cost || 0);

  return {
    call_id: call?.call_id,
    agent_id: call?.agent_id,
    caller_info: buildCallerInfo(call),
    start_timestamp:
      typeof startTimestamp === "number" ? BigInt(startTimestamp) : null,
    end_timestamp: typeof endTimestamp === "number" ? BigInt(endTimestamp) : null,
    duration_ms: durationMs,
    duration_seconds: durationSeconds,
    transcript: call?.transcript || null,
    call_status: call?.call_status || "unknown",
    disconnection_reason: call?.disconnection_reason || null,
    cost: costCents,
    call_summary: call?.call_analysis?.call_summary || null,
    user_sentiment: call?.call_analysis?.user_sentiment || null,
    call_successful: call?.call_analysis?.call_successful || false,
    recording_url: call?.recording_url || null,
  };
};

const hasRequiredFields = (callData) => {
  return Boolean(
    callData.call_id &&
      callData.agent_id &&
      callData.start_timestamp &&
      callData.end_timestamp &&
      typeof callData.duration_ms === "number" &&
      typeof callData.duration_seconds === "number" &&
      callData.call_status
  );
};

router.post("/retell", async (req, res) => {
  const { event, call } = req.body || {};

  if (!event || !call) {
    logger.warn("Retell webhook missing event or call", {
      event,
      hasCall: Boolean(call),
    });
    return res.status(400).json({ error: true, message: "Invalid payload" });
  }

  logger.info("Retell webhook received", {
    event,
    callId: call.call_id,
    agentId: call.agent_id,
  });

  if (event === "call_started") {
    return res.status(204).send();
  }

  const callData = buildCallData(call);
  if (!hasRequiredFields(callData)) {
    logger.warn("Retell webhook missing required call fields", {
      event,
      callId: call.call_id,
    });
    return res.status(204).send();
  }

  try {
    await prisma.agent.upsert({
      where: { agent_id: callData.agent_id },
      update: { updated_at: new Date() },
      create: {
        agent_id: callData.agent_id,
        agent_name: `Agent ${callData.agent_id}`,
        status: "ACTIVE",
      },
    });

    await prisma.call.upsert({
      where: { call_id: callData.call_id },
      update: callData,
      create: callData,
    });

    await enforcePlanLimitForAgent(callData.agent_id);
  } catch (error) {
    logger.error("Failed to store Retell call webhook", {
      event,
      callId: call.call_id,
      error: error.message,
    });
  }

  return res.status(204).send();
});

export default router;
