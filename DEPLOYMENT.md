# Cloudflare Deployment Guide

## Important Notes

⚠️ **Express.js and Cloudflare Workers Compatibility**

Your current Express.js backend is not directly compatible with Cloudflare Workers/Pages. Cloudflare Workers use the Fetch API, not Node.js HTTP, which means:

1. **Express doesn't work directly** - Express uses Node.js-specific APIs
2. **Prisma needs connection pooling** - Direct database connections don't work in Workers
3. **Some Node.js modules may not work** - Workers have a limited runtime

## Deployment Options

### Option 1: Deploy as Cloudflare Worker (Current Setup)

The current setup uses `wrangler deploy` which deploys as a Cloudflare Worker. However, your Express app needs to be adapted.

**Current Status:**
- ✅ `wrangler.toml` configured
- ✅ `worker.js` entry point created
- ⚠️ Express routes need to be adapted for Workers

**Next Steps:**
1. Consider migrating to `worktop` or `itty-router` (Workers-compatible routers)
2. Set up Prisma with connection pooling (Prisma Data Proxy or PgBouncer)
3. Test all routes in the Workers environment

### Option 2: Use Cloudflare Pages Functions

Cloudflare Pages supports serverless functions. You would need to:
1. Convert routes to Pages Functions format
2. Place functions in a `functions/` directory
3. Use `wrangler pages deploy` instead of `wrangler deploy`

### Option 3: Use Alternative Platforms (Recommended for Express)

For Express.js backends, consider these platforms:
- **Railway** - Easy Express deployment
- **Render** - Free tier available
- **Vercel** - Good for Node.js apps
- **Fly.io** - Docker-based deployment

## Current Configuration

### wrangler.toml
- Worker name: `aivox-dashboard-backend`
- Entry point: `src/worker.js`
- Node.js compatibility enabled

### Environment Variables

Set these in Cloudflare Dashboard → Workers → Your Worker → Settings → Variables:

- `DATABASE_URL` - PostgreSQL connection string (use connection pooling!)
- `RETELL_API_KEY` - Your Retell API key
- `JWT_SECRET` - Secret for JWT signing
- `API_AUTH_KEY` - API key for authentication
- `NODE_ENV` - Set to "production"
- `ALLOWED_ORIGINS` - Comma-separated list of allowed origins

### Prisma Configuration for Workers

⚠️ **Important**: Prisma needs connection pooling for Cloudflare Workers. Options:

1. **Prisma Data Proxy** (Recommended)
   - Set up Prisma Data Proxy
   - Use the proxy URL as `DATABASE_URL`

2. **PgBouncer** (Alternative)
   - Use a connection pooler like PgBouncer
   - Update `DATABASE_URL` to point to the pooler

3. **Direct Connection** (Not Recommended)
   - May cause connection issues in Workers
   - Not suitable for production

## Deployment Commands

### Deploy to Cloudflare Workers
```bash
npm run deploy
# or
npx wrangler deploy
```

### Deploy to Cloudflare Pages
```bash
npm run deploy:pages
# or
npx wrangler pages deploy
```

## Troubleshooting

### Issue: Deployment hangs
- Check your `wrangler.toml` configuration
- Ensure all environment variables are set
- Verify the entry point file exists

### Issue: Routes not working
- Express routes need to be adapted for Workers
- Consider using `worktop` or `itty-router` for Workers compatibility

### Issue: Database connection errors
- Ensure you're using connection pooling
- Check your `DATABASE_URL` format
- Verify database is accessible from Cloudflare Workers

## Migration Path

If you want to fully migrate to Cloudflare Workers:

1. **Replace Express with worktop or itty-router**
2. **Adapt all routes** to use the new router
3. **Set up Prisma Data Proxy** for database connections
4. **Test all endpoints** in the Workers environment
5. **Update middleware** to work with Fetch API

This is a significant refactor but will provide better performance on Cloudflare.

