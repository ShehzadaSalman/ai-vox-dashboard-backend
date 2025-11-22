import winston from "winston";

const { combine, timestamp, errors, json, printf, colorize } = winston.format;

// Custom format for console output
const consoleFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level}]: ${stack || message}`;
});

// Create logger instance
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: combine(
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    errors({ stack: true }),
    json()
  ),
  defaultMeta: { service: "aivox-dashboard-backend" },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        errors({ stack: true }),
        consoleFormat
      ),
    }),

    // File transport for errors
    new winston.transports.File({
      filename: "logs/error.log",
      level: "error",
      format: combine(timestamp(), errors({ stack: true }), json()),
    }),

    // File transport for all logs
    new winston.transports.File({
      filename: "logs/combined.log",
      format: combine(timestamp(), errors({ stack: true }), json()),
    }),
  ],
});

// Handle uncaught exceptions and unhandled rejections
logger.exceptions.handle(
  new winston.transports.File({ filename: "logs/exceptions.log" })
);

logger.rejections.handle(
  new winston.transports.File({ filename: "logs/rejections.log" })
);

export default logger;
