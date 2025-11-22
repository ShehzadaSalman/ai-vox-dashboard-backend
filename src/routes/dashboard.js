import express from "express";
import Joi from "joi";
import { prisma } from "../lib/database.js";
import { retellAPI } from "../lib/retell.js";
import { logger } from "../lib/logger.js";
import {
  asyncHandler,
  ValidationError,
  NotFoundError,
} from "../middleware/errorHandler.js";
import { adminMiddleware } from "../middleware/auth.js";

const router = express.Router();

// Validation schemas
const syncCallsSchema = Joi.object({
  days: Joi.number().integer().min(1).max(90).default(30),
  agentId: Joi.string().optional(),
});

const callHistorySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(20),
  offset: Joi.number().integer().min(0).default(0),
  sortBy: Joi.string().valid("date", "duration", "cost").default("date"),
});

// Additional validation schemas
const agentListSchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(20),
  offset: Joi.number().integer().min(0).default(0),
  status: Joi.string().valid("ACTIVE", "INACTIVE").optional(),
  search: Joi.string().max(200).optional(),
});

const createAgentSchema = Joi.object({
  agent_id: Joi.string().required(),
  agent_name: Joi.string().max(200).required(),
  status: Joi.string().valid("ACTIVE", "INACTIVE").default("ACTIVE"),
});

const updateAgentSchema = Joi.object({
  agent_name: Joi.string().max(200).optional(),
  status: Joi.string().valid("ACTIVE", "INACTIVE").optional(),
});

const callsListSchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(20),
  offset: Joi.number().integer().min(0).default(0),
  agentId: Joi.string().optional(),
  startDate: Joi.date().optional(),
  endDate: Joi.date().optional(),
  callStatus: Joi.string().optional(),
  sortBy: Joi.string().valid("date", "duration", "cost").default("date"),
});

const analyticsDateRangeSchema = Joi.object({
  startDate: Joi.date().optional(),
  endDate: Joi.date().optional(),
  agentId: Joi.string().optional(),
});

const userListSchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(20),
  offset: Joi.number().integer().min(0).default(0),
  role: Joi.string().valid("USER", "ADMIN").optional(),
  search: Joi.string().max(200).optional(),
});

const updateUserSchema = Joi.object({
  name: Joi.string().max(120).optional(),
  role: Joi.string().valid("USER", "ADMIN").optional(),
});

const searchCallsSchema = Joi.object({
  query: Joi.string().min(1).max(500).required(),
  limit: Joi.number().integer().min(1).max(100).default(20),
  offset: Joi.number().integer().min(0).default(0),
  agentId: Joi.string().optional(),
});

const searchAgentsSchema = Joi.object({
  query: Joi.string().min(1).max(200).required(),
  limit: Joi.number().integer().min(1).max(100).default(20),
  offset: Joi.number().integer().min(0).default(0),
});

/**
 * POST /api/dashboard/sync-calls
 * Syncs call data from Retell API to database
 */
