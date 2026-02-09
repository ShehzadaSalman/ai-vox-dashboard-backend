import { validationResult } from "express-validator";
import { calcomService } from "../services/calcomService.js";
import { sendAppointmentConfirmationSms } from "../services/smsService.js";
import { prisma } from "../lib/database.js";
import { logger } from "../lib/logger.js";

const handleValidation = (req) => {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    const error = new Error(result.array()[0].msg);
    error.status = 400;
    throw error;
  }
};

const getUserCalcomKey = async (userId) => {
  const integration = await prisma.integration.findUnique({
    where: {
      user_id_provider: {
        user_id: userId,
        provider: "calcom",
      },
    },
  });
  const apiKey = integration?.api_key || "";
  if (!apiKey) {
    const error = new Error("Cal.com API key not set");
    error.status = 400;
    throw error;
  }
  return apiKey;
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

const filterActiveBookings = (data) => {
  if (Array.isArray(data?.data)) {
    return { ...data, data: data.data.filter(isActiveBooking) };
  }
  if (Array.isArray(data?.bookings)) {
    return { ...data, bookings: data.bookings.filter(isActiveBooking) };
  }
  return data;
};

const isActiveBooking = (booking) => {
  const status = (booking?.status || "").toLowerCase();
  return status === "confirmed" || status === "pending";
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
      const apiKey = await getUserCalcomKey(req.user.id);
      await calcomService.testConnection(apiKey);
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
      const apiKey = await getUserCalcomKey(req.user.id);
      const { eventTypeId, start, end, timezone } = req.query;
      const startTime = start || new Date().toISOString();
      const endTime =
        end ||
        new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();
      const slots = await calcomService.getAvailableSlots({
        apiKey,
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
      const apiKey = await getUserCalcomKey(req.user.id);
      const reservation = await calcomService.reserveSlot(apiKey, req.body);
      try {
        const phone = req.body?.metadata?.phone;
        const attendeeName = req.body?.attendee?.name || "there";
        const visitTime =
          reservation?.eventDetails?.start || req.body?.start;
        const integration = await prisma.integration.findUnique({
          where: {
            user_id_provider: {
              user_id: req.user.id,
              provider: "calcom",
            },
          },
        });
        const config = integration?.config || {};
        const calLinkRaw = config.calLink || "";
        const calLink =
          calLinkRaw && /^https?:\/\//i.test(calLinkRaw)
            ? calLinkRaw
            : calLinkRaw
              ? `https://cal.com/${calLinkRaw.replace(/^\/+/, "")}`
              : "";
        const smsIntegration = await prisma.integration.findUnique({
          where: {
            user_id_provider: {
              user_id: req.user.id,
              provider: "sms",
            },
          },
        });
        const defaultCountryCode = smsIntegration?.config?.defaultCountryCode;
        await sendAppointmentConfirmationSms(phone, {
          name: attendeeName,
          visitTime,
          calLink,
        }, {
          defaultCountryCode,
        });
      } catch (smsError) {
        logger.warn("Failed to send appointment confirmation SMS", {
          message: smsError?.message,
          leadId: req.body?.metadata?.leadId,
        });
      }
      res.json(reservation);
    } catch (error) {
      next(error);
    }
  },

  async updateReservation(req, res, next) {
    try {
      handleValidation(req);
      const { reservationId } = req.params;
      const apiKey = await getUserCalcomKey(req.user.id);
      const reservation = await calcomService.updateReservation(
        apiKey,
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
      const apiKey = await getUserCalcomKey(req.user.id);
      const {
        take,
        skip,
        status,
        attendeeEmail,
        attendeeName,
        bookingUid,
        eventTypeIds,
        eventTypeId,
        teamsIds,
        teamId,
        afterStart,
        beforeStart,
        afterCreatedAt,
        beforeCreatedAt,
        afterUpdatedAt,
        beforeUpdatedAt,
        sortStart,
        sortEnd,
        sortCreated,
        sortUpdatedAt,
      } = req.query;
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
      if (attendeeEmail) params.attendeeEmail = attendeeEmail;
      if (attendeeName) params.attendeeName = attendeeName;
      if (bookingUid) params.bookingUid = bookingUid;
      if (eventTypeIds) params.eventTypeIds = eventTypeIds;
      if (eventTypeId) params.eventTypeId = eventTypeId;
      if (teamsIds) params.teamsIds = teamsIds;
      if (teamId) params.teamId = teamId;
      if (afterStart) params.afterStart = afterStart;
      if (beforeStart) params.beforeStart = beforeStart;
      if (afterCreatedAt) params.afterCreatedAt = afterCreatedAt;
      if (beforeCreatedAt) params.beforeCreatedAt = beforeCreatedAt;
      if (afterUpdatedAt) params.afterUpdatedAt = afterUpdatedAt;
      if (beforeUpdatedAt) params.beforeUpdatedAt = beforeUpdatedAt;
      if (sortStart) params.sortStart = sortStart;
      if (sortEnd) params.sortEnd = sortEnd;
      if (sortCreated) params.sortCreated = sortCreated;
      if (sortUpdatedAt) params.sortUpdatedAt = sortUpdatedAt;
      const data = await calcomService.listBookings(apiKey, params);
      res.json(filterActiveBookings(data));
    } catch (error) {
      next(error);
    }
  },

  async cancelBooking(req, res, next) {
    try {
      handleValidation(req);
      const { reservationId } = req.params;
      const apiKey = await getUserCalcomKey(req.user.id);
      const result = await calcomService.cancelBooking(apiKey, reservationId, {
        cancellationReason: "Removed from dashboard",
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
};
