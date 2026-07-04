import { prisma } from "./database.js";
import { logger } from "./logger.js";
import { retellAPI } from "./retell.js";

/**
 * Unbinds every phone number currently routed to this agent (sets
 * inbound_agent_id/outbound_agent_id to null on Retell's side), so Retell
 * actually stops answering calls for it — flipping our own Agent.status flag
 * alone doesn't do that. Records what each number was bound to beforehand
 * (on Agent.paused_phone_numbers) so it can be restored later.
 */
const pausePhoneNumbersForAgent = async (agentId) => {
  const phoneNumbers = await retellAPI.listPhoneNumbers();
  const bound = (phoneNumbers || []).filter(
    (p) => p.inbound_agent_id === agentId || p.outbound_agent_id === agentId
  );

  if (!bound.length) return;

  const pausedRecords = [];
  for (const number of bound) {
    const wasInbound = number.inbound_agent_id === agentId;
    const wasOutbound = number.outbound_agent_id === agentId;
    try {
      await retellAPI.updatePhoneNumber(number.phone_number, {
        ...(wasInbound ? { inbound_agent_id: null } : {}),
        ...(wasOutbound ? { outbound_agent_id: null } : {}),
      });
      pausedRecords.push({
        phone_number: number.phone_number,
        was_inbound: wasInbound,
        was_outbound: wasOutbound,
      });
    } catch (error) {
      logger.error("Failed to pause phone number for agent over plan limit", {
        agentId,
        phoneNumber: number.phone_number,
        error: error.message,
      });
    }
  }

  if (pausedRecords.length) {
    await prisma.agent.update({
      where: { agent_id: agentId },
      data: { paused_phone_numbers: pausedRecords },
    });
  }
};

/**
 * Rebinds any phone numbers previously paused by pausePhoneNumbersForAgent
 * and clears the record. Call this when a user's plan is renewed/upgraded.
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

  for (const record of pausedRecords) {
    try {
      await retellAPI.updatePhoneNumber(record.phone_number, {
        ...(record.was_inbound ? { inbound_agent_id: agentId } : {}),
        ...(record.was_outbound ? { outbound_agent_id: agentId } : {}),
      });
    } catch (error) {
      logger.error("Failed to restore phone number after plan reactivation", {
        agentId,
        phoneNumber: record.phone_number,
        error: error.message,
      });
    }
  }

  await prisma.agent.update({
    where: { agent_id: agentId },
    data: { status: "ACTIVE", paused_phone_numbers: null },
  });
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