router.post(
  "/sync-calls",
  asyncHandler(async (req, res) => {
    const { error, value } = syncCallsSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const { days = 30, agentId } = value;

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    logger.info("Starting call sync", {
      days,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      agentId,
    });

    try {
      // Fetch agents from Retell API first to get proper agent names
      logger.info("Fetching agents from Retell API...");
      const agentMap = new Map();

      try {
        const agents = await retellAPI.getAgents();

        if (agents && agents.length > 0) {
          agents.forEach((agent) => {
            agentMap.set(agent.agent_id, {
              agent_name: agent.agent_name || `Agent ${agent.agent_id}`,
              is_published: agent.is_published || false,
              last_modification_timestamp: agent.last_modification_timestamp,
            });
          });
          logger.info("Fetched agents", { agentCount: agents.length });
        } else {
          logger.warn("No agents found in Retell API");
        }
      } catch (agentError) {
        logger.warn(
          "Failed to fetch agents from Retell API, will use default names",
          {
            error: agentError.message,
          }
        );
      }

      // Fetch calls from Retell API
      const calls = await retellAPI.getAllCallsInRange(startDate, endDate);

      if (!calls || calls.length === 0) {
        return res.json({
          success: true,
          message: "No calls found in the specified date range",
          callsSynced: 0,
          dateRange: {
            start: startDate.toISOString(),
            end: endDate.toISOString(),
          },
        });
      }

      // Filter by agentId if provided
      const filteredCalls = agentId
        ? calls.filter((call) => call.agent_id === agentId)
        : calls;

      let syncedCount = 0;
      let updatedCount = 0;
      let errorCount = 0;

      // First, ensure all agents exist before processing calls
      const uniqueAgentIds = [
        ...new Set(filteredCalls.map((call) => call.agent_id)),
      ];
      logger.info("Creating/updating agents", {
        agentCount: uniqueAgentIds.length,
      });

      for (const agentId of uniqueAgentIds) {
        try {
          const agentInfo = agentMap.get(agentId);
          const agentName = agentInfo
            ? agentInfo.agent_name
            : `Agent ${agentId}`;

          await prisma.agent.upsert({
            where: { agent_id: agentId },
            update: {
              agent_name: agentName,
              updated_at: new Date(),
            },
            create: {
              agent_id: agentId,
              agent_name: agentName,
              status: "ACTIVE",
            },
          });
        } catch (agentError) {
          logger.error("Error creating/updating agent", {
            agentId,
            error: agentError.message,
          });
        }
      }

      // Now process each call
      for (const call of filteredCalls) {
        try {
          // Calculate duration in seconds
          const durationSeconds = Math.floor(call.duration_ms / 1000);

          // Prepare call data - mapping from Retell API response structure
          const callData = {
            call_id: call.call_id,
            agent_id: call.agent_id,
            caller_info: call.caller_info || null,
            start_timestamp: BigInt(call.start_timestamp),
            end_timestamp: BigInt(call.end_timestamp),
            duration_ms: call.duration_ms,
            duration_seconds: durationSeconds,
            transcript: call.transcript || null,
            call_status: call.call_status,
            disconnection_reason: call.disconnection_reason || null,
            cost: call.call_cost?.combined_cost || 0,
            call_summary: call.call_analysis?.call_summary || null,
            user_sentiment: call.call_analysis?.user_sentiment || null,
            call_successful: call.call_analysis?.call_successful || false,
            recording_url: call.recording_url || null,
          };

          // Upsert call (update if exists, create if not)
          const result = await prisma.call.upsert({
            where: { call_id: call.call_id },
            update: callData,
            create: callData,
          });

          if (result.created_at.getTime() === result.updated_at.getTime()) {
            syncedCount++;
          } else {
            updatedCount++;
          }
        } catch (callError) {
          logger.error("Error processing call", {
            callId: call.call_id,
            error: callError.message,
          });
          errorCount++;
        }
      }

      logger.info("Call sync completed", {
        totalCalls: filteredCalls.length,
        syncedCount,
        updatedCount,
        errorCount,
      });

      res.json({
        success: true,
        message: "Call sync completed",
        callsSynced: syncedCount,
        callsUpdated: updatedCount,
        errors: errorCount,
        dateRange: {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        },
      });
    } catch (error) {
      logger.error("Call sync failed", {
        error: error.message,
        days,
        agentId,
      });
      throw error;
    }
  })
);

/**
 * GET /api/dashboard/agent-info/:agentId
 * Returns basic agent information
 */
router.get(
  "/agent-info/:agentId",
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;

    if (!agentId) {
      throw new ValidationError("Agent ID is required");
    }

    const agent = await prisma.agent.findUnique({
      where: { agent_id: agentId },
      select: {
        id: true,
        agent_id: true,
        agent_name: true,
        status: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!agent) {
      throw new NotFoundError(`Agent with ID ${agentId} not found`);
    }

    res.json({
      success: true,
      data: agent,
    });
  })
);

/**
 * GET /api/dashboard/call-history/:agentId
 * Returns paginated call history for an agent
 */
router.get(
  "/call-history/:agentId",
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const { error, value } = callHistorySchema.validate(req.query);

    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    if (!agentId) {
      throw new ValidationError("Agent ID is required");
    }

    const { limit, offset, sortBy } = value;

    // Verify agent exists
    const agent = await prisma.agent.findUnique({
      where: { agent_id: agentId },
      select: { agent_id: true },
    });

    if (!agent) {
      throw new NotFoundError(`Agent with ID ${agentId} not found`);
    }

    // Build orderBy clause
    let orderBy = {};
    switch (sortBy) {
      case "duration":
        orderBy = { duration_seconds: "desc" };
        break;
      case "cost":
        orderBy = { cost: "desc" };
        break;
      case "date":
      default:
        orderBy = { start_timestamp: "desc" };
        break;
    }

    // Get calls with pagination
    const [calls, totalCount] = await Promise.all([
      prisma.call.findMany({
        where: { agent_id: agentId },
        orderBy,
        skip: offset,
        take: limit,
        select: {
          id: true,
          call_id: true,
          caller_info: true,
          start_timestamp: true,
          end_timestamp: true,
          duration_ms: true,
          duration_seconds: true,
          transcript: true,
          call_status: true,
          disconnection_reason: true,
          cost: true,
          call_summary: true,
          user_sentiment: true,
          call_successful: true,
          recording_url: true,
          created_at: true,
          updated_at: true,
        },
      }),
      prisma.call.count({
        where: { agent_id: agentId },
      }),
    ]);

    // Convert BigInt timestamps to numbers for JSON serialization
    const formattedCalls = calls.map((call) => ({
      ...call,
      start_timestamp: Number(call.start_timestamp),
      end_timestamp: Number(call.end_timestamp),
    }));

    res.json({
      success: true,
      data: {
        calls: formattedCalls,
        pagination: {
          total: totalCount,
          limit,
          offset,
          hasMore: offset + limit < totalCount,
        },
      },
    });
  })
);

