// Cloudflare Workers entry point
// Note: Express doesn't work directly with Cloudflare Workers
// This is a minimal worker that will deploy successfully
// For full functionality, routes need to be migrated to worktop or itty-router

export default {
  async fetch(request, env, ctx) {
    // Make environment variables available to the app
    if (env) {
      for (const [key, value] of Object.entries(env)) {
        if (typeof value === 'string') {
          process.env[key] = value;
        }
      }
    }
    
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
    };
    
    // Handle OPTIONS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    try {
      // Health check endpoint
      if (path === "/health" || path === "/") {
        return new Response(JSON.stringify({
          status: "healthy",
          timestamp: new Date().toISOString(),
          message: "Cloudflare Worker is running",
          note: "Express routes need to be migrated for full functionality. See DEPLOYMENT.md for details."
        }), {
          headers: { 
            "Content-Type": "application/json",
            ...corsHeaders
          },
        });
      }
      
      // For now, return a helpful message for other routes
      return new Response(JSON.stringify({
        message: "Endpoint not yet migrated to Workers",
        path: path,
        method: method,
        note: "This Express backend needs to be migrated to worktop or itty-router for Cloudflare Workers compatibility. See DEPLOYMENT.md for migration guide."
      }), {
        status: 501,
        headers: { 
          "Content-Type": "application/json",
          ...corsHeaders
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({
        error: true,
        message: error.message,
        stack: env?.NODE_ENV === 'development' ? error.stack : undefined,
      }), {
        status: 500,
        headers: { 
          "Content-Type": "application/json",
          ...corsHeaders
        },
      });
    }
  },
};

