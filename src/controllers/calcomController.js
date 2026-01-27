import { validationResult } from "express-validator";
import { calcomService } from "../services/calcomService.js";

const handleValidation = (req) => {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    const error = new Error(result.array()[0].msg);
    error.status = 400;
    throw error;
  }
};

const formatDateParts = (date, timeZone) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get(
    "minute"
  )}:${get("second")}`;
};

export const calcomController = {
  getHealth(req, res) {
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
    });
  },

  async getTestCalcom(req, res, next) {
    try {
      const timestamp = new Date().toISOString();
      await calcomService.testConnection();
      res.json({
        status: "connected",
        timestamp,
      });
    } catch (error) {
      const timestamp = new Date().toISOString();
      const status = error.code === "CALCOM_AUTH_MISSING" ? "error" : "failed";
      res.json({
        status,
        timestamp,
        message: error.message,
      });
    }
  },

  getDate(req, res) {
    handleValidation(req);
    const timezone = req.query.timezone;
    const now = new Date();
    const utcDate = now.toISOString();
    const currentDate = timezone
      ? formatDateParts(now, timezone)
      : utcDate;
    res.json({
      currentDate,
      timestamp: now.getTime(),
      timezone: timezone || undefined,
      utcDate,
    });
  },

  async getAvailableSlots(req, res, next) {
    try {
      handleValidation(req);
      const { eventTypeId, start, end, timezone } = req.query;
      const startTime = start || new Date().toISOString();
      const endTime =
        end ||
        new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();
      const slots = await calcomService.getAvailableSlots({
        eventTypeId,
        startTime,
        endTime,
        timeZone: timezone,
      });
      res.json({
        slots,
        eventTypeId: String(eventTypeId),
        dateRange: {
          start: startTime,
          end: endTime,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  async reserveSlot(req, res, next) {
    try {
      handleValidation(req);
      const reservation = await calcomService.reserveSlot(req.body);
      res.json(reservation);
    } catch (error) {
      next(error);
    }
  },

  async updateReservation(req, res, next) {
    try {
      handleValidation(req);
      const { reservationId } = req.params;
      const reservation = await calcomService.updateReservation(
        reservationId,
        req.body
      );
      res.json(reservation);
    } catch (error) {
      next(error);
    }
  },

  async listBookings(req, res, next) {
    try {
      handleValidation(req);
      const { take, skip, status, eventTypeId, userId } = req.query;
      const params = {};
      if (take !== undefined) {
        params.take = Number(take);
      }
      if (skip !== undefined) {
        params.skip = Number(skip);
      }
      if (status) {
        params.status = status;
      }
      if (eventTypeId) {
        params.eventTypeId = eventTypeId;
      }
      if (userId) {
        params.userId = userId;
      }
      const data = await calcomService.listBookings(params);
      res.json(data);
    } catch (error) {
      next(error);
    }
  },
};