// ============================================
// AGENT MANAGEMENT APIs
// ============================================

/**
 * GET /api/dashboard/agents
 * List all agents with pagination and filtering
 */
router.get(
  "/agents",
  asyncHandler(async (req, res) => {
    const { error, value } = agentListSchema.validate(req.query);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const { limit, offset, status, search } = value;

    // Build where clause
    const where = {};
    if (status) {
      where.status = status;
    }
    if (search) {
      where.OR = [
        { agent_name: { contains: search, mode: "insensitive" } },
        { agent_id: { contains: search, mode: "insensitive" } },
      ];
    }

    const [agents, totalCount] = await Promise.all([
      prisma.agent.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: offset,
        take: limit,
        select: {
          id: true,
          agent_id: true,
          agent_name: true,
          status: true,
          created_at: true,
          updated_at: true,
          _count: {
            select: { calls: true },
          },
        },
      }),
      prisma.agent.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        agents,
        pagination: {
          total: totalCount,
          limit,
          offset,
          hasMore: offset + limit < totalCount,
        },
      },
    });
  })
);

/**
 * POST /api/dashboard/agents
 * Create a new agent
 */
router.post(
  "/agents",
  asyncHandler(async (req, res) => {
    const { error, value } = createAgentSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const { agent_id, agent_name, status } = value;

    // Check if agent already exists
    const existing = await prisma.agent.findUnique({
      where: { agent_id },
    });

    if (existing) {
      throw new ValidationError("Agent with this ID already exists");
    }

    const agent = await prisma.agent.create({
      data: {
        agent_id,
        agent_name,
        status: status || "ACTIVE",
      },
      select: {
        id: true,
        agent_id: true,
        agent_name: true,
        status: true,
        created_at: true,
        updated_at: true,
      },
    });

    res.status(201).json({
      success: true,
      data: agent,
    });
  })
);

/**
 * PUT /api/dashboard/agents/:agentId
 * Update agent details
 */
router.put(
  "/agents/:agentId",
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const { error, value } = updateAgentSchema.validate(req.body);

    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    if (!agentId) {
      throw new ValidationError("Agent ID is required");
    }

    // Check if agent exists
    const existing = await prisma.agent.findUnique({
      where: { agent_id: agentId },
    });

    if (!existing) {
      throw new NotFoundError(`Agent with ID ${agentId} not found`);
    }

    const agent = await prisma.agent.update({
      where: { agent_id: agentId },
      data: value,
      select: {
        id: true,
        agent_id: true,
        agent_name: true,
        status: true,
        created_at: true,
        updated_at: true,
      },
    });

    res.json({
      success: true,
      data: agent,
    });
  })
);

/**
 * DELETE /api/dashboard/agents/:agentId
 * Delete an agent (soft delete by setting status to INACTIVE)
 */
router.delete(
  "/agents/:agentId",
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;

    if (!agentId) {
      throw new ValidationError("Agent ID is required");
    }

    const existing = await prisma.agent.findUnique({
      where: { agent_id: agentId },
    });

    if (!existing) {
      throw new NotFoundError(`Agent with ID ${agentId} not found`);
    }

    // Soft delete by setting status to INACTIVE
    const agent = await prisma.agent.update({
      where: { agent_id: agentId },
      data: { status: "INACTIVE" },
      select: {
        id: true,
        agent_id: true,
        agent_name: true,
        status: true,
        created_at: true,
        updated_at: true,
      },
    });

    res.json({
      success: true,
      message: "Agent deactivated successfully",
      data: agent,
    });
  })
);

/**
 * POST /api/dashboard/sync-agents
 * Sync agents from Retell API to database
 */
