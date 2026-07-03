// Netlify Scheduled Function — keeps the local agent mirror in sync with Retell
// so no one has to trigger a manual sync. Runs every 15 minutes.
import { syncAgents } from "../../src/services/agentSyncService.js";

export const config = {
  schedule: "*/15 * * * *",
};

export default async () => {
  try {
    const result = await syncAgents();
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
