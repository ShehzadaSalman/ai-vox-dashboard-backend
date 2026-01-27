import express from "express";
import { query, body, param } from "express-validator";
import { calcomController } from "../controllers/calcomController.js";

const router = express.Router();

router.get("/health", calcomController.getHealth);
router.get("/test-calcom", calcomController.getTestCalcom);

router.get(
  "/date",
  query("timezone").optional().isString().withMessage("timezone must be a string"),
  calcomController.getDate
);

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
  query("eventTypeId").optional().isString(),
  query("userId").optional().isString(),
  calcomController.listBookings
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
