import bcrypt from "bcryptjs";
import { prisma } from "./database.js";
import { logger } from "./logger.js";

export const ensureSuperAdmin = async () => {
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;
  const name = process.env.SUPERADMIN_NAME || "Super Admin";

  if (!email || !password) {
    logger.warn(
      "SUPERADMIN_EMAIL or SUPERADMIN_PASSWORD not set; skipping superadmin bootstrap"
    );
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== "SUPERADMIN") {
      await prisma.user.update({
        where: { email },
        data: { role: "SUPERADMIN", status: "APPROVED" },
      });
      logger.info("Updated user role to SUPERADMIN", { email });
    }
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
      role: "SUPERADMIN",
      status: "APPROVED",
    },
  });
  logger.info("Created superadmin user", { email });
};