router.post(
  "/sync-agents",
  asyncHandler(async (req, res) => {
    logger.info("Starting agent sync from Retell API");

    try {
      const agents = await retellAPI.getAgents();

      if (!agents || agents.length === 0) {
        return res.json({
          success: true,
          message: "No agents found in Retell API",
          agentsSynced: 0,
        });
      }

      let syncedCount = 0;
      let updatedCount = 0;
      let errorCount = 0;

      for (const agent of agents) {
        try {
          const agentName = agent.agent_name || `Agent ${agent.agent_id}`;
          const result = await prisma.agent.upsert({
            where: { agent_id: agent.agent_id },
            update: {
              agent_name: agentName,
              status: agent.is_published ? "ACTIVE" : "INACTIVE",
              updated_at: new Date(),
            },
            create: {
              agent_id: agent.agent_id,
              agent_name: agentName,
              status: agent.is_published ? "ACTIVE" : "INACTIVE",
            },
          });

          if (result.created_at.getTime() === result.updated_at.getTime()) {
            syncedCount++;
          } else {
            updatedCount++;
          }
        } catch (agentError) {
          logger.error("Error syncing agent", {
            agentId: agent.agent_id,
            error: agentError.message,
          });
          errorCount++;
        }
      }

      logger.info("Agent sync completed", {
        totalAgents: agents.length,
        syncedCount,
        updatedCount,
        errorCount,
      });

      res.json({
        success: true,
        message: "Agent sync completed",
        agentsSynced: syncedCount,
        agentsUpdated: updatedCount,
        errors: errorCount,
      });
    } catch (error) {
      logger.error("Agent sync failed", {
        error: error.message,
      });
      throw error;
    }
  })
);

// ============================================
// CALL MANAGEMENT APIs
// ============================================

/**
 * GET /api/dashboard/calls
 * List all calls with filters and pagination
 */
router.get(
  "/calls",
  asyncHandler(async (req, res) => {
    const { error, value } = callsListSchema.validate(req.query);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const { limit, offset, agentId, startDate, endDate, callStatus, sortBy } =
      value;

    // Build where clause
    const where = {};
    if (agentId) {
      where.agent_id = agentId;
    }
    if (callStatus) {
      where.call_status = callStatus;
    }
    if (startDate || endDate) {
      where.start_timestamp = {};
      if (startDate) {
        where.start_timestamp.gte = BigInt(
          Math.floor(new Date(startDate).getTime())
        );
      }
      if (endDate) {
        where.start_timestamp.lte = BigInt(
          Math.floor(new Date(endDate).getTime())
        );
      }
    }

    // Build orderBy clause
    let orderBy = {};
    switch (sortBy) {
      case "duration":
        orderBy = { duration_seconds: "desc" };
        break;
      case "cost":
        orderBy = { cost: "desc" };
        break;
      case "date":
      default:
        orderBy = { start_timestamp: "desc" };
        break;
    }

    const [calls, totalCount] = await Promise.all([
      prisma.call.findMany({
        where,
        orderBy,
        skip: offset,
        take: limit,
        select: {
          id: true,
          call_id: true,
          agent_id: true,
          caller_info: true,
          start_timestamp: true,
          end_timestamp: true,
          duration_ms: true,
          duration_seconds: true,
          transcript: true,
          call_status: true,
          disconnection_reason: true,
          cost: true,
          call_summary: true,
          user_sentiment: true,
          call_successful: true,
          recording_url: true,
          created_at: true,
          updated_at: true,
          agent: {
            select: {
              agent_id: true,
              agent_name: true,
            },
          },
        },
      }),
      prisma.call.count({ where }),
    ]);

    // Convert BigInt timestamps to numbers
    const formattedCalls = calls.map((call) => ({
      ...call,
      start_timestamp: Number(call.start_timestamp),
      end_timestamp: Number(call.end_timestamp),
    }));

    res.json({
      success: true,
      data: {
        calls: formattedCalls,
        pagination: {
          total: totalCount,
          limit,
          offset,
          hasMore: offset + limit < totalCount,
        },
      },
    });
  })
);

/**
 * GET /api/dashboard/calls/:callId
 * Get detailed call information by call ID
 */
router.get(
  "/calls/:callId",
  asyncHandler(async (req, res) => {
    const { callId } = req.params;

    if (!callId) {
      throw new ValidationError("Call ID is required");
    }

    const call = await prisma.call.findUnique({
      where: { call_id: callId },
      select: {
        id: true,
        call_id: true,
        agent_id: true,
        caller_info: true,
        start_timestamp: true,
        end_timestamp: true,
        duration_ms: true,
        duration_seconds: true,
        transcript: true,
        call_status: true,
        disconnection_reason: true,
        cost: true,
        call_summary: true,
        user_sentiment: true,
        call_successful: true,
        recording_url: true,
        created_at: true,
        updated_at: true,
        agent: {
          select: {
            agent_id: true,
            agent_name: true,
            status: true,
          },
        },
      },
    });

    if (!call) {
      throw new NotFoundError(`Call with ID ${callId} not found`);
    }

    // Convert BigInt timestamps to numbers
    const formattedCall = {
      ...call,
      start_timestamp: Number(call.start_timestamp),
      end_timestamp: Number(call.end_timestamp),
    };

    res.json({
      success: true,
      data: formattedCall,
    });
  })
);

