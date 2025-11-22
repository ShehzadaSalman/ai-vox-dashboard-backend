#!/usr/bin/env node

/**
 * Simple test script to verify the backend setup
 * Run with: node test-setup.js
 */

import dotenv from "dotenv";
import { prisma } from "./src/lib/database.js";
import { retellAPI } from "./src/lib/retell.js";
import { logger } from "./src/lib/logger.js";

// Load environment variables
dotenv.config();

async function testSetup() {
  console.log("🧪 Testing AI Receptionist Dashboard Backend Setup...\n");

  // Test 1: Environment Variables
  console.log("1️⃣ Testing environment variables...");
  const requiredEnvVars = ["DATABASE_URL", "RETELL_API_KEY", "API_AUTH_KEY"];
  const missingVars = requiredEnvVars.filter(
    (varName) => !process.env[varName]
  );

  if (missingVars.length > 0) {
    console.log(
      "❌ Missing required environment variables:",
      missingVars.join(", ")
    );
    console.log(
      "   Please copy env.example to .env and configure the values.\n"
    );
    return;
  }
  console.log("✅ All required environment variables are set\n");

  // Test 2: Database Connection
  console.log("2️⃣ Testing database connection...");
  try {
    await prisma.$connect();
    console.log("✅ Database connection successful\n");
  } catch (error) {
    console.log("❌ Database connection failed:", error.message);
    console.log(
      "   Please check your DATABASE_URL and ensure the database is running.\n"
    );
    return;
  }

  // Test 3: Prisma Schema
  console.log("3️⃣ Testing Prisma schema...");
  try {
    // Try to query the agents table
    await prisma.agent.findMany({ take: 1 });
    console.log("✅ Prisma schema is valid\n");
  } catch (error) {
    console.log("❌ Prisma schema error:", error.message);
    console.log("   Please run: npm run db:push\n");
    return;
  }

  // Test 4: Retell API Connection
  console.log("4️⃣ Testing Retell API connection...");
  try {
    // This will test the API key and connection
    await retellAPI.getCalls({ limit: 1 });
    console.log("✅ Retell API connection successful\n");
  } catch (error) {
    console.log("⚠️  Retell API connection failed:", error.message);
    console.log(
      "   This might be normal if you have no calls or invalid API key.\n"
    );
  }

  // Test 5: Logger
  console.log("5️⃣ Testing logger...");
  try {
    logger.info("Test log message");
    console.log("✅ Logger is working\n");
  } catch (error) {
    console.log("❌ Logger error:", error.message);
  }

  console.log("🎉 Setup test completed!");
  console.log("\nNext steps:");
  console.log("1. Run: npm run db:push (to create database tables)");
  console.log("2. Run: npm run dev (to start the development server)");
  console.log("3. Test the API endpoints with your API key");

  await prisma.$disconnect();
}

// Run the test
testSetup().catch(console.error);
