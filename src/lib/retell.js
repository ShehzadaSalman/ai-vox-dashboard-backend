import axios from "axios";
import Retell from "retell-sdk";
import { logger } from "./logger.js";

class RetellAPI {
  constructor() {
    this.apiKey = process.env.RETELL_API_KEY;
    this.baseURL = "https://api.retellai.com/v2";

    if (!this.apiKey) {
      throw new Error("RETELL_API_KEY environment variable is required");
    }

    this.sdk = new Retell({ apiKey: this.apiKey });

    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 30000, // 30 seconds
    });

    // Add request/response interceptors for logging
    this.client.interceptors.request.use(
      (config) => {
        logger.debug("Retell API Request", {
          method: config.method,
          url: config.url,
          params: config.params,
        });
        return config;
      },
      (error) => {
        logger.error("Retell API Request Error", error);
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.debug("Retell API Response", {
          status: response.status,
          url: response.config.url,
          dataLength: response.data?.length || 0,
        });
        return response;
      },
      (error) => {
        logger.error("Retell API Response Error", {
          status: error.response?.status,
          message: error.message,
          url: error.config?.url,
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Build a call-list filter_criteria.start_timestamp entry from simple
   * lower/upper bound options, matching retell-sdk v5's structured filter DSL
   * ({ op, type, value }) instead of the old { lower_threshold, upper_threshold }.
   */
  _buildStartTimestampFilter(startTimestamp, endTimestamp) {
    if (startTimestamp && endTimestamp) {
      return { op: "bt", type: "range", value: [startTimestamp, endTimestamp] };
    }
    if (startTimestamp) {
      return { op: "ge", type: "number", value: startTimestamp };
    }
    if (endTimestamp) {
      return { op: "le", type: "number", value: endTimestamp };
    }
    return undefined;
  }

  /**
   * Fetch calls from Retell API with pagination
   * @param {Object} options - Query options
   * @param {number} options.limit - Number of calls to fetch per page
   * @param {string} options.startAfter - Pagination cursor to start after
   * @param {number} options.startTimestamp - Start timestamp filter (Unix timestamp in seconds)
   * @param {number} options.endTimestamp - End timestamp filter (Unix timestamp in seconds)
   * @param {Object} options.filterCriteria - Additional Retell filter_criteria options
   * @returns {Promise<Array>} - Calls array
   */
  async getCalls(options = {}) {
    try {
      const startTimestampFilter = this._buildStartTimestampFilter(
        options.startTimestamp,
        options.endTimestamp
      );

      const filterCriteria = {
        ...(startTimestampFilter && { start_timestamp: startTimestampFilter }),
        ...(options.filterCriteria || {}),
      };

      const response = await this.sdk.call.list({
        limit: options.limit || 100,
        ...(options.startAfter && { pagination_key: options.startAfter }),
        ...(Object.keys(filterCriteria).length > 0 && {
          filter_criteria: filterCriteria,
        }),
      });
      const calls = response?.items || [];
      return calls;
    } catch (error) {
      logger.error("Failed to fetch calls from Retell API", {
        error: error.message,
        options,
      });
      throw new Error(`Failed to fetch calls: ${error.message}`);
    }
  }

  /**
   * Fetch all calls with pagination
   * @param {number} limit - Calls per page
   * @param {Object} options - Query options
   * @returns {Promise<Array>} - Array of all calls
   */
  async getAllCalls(limit = 100, options = {}) {
    const allCalls = [];
    let startAfter = null;
    let hasMore = true;

    logger.info("Fetching calls from Retell API", {
      limit,
      startTimestamp: options.startTimestamp,
    });

    while (hasMore) {
      try {
        const calls = await this.getCalls({
          limit,
          startAfter,
          ...(options.startTimestamp && { startTimestamp: options.startTimestamp }),
          ...(options.filterCriteria && { filterCriteria: options.filterCriteria }),
        });
        allCalls.push(...calls);

        // Check if there are more pages
        hasMore = calls.length === limit && calls.length > 0;
        if (hasMore && calls.length > 0) {
          startAfter = calls[calls.length - 1].call_id;
        }

        logger.debug("Fetched calls batch", {
          batchSize: calls.length,
          totalCalls: allCalls.length,
          hasMore,
        });

        // Add a small delay to avoid rate limiting
        if (hasMore) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } catch (error) {
        logger.error("Error fetching calls batch", {
          error: error.message,
          startAfter,
        });
        throw error;
      }
    }

    logger.info("Completed fetching all calls", {
      totalCalls: allCalls.length,
    });

    return allCalls;
  }

  /**
   * Get call details by call ID
   * @param {string} callId - Call ID
   * @returns {Promise<Object>} - Call details
   */
  async getCallById(callId) {
    try {
      return await this.sdk.call.retrieve(callId);
    } catch (error) {
      logger.error("Failed to fetch call by ID", {
        callId,
        error: error.message,
      });
      throw new Error(`Failed to fetch call ${callId}: ${error.message}`);
    }
  }

  /**
   * Fetch all agents from Retell API, with full details (is_published,
   * response_engine, last_modification_timestamp) per agent.
   *
   * retell-sdk v5's agent.list() only returns lightweight items (agent_id,
   * agent_name, tags) — it no longer includes is_published/response_engine.
   * So this paginates the list to collect every agent_id, then retrieves each
   * one individually to rebuild the full shape our callers (agentSyncService,
   * dashboard.js) expect.
   * @returns {Promise<Array>} - Array of full agent details
   */
  async getAgents() {
    try {
      const summaries = [];
      let paginationKey;
      let hasMore = true;

      while (hasMore) {
        const response = await this.sdk.agent.list({
          limit: 1000,
          ...(paginationKey && { pagination_key: paginationKey }),
        });
        summaries.push(...(response?.items || []));
        hasMore = Boolean(response?.has_more && response?.pagination_key);
        paginationKey = response?.pagination_key;
      }

      const fullAgents = await Promise.all(
        summaries.map(async (summary) => {
          try {
            return await this.sdk.agent.retrieve(summary.agent_id);
          } catch (error) {
            logger.error("Failed to fetch agent detail during sync", {
              agentId: summary.agent_id,
              error: error.message,
            });
            return null;
          }
        })
      );

      return fullAgents.filter(Boolean);
    } catch (error) {
      logger.error("Failed to fetch agents from Retell API", {
        error: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
      });
      throw new Error(`Failed to fetch agents: ${error.message}`);
    }
  }

  /**
   * Get agent details by agent ID
   * @param {string} agentId - Agent ID
   * @returns {Promise<Object>} - Agent details
   */
  async getAgentById(agentId) {
    try {
      return await this.sdk.agent.retrieve(agentId);
    } catch (error) {
      logger.error("Failed to fetch agent by ID", {
        agentId,
        error: error.message,
      });
      throw new Error(`Failed to fetch agent ${agentId}: ${error.message}`);
    }
  }

  /**
   * Retrieve a Retell LLM (holds the prompt + knowledge base links)
   */
  async getLlm(llmId) {
    try {
      return await this.sdk.llm.retrieve(llmId);
    } catch (error) {
      logger.error("Failed to fetch LLM", { llmId, error: error.message });
      throw new Error(`Failed to fetch LLM ${llmId}: ${error.message}`);
    }
  }

  /**
   * Update a Retell LLM (prompt and/or attached knowledge bases)
   */
  async updateLlm(llmId, params) {
    try {
      return await this.sdk.llm.update(llmId, params);
    } catch (error) {
      logger.error("Failed to update LLM", { llmId, error: error.message });
      throw new Error(`Failed to update LLM ${llmId}: ${error.message}`);
    }
  }

  /**
   * Publish the latest draft version of an agent.
   *
   * retell-sdk v5 replaced the old "publish in place" endpoint with
   * /publish-agent-version, which requires the specific draft version number
   * to publish — so this looks up the agent's current version first.
   */
  async publishAgent(agentId) {
    try {
      const agent = await this.sdk.agent.retrieve(agentId);
      return await this.sdk.agent.publish(agentId, { version: agent.version });
    } catch (error) {
      // Retell's publish-agent endpoint used to return an empty body on
      // success (2xx) that the old SDK version tried (and failed) to
      // JSON-parse. Keep tolerating that shape defensively.
      const message = error?.message || "";
      const isEmptyBodyParseError =
        error?.status === undefined &&
        /unexpected end of json input|invalid json response body/i.test(message);
      if (isEmptyBodyParseError) {
        return { success: true, agent_id: agentId };
      }
      logger.error("Failed to publish agent", { agentId, error: message });
      throw new Error(`Failed to publish agent ${agentId}: ${message}`);
    }
  }

  /**
   * List all phone numbers (including which agent(s) each is bound to).
   * retell-sdk v5 returns { has_more, items, pagination_key } instead of a
   * bare array, and paginates — so this collects every page.
   */
  async listPhoneNumbers() {
    try {
      const numbers = [];
      let paginationKey;
      let hasMore = true;

      while (hasMore) {
        const response = await this.sdk.phoneNumber.list({
          limit: 1000,
          ...(paginationKey && { pagination_key: paginationKey }),
        });
        numbers.push(...(response?.items || []));
        hasMore = Boolean(response?.has_more && response?.pagination_key);
        paginationKey = response?.pagination_key;
      }

      return numbers;
    } catch (error) {
      logger.error("Failed to list phone numbers", { error: error.message });
      throw new Error(`Failed to list phone numbers: ${error.message}`);
    }
  }

  /**
   * Retrieve a single phone number's current binding state.
   */
  async getPhoneNumber(phoneNumber) {
    try {
      return await this.sdk.phoneNumber.retrieve(phoneNumber);
    } catch (error) {
      logger.error("Failed to fetch phone number", {
        phoneNumber,
        error: error.message,
      });
      throw new Error(`Failed to fetch phone number ${phoneNumber}: ${error.message}`);
    }
  }

  /**
   * Update the agent(s) bound to a phone number. Callers pass the current
   * retell-sdk v5 shape directly: { inbound_agents: [...], outbound_agents: [...] }
   * (arrays of { agent_id, weight, agent_version }), not the old singular
   * inbound_agent_id/outbound_agent_id fields.
   */
  async updatePhoneNumber(phoneNumber, params) {
    try {
      return await this.sdk.phoneNumber.update(phoneNumber, params);
    } catch (error) {
      logger.error("Failed to update phone number", {
        phoneNumber,
        error: error.message,
      });
      throw new Error(`Failed to update phone number ${phoneNumber}: ${error.message}`);
    }
  }

  /**
   * Knowledge base operations
   */
  async createKnowledgeBase(params) {
    try {
      return await this.sdk.knowledgeBase.create(params);
    } catch (error) {
      logger.error("Failed to create knowledge base", { error: error.message });
      throw new Error(`Failed to create knowledge base: ${error.message}`);
    }
  }

  async getKnowledgeBase(knowledgeBaseId) {
    try {
      return await this.sdk.knowledgeBase.retrieve(knowledgeBaseId);
    } catch (error) {
      logger.error("Failed to fetch knowledge base", {
        knowledgeBaseId,
        error: error.message,
      });
      throw new Error(
        `Failed to fetch knowledge base ${knowledgeBaseId}: ${error.message}`
      );
    }
  }

  async addKnowledgeBaseSources(knowledgeBaseId, params) {
    try {
      return await this.sdk.knowledgeBase.addSources(knowledgeBaseId, params);
    } catch (error) {
      logger.error("Failed to add knowledge base sources", {
        knowledgeBaseId,
        error: error.message,
      });
      throw new Error(`Failed to add knowledge base sources: ${error.message}`);
    }
  }

  /**
   * retell-sdk v5 changed this to deleteSource(sourceId, { knowledge_base_id }),
   * swapped from the old deleteSource(knowledgeBaseId, sourceId). This wrapper
   * keeps our own call sites (knowledgeBaseId, sourceId) unchanged.
   */
  async deleteKnowledgeBaseSource(knowledgeBaseId, sourceId) {
    try {
      return await this.sdk.knowledgeBase.deleteSource(sourceId, {
        knowledge_base_id: knowledgeBaseId,
      });
    } catch (error) {
      logger.error("Failed to delete knowledge base source", {
        knowledgeBaseId,
        sourceId,
        error: error.message,
      });
      throw new Error(`Failed to delete knowledge base source: ${error.message}`);
    }
  }
}

// Create singleton instance
export const retellAPI = new RetellAPI();
export default retellAPI;
