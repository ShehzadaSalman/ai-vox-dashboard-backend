import { prisma } from "../lib/database.js";
import { retellAPI } from "../lib/retell.js";
import { logger } from "../lib/logger.js";

// Pulls the response-engine linkage (type, llm_id, knowledge_base_id) off a
// Retell agent object so the config surface has what it needs to read/write.
const extractEngine = (agent) => {
  const engine = agent?.response_engine || {};
  const type = engine.type || null;
  const llmId = engine.llm_id || null;
  return { responseEngineType: type, llmId };
};

const dedupeAgents = (agents) => {
  const map = new Map();
  for (const agent of agents || []) {
    if (!agent?.agent_id) {
      continue;
    }
    const existing = map.get(agent.agent_id);
    const candidateTs = agent.last_modification_timestamp || 0;
    const existingTs = existing?.last_modification_timestamp || 0;
    const shouldReplace =
      candidateTs > existingTs ||
      (candidateTs === existingTs && agent.is_published && !existing?.is_published);
    if (!existing || shouldReplace) {
      map.set(agent.agent_id, agent);
    }
  }
  return Array.from(map.values());
};

/**
 * Sync agents from Retell into the local mirror, including response-engine
 * linkage. Reusable by the manual route and the scheduled function.
 */
export const syncAgents = async () => {
  const raw = await retellAPI.getAgents();
  const agents = dedupeAgents(raw);

  if (agents.length === 0) {
    return { synced: 0, updated: 0, errors: 0, total: 0 };
  }

  let synced = 0;
  let updated = 0;
  let errors = 0;

  for (const agent of agents) {
    try {
      const agentName = agent.agent_name || `Agent ${agent.agent_id}`;
      const { responseEngineType, llmId } = extractEngine(agent);

      const result = await prisma.agent.upsert({
        where: { agent_id: agent.agent_id },
        update: {
          agent_name: agentName,
          status: agent.is_published ? "ACTIVE" : "INACTIVE",
          response_engine_type: responseEngineType,
          llm_id: llmId,
          updated_at: new Date(),
        },
        create: {
          agent_id: agent.agent_id,
          agent_name: agentName,
          status: agent.is_published ? "ACTIVE" : "INACTIVE",
          response_engine_type: responseEngineType,
          llm_id: llmId,
        },
      });

      if (result.created_at.getTime() === result.updated_at.getTime()) {
        synced++;
      } else {
        updated++;
      }
    } catch (agentError) {
      logger.error("Error syncing agent", {
        agentId: agent.agent_id,
        error: agentError.message,
      });
      errors++;
    }
  }

  logger.info("Agent sync completed", {
    total: agents.length,
    synced,
    updated,
    errors,
  });

  return { synced, updated, errors, total: agents.length };
};