/**
 * GET /api/dashboard/call-history
 * Get call history across all agents (without agent filter)
 */
router.get(
  "/call-history",
  asyncHandler(async (req, res) => {
    const { error, value } = callHistorySchema.validate(req.query);

    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const { limit, offset, sortBy } = value;

    // Build orderBy clause
    let orderBy = {};
    switch (sortBy) {
      case "duration":
        orderBy = { duration_seconds: "desc" };
        break;
      case "cost":
        orderBy = { cost: "desc" };
        break;
      case "date":
      default:
        orderBy = { start_timestamp: "desc" };
        break;
    }

    // Get calls with pagination
    const [calls, totalCount] = await Promise.all([
      prisma.call.findMany({
        orderBy,
        skip: offset,
        take: limit,
        select: {
          id: true,
          call_id: true,
          agent_id: true,
          caller_info: true,
          start_timestamp: true,
          end_timestamp: true,
          duration_ms: true,
          duration_seconds: true,
          transcript: true,
          call_status: true,
          disconnection_reason: true,
          cost: true,
          call_summary: true,
          user_sentiment: true,
          call_successful: true,
          recording_url: true,
          created_at: true,
          updated_at: true,
          agent: {
            select: {
              agent_id: true,
              agent_name: true,
            },
          },
        },
      }),
      prisma.call.count(),
    ]);

    // Convert BigInt timestamps to numbers for JSON serialization
    const formattedCalls = calls.map((call) => ({
      ...call,
      start_timestamp: Number(call.start_timestamp),
      end_timestamp: Number(call.end_timestamp),
    }));

    res.json({
      success: true,
      data: {
        calls: formattedCalls,
        pagination: {
          total: totalCount,
          limit,
          offset,
          hasMore: offset + limit < totalCount,
        },
      },
    });
  })
);

// ============================================
// ANALYTICS/REPORTING APIs
// ============================================

/**
 * GET /api/dashboard/analytics/overview
 * Get dashboard overview statistics
 */
router.get(
  "/analytics/overview",
  asyncHandler(async (req, res) => {
    const { error, value } = analyticsDateRangeSchema.validate(req.query);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const { startDate, endDate, agentId } = value;

    // Build where clause
    const where = {};
    if (agentId) {
      where.agent_id = agentId;
    }
    if (startDate || endDate) {
      where.start_timestamp = {};
      if (startDate) {
        where.start_timestamp.gte = BigInt(
          Math.floor(new Date(startDate).getTime())
        );
      }
      if (endDate) {
        where.start_timestamp.lte = BigInt(
          Math.floor(new Date(endDate).getTime())
        );
      }
    }

    const [
      totalCalls,
      totalCost,
      successfulCalls,
      totalAgents,
      totalDuration,
      callsByStatus,
    ] = await Promise.all([
      prisma.call.count({ where }),
      prisma.call.aggregate({
        where,
        _sum: { cost: true },
      }),
      prisma.call.count({
        where: { ...where, call_successful: true },
      }),
      agentId
        ? Promise.resolve(1)
        : prisma.agent.count({ where: { status: "ACTIVE" } }),
      prisma.call.aggregate({
        where,
        _sum: { duration_seconds: true },
      }),
      prisma.call.groupBy({
        by: ["call_status"],
        where,
        _count: true,
      }),
    ]);

    const avgDuration =
      totalCalls > 0
        ? Math.round((totalDuration._sum.duration_seconds || 0) / totalCalls)
        : 0;
    const successRate =
      totalCalls > 0 ? (successfulCalls / totalCalls) * 100 : 0;
    const avgCost = totalCalls > 0 ? (totalCost._sum.cost || 0) / totalCalls : 0;

    res.json({
      success: true,
      data: {
        totalCalls,
        totalCost: totalCost._sum.cost || 0,
        avgCost: Math.round(avgCost * 100) / 100,
        successfulCalls,
        successRate: Math.round(successRate * 100) / 100,
        totalAgents,
        totalDurationSeconds: totalDuration._sum.duration_seconds || 0,
        avgDurationSeconds: avgDuration,
        callsByStatus: callsByStatus.reduce((acc, item) => {
          acc[item.call_status] = item._count;
          return acc;
        }, {}),
      },
    });
  })
);

