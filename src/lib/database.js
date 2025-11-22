import { PrismaClient } from "@prisma/client";
import { logger } from "./logger.js";

// Create Prisma client instance
export const prisma = new PrismaClient({
  log: [
    {
      emit: "event",
      level: "query",
    },
    {
      emit: "event",
      level: "error",
    },
    {
      emit: "event",
      level: "info",
    },
    {
      emit: "event",
      level: "warn",
    },
  ],
});

// Log Prisma events
prisma.$on("query", (e) => {
  logger.debug("Prisma Query", {
    query: e.query,
    params: e.params,
    duration: e.duration,
  });
});

prisma.$on("error", (e) => {
  logger.error("Prisma Error", e);
});

prisma.$on("info", (e) => {
  logger.info("Prisma Info", e);
});

prisma.$on("warn", (e) => {
  logger.warn("Prisma Warning", e);
});

// Graceful shutdown
process.on("beforeExit", async () => {
  await prisma.$disconnect();
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

export default prisma;
