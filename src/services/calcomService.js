import axios from "axios";

const getCalcomBaseUrl = () => {
  const raw = process.env.CALCOM_BASE_URL || "https://api.cal.com";
  let base = raw.trim();
  if (base.endsWith("/")) {
    base = base.slice(0, -1);
  }
  if (base.endsWith("/v2")) {
    base = base.slice(0, -3);
  }
  return base;
};
const CALCOM_API_VERSION = "2024-08-13";

const getClient = (apiKey) => {
  if (!apiKey) {
    const error = new Error("Cal.com API key is not configured");
    error.code = "CALCOM_AUTH_MISSING";
    throw error;
  }

  return axios.create({
    baseURL: getCalcomBaseUrl(),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "cal-api-version": CALCOM_API_VERSION,
    },
  });
};

const normalizeSlotTime = (slot) => {
  if (!slot) {
    return null;
  }
  const start =
    slot.start || slot.startTime || slot.start_time || slot?.time?.start;
  const end = slot.end || slot.endTime || slot.end_time || slot?.time?.end;
  if (!start || !end) {
    return null;
  }
  return { start, end, available: true };
};

const flattenSlots = (slotsRaw) => {
  if (!slotsRaw) {
    return [];
  }
  if (Array.isArray(slotsRaw)) {
    return slotsRaw
      .map((slot) => normalizeSlotTime(slot))
      .filter(Boolean);
  }
  if (typeof slotsRaw === "object") {
    const collected = [];
    Object.values(slotsRaw).forEach((value) => {
      if (Array.isArray(value)) {
        value.forEach((slot) => {
          const normalized = normalizeSlotTime(slot);
          if (normalized) {
            collected.push(normalized);
          }
        });
      }
    });
    return collected;
  }
  return [];
};

const normalizeBooking = (payload) => {
  const booking = payload?.booking || payload?.data || payload || {};
  const start = booking.start || booking.startTime || booking.start_time;
  const end = booking.end || booking.endTime || booking.end_time;
  const eventTypeId =
    booking.eventTypeId || booking.eventType?.id || booking.event_type_id;
  const meetingUrl = booking.meetingUrl || booking.location || booking.meeting_url;
  const attendee = booking.attendees?.[0] || booking.attendee || {};
  return {
    reservationId: booking.id || booking.bookingId || booking.uid || "",
    status: booking.status || "confirmed",
    eventDetails: {
      start: start || null,
      end: end || null,
      eventTypeId: eventTypeId ? String(eventTypeId) : null,
      meetingUrl: meetingUrl || null,
    },
    attendee: {
      name: attendee.name || null,
      email: attendee.email || null,
    },
  };
};

export const calcomService = {
  async testConnection(apiKey) {
    const client = getClient(apiKey);
    const response = await client.get("/v2/me");
    return response.data;
  },

  async getAvailableSlots({ apiKey, eventTypeId, startTime, endTime, timeZone }) {
    const client = getClient(apiKey);
    const response = await client.get("/slots/available", {
      params: {
        eventTypeId,
        startTime,
        endTime,
        timeZone,
      },
    });
    const slotsRaw =
      response.data?.slots || response.data?.data?.slots || response.data?.data;
    return flattenSlots(slotsRaw);
  },

  async reserveSlot(apiKey, payload) {
    const client = getClient(apiKey);
    try {
      const attendee = payload?.attendee || {};
      const timeZone = attendee.timeZone || attendee.timezone;
      const eventTypeId = Number(payload.eventTypeId);
      if (!Number.isFinite(eventTypeId)) {
        const error = new Error("Invalid eventTypeId");
        error.status = 400;
        throw error;
      }
      const calPayload = {
        eventTypeId,
        start: payload.start,
        attendee: {
          name: attendee.name,
          email: attendee.email,
          timeZone: timeZone || undefined,
        },
      };
      if (payload.metadata && Object.keys(payload.metadata).length > 0) {
        calPayload.metadata = payload.metadata;
      }
      const response = await client.post("/v2/bookings", calPayload);
      return normalizeBooking(response.data);
    } catch (error) {
      const status = error.response?.status;
      const data = error.response?.data;
      const message = data?.message || JSON.stringify(data) || error.message;
      const wrapped = new Error(`Cal.com error${status ? ` (${status})` : ""}: ${message}`);
      wrapped.status = status || 500;
      throw wrapped;
    }
  },

  async updateReservation(apiKey, reservationId, payload) {
    const client = getClient(apiKey);
    const response = await client.patch(`/v2/bookings/${reservationId}`, payload);
    return normalizeBooking(response.data);
  },

  async listBookings(apiKey, params = {}) {
    const client = getClient(apiKey);
    const response = await client.get("/v2/bookings", { params });
    console.log("Cal.com bookings response", response.data);
    return response.data;
  },
};