/**
 * GET /api/dashboard/analytics/agents
 * Get agent performance metrics
 */
router.get(
  "/analytics/agents",
  asyncHandler(async (req, res) => {
    const { error, value } = analyticsDateRangeSchema.validate(req.query);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const { startDate, endDate } = value;

    // Build where clause for calls
    const callWhere = {};
    if (startDate || endDate) {
      callWhere.start_timestamp = {};
      if (startDate) {
        callWhere.start_timestamp.gte = BigInt(
          Math.floor(new Date(startDate).getTime())
        );
      }
      if (endDate) {
        callWhere.start_timestamp.lte = BigInt(
          Math.floor(new Date(endDate).getTime())
        );
      }
    }

    // Get all active agents
    const agents = await prisma.agent.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        agent_id: true,
        agent_name: true,
      },
    });

    // Get metrics for each agent
    const agentMetrics = await Promise.all(
      agents.map(async (agent) => {
        const agentCallWhere = { ...callWhere, agent_id: agent.agent_id };

        const [
          totalCalls,
          successfulCalls,
          totalCost,
          totalDuration,
        ] = await Promise.all([
          prisma.call.count({ where: agentCallWhere }),
          prisma.call.count({
            where: { ...agentCallWhere, call_successful: true },
          }),
          prisma.call.aggregate({
            where: agentCallWhere,
            _sum: { cost: true },
          }),
          prisma.call.aggregate({
            where: agentCallWhere,
            _sum: { duration_seconds: true },
          }),
        ]);

        const successRate =
          totalCalls > 0 ? (successfulCalls / totalCalls) * 100 : 0;
        const avgCost =
          totalCalls > 0 ? (totalCost._sum.cost || 0) / totalCalls : 0;
        const avgDuration =
          totalCalls > 0
            ? Math.round((totalDuration._sum.duration_seconds || 0) / totalCalls)
            : 0;

        return {
          agent_id: agent.agent_id,
          agent_name: agent.agent_name,
          totalCalls,
          successfulCalls,
          successRate: Math.round(successRate * 100) / 100,
          totalCost: totalCost._sum.cost || 0,
          avgCost: Math.round(avgCost * 100) / 100,
          totalDurationSeconds: totalDuration._sum.duration_seconds || 0,
          avgDurationSeconds: avgDuration,
        };
      })
    );

    res.json({
      success: true,
      data: agentMetrics,
    });
  })
);

/**
 * GET /api/dashboard/analytics/calls
 * Get call analytics and trends
 */
router.get(
  "/analytics/calls",
  asyncHandler(async (req, res) => {
    const { error, value } = analyticsDateRangeSchema.validate(req.query);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const { startDate, endDate, agentId } = value;

    // Default to last 30 days if no date range provided
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate
      ? new Date(startDate)
      : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Build where clause
    const where = {};
    if (agentId) {
      where.agent_id = agentId;
    }
    where.start_timestamp = {
      gte: BigInt(Math.floor(start.getTime())),
      lte: BigInt(Math.floor(end.getTime())),
    };

    // Get daily call statistics
    const calls = await prisma.call.findMany({
      where,
      select: {
        start_timestamp: true,
        cost: true,
        duration_seconds: true,
        call_successful: true,
        call_status: true,
      },
    });

    // Group by date
    const dailyStats = {};
    calls.forEach((call) => {
      const date = new Date(Number(call.start_timestamp));
      const dateKey = date.toISOString().split("T")[0];

      if (!dailyStats[dateKey]) {
        dailyStats[dateKey] = {
          date: dateKey,
          totalCalls: 0,
          successfulCalls: 0,
          totalCost: 0,
          totalDuration: 0,
        };
      }

      dailyStats[dateKey].totalCalls++;
      if (call.call_successful) {
        dailyStats[dateKey].successfulCalls++;
      }
      dailyStats[dateKey].totalCost += call.cost;
      dailyStats[dateKey].totalDuration += call.duration_seconds;
    });

    // Convert to array and sort by date
    const dailyStatsArray = Object.values(dailyStats).sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    );

    // Calculate trends
    const totalCalls = calls.length;
    const totalCost = calls.reduce((sum, call) => sum + call.cost, 0);
    const totalDuration = calls.reduce(
      (sum, call) => sum + call.duration_seconds,
      0
    );
    const successfulCalls = calls.filter((call) => call.call_successful).length;

    res.json({
      success: true,
      data: {
        dateRange: {
          start: start.toISOString(),
          end: end.toISOString(),
        },
        summary: {
          totalCalls,
          successfulCalls,
          successRate:
            totalCalls > 0 ? Math.round((successfulCalls / totalCalls) * 100) : 0,
          totalCost: Math.round(totalCost * 100) / 100,
          avgCost: Math.round((totalCost / totalCalls) * 100) / 100,
          totalDurationSeconds: totalDuration,
          avgDurationSeconds:
            totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0,
        },
        dailyStats: dailyStatsArray,
      },
    });
  })
);

