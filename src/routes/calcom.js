import express from "express";
import { query, body, param } from "express-validator";
import { calcomController } from "../controllers/calcomController.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

router.get("/health", calcomController.getHealth);
router.get("/date", query("timezone").optional().isString().withMessage("timezone must be a string"), calcomController.getDate);

router.use(authMiddleware);

router.get("/test-calcom", calcomController.getTestCalcom);

router.get(
  "/bookings",
  query("take")
    .optional()
    .isInt({ min: 1, max: 200 })
    .withMessage("take must be a number"),
  query("skip")
    .optional()
    .isInt({ min: 0 })
    .withMessage("skip must be a number"),
  query("status").optional().isString(),
  query("attendeeEmail").optional().isString(),
  query("attendeeName").optional().isString(),
  query("bookingUid").optional().isString(),
  query("eventTypeIds").optional().isString(),
  query("eventTypeId").optional().isString(),
  query("teamsIds").optional().isString(),
  query("teamId").optional().isString(),
  query("afterStart").optional().isISO8601().withMessage("afterStart must be ISO8601"),
  query("beforeStart").optional().isISO8601().withMessage("beforeStart must be ISO8601"),
  query("afterCreatedAt").optional().isISO8601().withMessage("afterCreatedAt must be ISO8601"),
  query("beforeCreatedAt").optional().isISO8601().withMessage("beforeCreatedAt must be ISO8601"),
  query("afterUpdatedAt").optional().isISO8601().withMessage("afterUpdatedAt must be ISO8601"),
  query("beforeUpdatedAt").optional().isISO8601().withMessage("beforeUpdatedAt must be ISO8601"),
  query("sortStart").optional().isIn(["asc", "desc"]),
  query("sortEnd").optional().isIn(["asc", "desc"]),
  query("sortCreated").optional().isIn(["asc", "desc"]),
  query("sortUpdatedAt").optional().isIn(["asc", "desc"]),
  calcomController.listBookings
);

router.delete(
  "/bookings/:reservationId",
  param("reservationId").notEmpty().withMessage("reservationId is required"),
  calcomController.cancelBooking
);

router.get(
  "/slots/available",
  query("eventTypeId").notEmpty().withMessage("eventTypeId is required"),
  query("start").optional().isISO8601().withMessage("start must be ISO8601"),
  query("end").optional().isISO8601().withMessage("end must be ISO8601"),
  query("timezone").optional().isString().withMessage("timezone must be a string"),
  calcomController.getAvailableSlots
);

router.post(
  "/slots/reserve",
  body("eventTypeId")
    .notEmpty()
    .withMessage("eventTypeId is required"),
  body("start")
    .notEmpty()
    .withMessage("start is required")
    .bail()
    .isISO8601()
    .withMessage("start must be ISO8601"),
  body("attendee.name")
    .notEmpty()
    .withMessage("attendee.name is required"),
  body("attendee.email")
    .notEmpty()
    .withMessage("attendee.email is required")
    .bail()
    .isEmail()
    .withMessage("attendee.email must be valid"),
  body("attendee.timeZone").optional().isString(),
  body("attendee.timezone").optional().isString(),
  body("metadata").optional().isObject(),
  calcomController.reserveSlot
);

router.put(
  "/slots/:reservationId",
  param("reservationId").notEmpty().withMessage("reservationId is required"),
  body("start")
    .optional()
    .isISO8601()
    .withMessage("start must be ISO8601"),
  body("attendee").optional().isObject(),
  body("metadata").optional().isObject(),
  calcomController.updateReservation
);

export default router;
