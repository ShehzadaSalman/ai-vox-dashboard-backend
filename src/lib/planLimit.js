import { prisma } from "./database.js";
import { logger } from "./logger.js";
import { retellAPI } from "./retell.js";
import { sendPlanLimitReachedEmail, sendOpsAlertEmail } from "../services/emailService.js";

/**
 * Unbinds every phone number currently routed to this agent by removing it
 * from the number's inbound_agents/outbound_agents weighted-agent arrays (the
 * current Retell schema — it replaced the old singular
 * inbound_agent_id/outbound_agent_id fields), so Retell actually stops
 * answering calls for it — flipping our own Agent.status flag alone doesn't
 * do that. Records the exact entry removed from each array (on
 * Agent.paused_phone_numbers) so it can be restored later.
 */
const pausePhoneNumbersForAgent = async (agentId) => {
  const phoneNumbers = await retellAPI.listPhoneNumbers();

  const pausedRecords = [];
  const failures = [];

  for (const number of phoneNumbers || []) {
    const inboundAgents = Array.isArray(number.inbound_agents) ? number.inbound_agents : [];
    const outboundAgents = Array.isArray(number.outbound_agents) ? number.outbound_agents : [];

    const inboundEntry = inboundAgents.find((a) => a.agent_id === agentId) || null;
    const outboundEntry = outboundAgents.find((a) => a.agent_id === agentId) || null;

    if (!inboundEntry && !outboundEntry) continue;

    try {
      await retellAPI.updatePhoneNumber(number.phone_number, {
        inbound_agents: inboundAgents.filter((a) => a.agent_id !== agentId),
        outbound_agents: outboundAgents.filter((a) => a.agent_id !== agentId),
      });
      pausedRecords.push({
        phone_number: number.phone_number,
        inbound_entry: inboundEntry,
        outbound_entry: outboundEntry,
      });
    } catch (error) {
      logger.error("Failed to pause phone number for agent over plan limit", {
        agentId,
        phoneNumber: number.phone_number,
        error: error.message,
      });
      failures.push({ phoneNumber: number.phone_number, error: error.message });
    }
  }

  if (pausedRecords.length) {
    await prisma.agent.update({
      where: { agent_id: agentId },
      data: { paused_phone_numbers: pausedRecords },
    });
  }

  if (failures.length) {
    await sendOpsAlertEmail("Failed to fully pause agent over plan limit", {
      agentId,
      failedPhoneNumbers: failures.map((f) => f.phoneNumber).join(", "),
      errors: failures.map((f) => f.error).join(" | "),
    }).catch(() => {});
  }
};

/**
 * Rebinds any phone numbers previously paused by pausePhoneNumbersForAgent
 * and clears the record. Re-fetches each number's current state first so it
 * only adds our agent back in, without clobbering any other agent bindings
 * made while paused. Call this when a user's plan is renewed/upgraded.
 */
export const reactivateAgent = async (agentId) => {
  const agent = await prisma.agent.findUnique({
    where: { agent_id: agentId },
    select: { paused_phone_numbers: true, status: true },
  });

  if (!agent) return;

  const pausedRecords = Array.isArray(agent.paused_phone_numbers)
    ? agent.paused_phone_numbers
    : [];

  const failures = [];
  for (const record of pausedRecords) {
    try {
      const current = await retellAPI.getPhoneNumber(record.phone_number);
      const inboundAgents = Array.isArray(current.inbound_agents) ? current.inbound_agents : [];
      const outboundAgents = Array.isArray(current.outbound_agents) ? current.outbound_agents : [];

      const nextInbound = record.inbound_entry
        ? [...inboundAgents.filter((a) => a.agent_id !== agentId), record.inbound_entry]
        : inboundAgents;
      const nextOutbound = record.outbound_entry
        ? [...outboundAgents.filter((a) => a.agent_id !== agentId), record.outbound_entry]
        : outboundAgents;

      await retellAPI.updatePhoneNumber(record.phone_number, {
        inbound_agents: nextInbound,
        outbound_agents: nextOutbound,
      });
    } catch (error) {
      logger.error("Failed to restore phone number after plan reactivation", {
        agentId,
        phoneNumber: record.phone_number,
        error: error.message,
      });
      failures.push({ phoneNumber: record.phone_number, error: error.message });
    }
  }

  await prisma.agent.update({
    where: { agent_id: agentId },
    data: { status: "ACTIVE", paused_phone_numbers: null },
  });

  if (failures.length) {
    await sendOpsAlertEmail("Failed to fully restore agent phone numbers on reactivation", {
      agentId,
      failedPhoneNumbers: failures.map((f) => f.phoneNumber).join(", "),
      errors: failures.map((f) => f.error).join(" | "),
    }).catch(() => {});
  }
};

/**
 * Checks the plan usage of every user assigned to an agent and, once any of
 * them has used up their plan's monthly minutes for the current billing
 * period, deactivates the agent locally AND unbinds its phone number(s) on
 * Retell so it actually stops taking calls.
 */
export const enforcePlanLimitForAgent = async (agentId) => {
  if (!agentId) return;

  try {
    const assignments = await prisma.userAgent.findMany({
      where: { agent_id: agentId },
      select: { user_id: true },
    });

    if (!assignments.length) return;

    const now = new Date();

    for (const { user_id: userId } of assignments) {
      const subscription = await prisma.subscription.findFirst({
        where: {
          user_id: userId,
          status: { in: ["active", "ACTIVE"] },
          current_period_start: { lte: now },
          current_period_end: { gte: now },
        },
        include: { plan: true },
        orderBy: { current_period_end: "desc" },
      });

      if (!subscription?.plan?.monthly_minutes_limit) continue;

      const assignedAgents = await prisma.userAgent.findMany({
        where: { user_id: userId },
        select: { agent_id: true },
      });
      const assignedAgentIds = assignedAgents.map((a) => a.agent_id);

      const usageAggregate = await prisma.call.aggregate({
        where: {
          agent_id: { in: assignedAgentIds },
          created_at: {
            gte: subscription.current_period_start,
            lte: subscription.current_period_end,
          },
        },
        _sum: { duration_seconds: true },
      });

      const usedMinutes = (usageAggregate._sum.duration_seconds || 0) / 60;

      if (usedMinutes >= subscription.plan.monthly_minutes_limit) {
        const result = await prisma.agent.updateMany({
          where: { agent_id: agentId, status: "ACTIVE" },
          data: { status: "INACTIVE" },
        });
        if (result.count > 0) {
          logger.warn("Agent deactivated after exceeding plan limit", {
            agentId,
            userId,
            usedMinutes,
            limitMinutes: subscription.plan.monthly_minutes_limit,
            planCode: subscription.plan.code,
          });
          await pausePhoneNumbersForAgent(agentId);

          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { email: true },
          });
          if (user?.email) {
            await sendPlanLimitReachedEmail(user.email, {
              planName: subscription.plan.name,
              limitMinutes: subscription.plan.monthly_minutes_limit,
            }).catch(() => {});
          }

          await sendOpsAlertEmail("Agent auto-paused after exceeding plan limit", {
            agentId,
            userId,
            planCode: subscription.plan.code,
            usedMinutes: usedMinutes.toFixed(1),
            limitMinutes: subscription.plan.monthly_minutes_limit,
          }).catch(() => {});
        }
        return;
      }
    }
  } catch (error) {
    logger.error("Failed to enforce plan limit", {
      agentId,
      error: error.message,
    });
  }
};
