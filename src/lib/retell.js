import axios from "axios";
import { logger } from "./logger.js";

class RetellAPI {
  constructor() {
    this.apiKey = process.env.RETELL_API_KEY;
    this.baseURL = "https://api.retellai.com/v2";

    if (!this.apiKey) {
      throw new Error("RETELL_API_KEY environment variable is required");
    }

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
   * @returns {Promise<Object>} - API response with calls array
   */
  async getCalls(options = {}) {
    try {
      const requestBody = {
        limit: options.limit || 100,
        ...(options.startAfter && { start_after: options.startAfter }),
        ...(options.startTimestamp && {
          start_timestamp: options.startTimestamp,
        }),
        ...(options.endTimestamp && { end_timestamp: options.endTimestamp }),
      };

      const response = await this.client.post("/list-calls", requestBody);
      return response.data;
    } catch (error) {
      logger.error("Failed to fetch calls from Retell API", {
        error: error.message,
        options,
      });
      throw new Error(`Failed to fetch calls: ${error.message}`);
    }
  }

  /**
   * Fetch all calls within a date range with pagination
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @param {number} limit - Calls per page
   * @returns {Promise<Array>} - Array of all calls
   */
  async getAllCallsInRange(startDate, endDate, limit = 100) {
    const allCalls = [];
    let startAfter = null;
    let hasMore = true;

    const startTimestamp = Math.floor(startDate.getTime() / 1000);
    const endTimestamp = Math.floor(endDate.getTime() / 1000);

    logger.info("Fetching calls from Retell API", {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      startTimestamp,
      endTimestamp,
    });

    while (hasMore) {
      try {
        const response = await this.getCalls({
          limit,
          startAfter,
          startTimestamp,
          endTimestamp,
        });

        // Debug: Log the response structure
        logger.debug("Retell API response structure", {
          isArray: Array.isArray(response),
          hasCallsProperty:
            response && typeof response === "object" && "calls" in response,
          responseKeys:
            response && typeof response === "object"
              ? Object.keys(response)
              : "N/A",
          responseLength: Array.isArray(response) ? response.length : "N/A",
        });

        // The API returns an array directly, not an object with calls property
        const calls = Array.isArray(response) ? response : response.calls || [];
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
      dateRange: `${startDate.toISOString()} to ${endDate.toISOString()}`,
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
      const response = await this.client.get(`/calls/${callId}`);
      return response.data;
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
      const response = await this.client.get("/agents");
      return response.data;
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
      const response = await this.client.get(`/agents/${agentId}`);
      return response.data;
    } catch (error) {
      logger.error("Failed to fetch agent by ID", {
        agentId,
        error: error.message,
      });
      throw new Error(`Failed to fetch agent ${agentId}: ${error.message}`);
    }
  }
}

// Create singleton instance
export const retellAPI = new RetellAPI();
export default retellAPI;
