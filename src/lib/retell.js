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
   * Fetch calls from Retell API with pagination
   * @param {Object} options - Query options
   * @param {number} options.limit - Number of calls to fetch per page
   * @param {string} options.startAfter - Call ID to start after (for pagination)
   * @param {number} options.startTimestamp - Start timestamp filter (Unix timestamp in seconds)
   * @param {number} options.endTimestamp - End timestamp filter (Unix timestamp in seconds)
   * @param {Object} options.filterCriteria - Additional Retell filter_criteria options
   * @returns {Promise<Array>} - Calls array
   */
  async getCalls(options = {}) {
    try {
      const filterCriteria =
        options.startTimestamp || options.endTimestamp
          ? {
              start_timestamp: {
                ...(options.startTimestamp && {
                  lower_threshold: options.startTimestamp,
                }),
                ...(options.endTimestamp && {
                  upper_threshold: options.endTimestamp,
                }),
              },
            }
          : {};

      const mergedFilterCriteria = {
        ...filterCriteria,
        ...(options.filterCriteria || {}),
      };

      const response = await this.client.post("/list-calls", {
        limit: options.limit || 100,
        ...(options.startAfter && { pagination_key: options.startAfter }),
        ...(Object.keys(mergedFilterCriteria).length > 0 && {
          filter_criteria: mergedFilterCriteria,
        }),
      });
      const data = response.data;
      const calls = Array.isArray(data) ? data : data?.calls || [];
      console.log("Retell call history response", calls);
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
   * Fetch all agents from Retell API
   * @returns {Promise<Array>} - Array of all agents
   */
  async getAgents() {
    try {
      return await this.sdk.agent.list();
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
   * Publish the latest draft version of an agent
   */
  async publishAgent(agentId) {
    try {
      return await this.sdk.agent.publish(agentId);
    } catch (error) {
      // Retell's publish-agent endpoint returns an empty body on success (2xx),
      // but the SDK tries to JSON-parse it and throws "Unexpected end of JSON
      // input" / "invalid json response body". That parse error means the
      // publish actually succeeded, so treat it as success.
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

  async deleteKnowledgeBaseSource(knowledgeBaseId, sourceId) {
    try {
      return await this.sdk.knowledgeBase.deleteSource(knowledgeBaseId, sourceId);
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