/**
 * GET /api/dashboard/analytics/sentiment
 * Get sentiment analysis summary
 */
router.get(
  "/analytics/sentiment",
  asyncHandler(async (req, res) => {
    const { error, value } = analyticsDateRangeSchema.validate(req.query);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const { startDate, endDate, agentId } = value;

    // Build where clause
    const where = {};
    if (agentId) {
      where.agent_id = agentId;
    }
    if (startDate || endDate) {
      where.start_timestamp = {};
      if (startDate) {
        where.start_timestamp.gte = BigInt(
          Math.floor(new Date(startDate).getTime())
        );
      }
      if (endDate) {
        where.start_timestamp.lte = BigInt(
          Math.floor(new Date(endDate).getTime())
        );
      }
    }
    where.user_sentiment = { not: null };

    // Get sentiment distribution
    const sentimentStats = await prisma.call.groupBy({
      by: ["user_sentiment"],
      where,
      _count: true,
    });

    const totalWithSentiment = sentimentStats.reduce(
      (sum, stat) => sum + stat._count,
      0
    );

    const sentimentDistribution = sentimentStats.reduce((acc, stat) => {
      acc[stat.user_sentiment] = {
        count: stat._count,
        percentage:
          totalWithSentiment > 0
            ? Math.round((stat._count / totalWithSentiment) * 100)
            : 0,
      };
      return acc;
    }, {});

    res.json({
      success: true,
      data: {
        totalCallsWithSentiment: totalWithSentiment,
        sentimentDistribution,
      },
    });
  })
);

// ============================================
// USER MANAGEMENT APIs (Admin Only)
// ============================================

/**
 * GET /api/dashboard/users
 * List all users (admin only)
 */
router.get(
  "/users",
  adminMiddleware,
  asyncHandler(async (req, res) => {
    const { error, value } = userListSchema.validate(req.query);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const { limit, offset, role, search } = value;

    // Build where clause
    const where = {};
    if (role) {
      where.role = role;
    }
    if (search) {
      where.OR = [
        { email: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
      ];
    }

    const [users, totalCount] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: offset,
        take: limit,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          created_at: true,
          updated_at: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          total: totalCount,
          limit,
          offset,
          hasMore: offset + limit < totalCount,
        },
      },
    });
  })
);

/**
 * GET /api/dashboard/users/:userId
 * Get user details (admin only)
 */
router.get(
  "/users/:userId",
  adminMiddleware,
  asyncHandler(async (req, res) => {
    const { userId } = req.params;

    if (!userId) {
      throw new ValidationError("User ID is required");
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!user) {
      throw new NotFoundError(`User with ID ${userId} not found`);
    }

    res.json({
      success: true,
      data: user,
    });
  })
);

/**
 * PUT /api/dashboard/users/:userId
 * Update user (admin only)
 */
router.put(
  "/users/:userId",
  adminMiddleware,
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { error, value } = updateUserSchema.validate(req.body);

    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    if (!userId) {
      throw new ValidationError("User ID is required");
    }

    // Prevent admin from removing their own admin role
    if (req.user.id === userId && value.role && value.role !== "ADMIN") {
      throw new ValidationError("Cannot remove your own admin role");
    }

    const existing = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existing) {
      throw new NotFoundError(`User with ID ${userId} not found`);
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: value,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        created_at: true,
        updated_at: true,
      },
    });

    res.json({
      success: true,
      data: user,
    });
  })
);

/**
 * DELETE /api/dashboard/users/:userId
 * Delete user (admin only)
 */
router.delete(
  "/users/:userId",
  adminMiddleware,
  asyncHandler(async (req, res) => {
    const { userId } = req.params;

    if (!userId) {
      throw new ValidationError("User ID is required");
    }

    // Prevent admin from deleting themselves
    if (req.user.id === userId) {
      throw new ValidationError("Cannot delete your own account");
    }

    const existing = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existing) {
      throw new NotFoundError(`User with ID ${userId} not found`);
    }

    await prisma.user.delete({
      where: { id: userId },
    });

    res.json({
      success: true,
      message: "User deleted successfully",
    });
  })
);

// ============================================
// UTILITY/STATUS APIs
// ============================================

/**
 * GET /api/dashboard/stats
 * Get quick statistics
 */
router.get(
  "/stats",
  asyncHandler(async (req, res) => {
    const [totalAgents, activeAgents, totalCalls, totalCost] = await Promise.all(
      [
        prisma.agent.count(),
        prisma.agent.count({ where: { status: "ACTIVE" } }),
        prisma.call.count(),
        prisma.call.aggregate({
          _sum: { cost: true },
        }),
      ]
    );

    res.json({
      success: true,
      data: {
        agents: {
          total: totalAgents,
          active: activeAgents,
          inactive: totalAgents - activeAgents,
        },
        calls: {
          total: totalCalls,
        },
        cost: {
          total: totalCost._sum.cost || 0,
        },
      },
    });
  })
);

/**
 * GET /api/dashboard/sync-status
 * Get sync status (placeholder - can be enhanced with job tracking)
 */
router.get(
  "/sync-status",
  asyncHandler(async (req, res) => {
    // Get last sync information from database
    const [lastCallSync, lastAgentSync] = await Promise.all([
      prisma.call.findFirst({
        orderBy: { updated_at: "desc" },
        select: { updated_at: true },
      }),
      prisma.agent.findFirst({
        orderBy: { updated_at: "desc" },
        select: { updated_at: true },
      }),
    ]);

    res.json({
      success: true,
      data: {
        calls: {
          lastSynced: lastCallSync?.updated_at || null,
        },
        agents: {
          lastSynced: lastAgentSync?.updated_at || null,
        },
      },
    });
  })
);

// ============================================
// SEARCH/FILTER APIs
// ============================================

/**
 * GET /api/dashboard/search/calls
 * Search calls by transcript, caller info, etc.
 */
router.get(
  "/search/calls",
  asyncHandler(async (req, res) => {
    const { error, value } = searchCallsSchema.validate(req.query);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const { query, limit, offset, agentId } = value;

    // Build where clause
    const where = {
      OR: [
        { transcript: { contains: query, mode: "insensitive" } },
        { caller_info: { contains: query, mode: "insensitive" } },
        { call_summary: { contains: query, mode: "insensitive" } },
        { call_id: { contains: query, mode: "insensitive" } },
      ],
    };

    if (agentId) {
      where.agent_id = agentId;
    }

    const [calls, totalCount] = await Promise.all([
      prisma.call.findMany({
        where,
        orderBy: { start_timestamp: "desc" },
        skip: offset,
        take: limit,
        select: {
          id: true,
          call_id: true,
          agent_id: true,
          caller_info: true,
          start_timestamp: true,
          end_timestamp: true,
          duration_ms: true,
          duration_seconds: true,
          transcript: true,
          call_status: true,
          cost: true,
          call_summary: true,
          user_sentiment: true,
          call_successful: true,
          recording_url: true,
          created_at: true,
          updated_at: true,
          agent: {
            select: {
              agent_id: true,
              agent_name: true,
            },
          },
        },
      }),
      prisma.call.count({ where }),
    ]);

    // Convert BigInt timestamps to numbers
    const formattedCalls = calls.map((call) => ({
      ...call,
      start_timestamp: Number(call.start_timestamp),
      end_timestamp: Number(call.end_timestamp),
    }));

    res.json({
      success: true,
      data: {
        calls: formattedCalls,
        pagination: {
          total: totalCount,
          limit,
          offset,
          hasMore: offset + limit < totalCount,
        },
      },
    });
  })
);

/**
 * GET /api/dashboard/search/agents
 * Search agents by name or ID
 */
router.get(
  "/search/agents",
  asyncHandler(async (req, res) => {
    const { error, value } = searchAgentsSchema.validate(req.query);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const { query, limit, offset } = value;

    // Build where clause
    const where = {
      OR: [
        { agent_name: { contains: query, mode: "insensitive" } },
        { agent_id: { contains: query, mode: "insensitive" } },
      ],
    };

    const [agents, totalCount] = await Promise.all([
      prisma.agent.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: offset,
        take: limit,
        select: {
          id: true,
          agent_id: true,
          agent_name: true,
          status: true,
          created_at: true,
          updated_at: true,
          _count: {
            select: { calls: true },
          },
        },
      }),
      prisma.agent.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        agents,
        pagination: {
          total: totalCount,
          limit,
          offset,
          hasMore: offset + limit < totalCount,
        },
      },
    });
  })
);

export default router;
