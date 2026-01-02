# AI Receptionist Dashboard Backend

A comprehensive backend API for managing AI Receptionist call data, integrating with Retell API and Supabase database.

## Features

- **Call Data Sync**: Automatically sync call data from Retell API to PostgreSQL database
- **Agent Management**: Track and manage AI agents with their status and information
- **Call History**: Paginated call history with sorting and filtering options

- **Authentication**: API key-based authentication for secure access
- **Error Handling**: Comprehensive error handling and logging
- **Rate Limiting**: Built-in rate limiting to prevent abuse

## API Endpoints

### Authentication

You can authenticate with either a JWT or an API key:

- `Authorization: Bearer <jwt>` for user-based auth
- `x-api-key: <your-api-key>` for service-level auth

### Endpoints

#### `POST /api/auth/register`

Register a new user.

Request:

```json
{ "email": "user@example.com", "password": "strongpassword", "name": "Jane" }
```

Response:

```json
{
  "success": true,
  "data": { "id": "...", "email": "user@example.com" },
  "token": "<jwt>"
}
```

#### `POST /api/auth/login`

Login and receive a JWT.

Request:

```json
{ "email": "user@example.com", "password": "strongpassword" }
```

Response:

```json
{ "success": true, "token": "<jwt>" }
```

#### `GET /api/auth/me`

Return the authenticated user's profile. Requires `Authorization: Bearer <jwt>`.

#### `POST /api/dashboard/sync-calls`

Syncs call data from Retell API to the database.

**Request Body:**

```json
{
  "agentId": "optional" // Optional agent ID filter
}
```

**Response:**

```json
{
  "success": true,
  "message": "Call sync completed",
  "callsSynced": 15,
  "callsUpdated": 3,
  "errors": 0
}
```

## Netlify Deployment

This backend is deployed as a Netlify Function using `netlify.toml`.

### Netlify UI settings (for GitHub deploy)

If this backend lives inside a monorepo:

- **Base directory**: `ai-vox-dashboard-backend`
- **Build command**: `npm run db:generate`
- **Publish directory**: (leave blank)
- **Functions directory**: `netlify/functions`

### Environment variables (Netlify → Site settings → Environment variables)

Set these in Netlify (use your real values):

- `DATABASE_URL`
- `RETELL_API_KEY`
- `API_AUTH_KEY`
- `JWT_SECRET`
- `NODE_ENV=production`
- `ALLOWED_ORIGINS` (optional, comma-separated)

#### `GET /api/dashboard/agent-info/:agentId`

Returns basic agent information.

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "agent-uuid",
    "agent_id": "agent_123",
    "agent_name": "Customer Service Agent",
    "status": "ACTIVE",
    "created_at": "2024-01-01T00:00:00.000Z",
    "updated_at": "2024-01-01T00:00:00.000Z"
  }
}
```

#### `GET /api/dashboard/call-history/:agentId`

Returns paginated call history for an agent.

**Query Parameters:**

- `limit`: Number of calls per page (1-100, default: 20)
- `offset`: Number of calls to skip (default: 0)
- `sortBy`: Sort by `date`, `duration`, or `cost` (default: date)

**Response:**

```json
{
  "success": true,
  "data": {
    "calls": [...],
    "pagination": {
      "total": 150,
      "limit": 20,
      "offset": 0,
      "hasMore": true
    }
  }
}
```

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Configuration

Copy `env.example` to `.env` and configure:

```bash
cp env.example .env
```

Required environment variables:

- `DATABASE_URL`: PostgreSQL connection string
- `RETELL_API_KEY`: Your Retell API key
- `API_AUTH_KEY`: API key for authentication
- `JWT_SECRET`: Secret for signing JWTs
- `PORT`: Server port (default: 3000)

### 3. Database Setup

```bash
# Generate Prisma client
npm run db:generate

# Apply schema to database (Supabase/Postgres)
npm run db:migrate
```

### 4. Start the Server

```bash
# Development
npm run dev

# Production
npm start
```

## Database Schema

### Agents Table

- `id`: Primary key (UUID)
- `agent_id`: Unique agent identifier from Retell
- `agent_name`: Human-readable agent name
- `status`: Agent status (ACTIVE/INACTIVE)
- `created_at`: Creation timestamp
- `updated_at`: Last update timestamp

### Calls Table

- `id`: Primary key (UUID)
- `agent_id`: Foreign key to agents table
- `call_id`: Unique call identifier from Retell
- `caller_info`: Optional caller information
- `start_timestamp`: Call start time (BigInt milliseconds)
- `end_timestamp`: Call end time (BigInt milliseconds)
- `duration_ms`: Call duration in milliseconds
- `duration_seconds`: Call duration in seconds
- `transcript`: Optional call transcript
- `call_status`: Call status from Retell
- `disconnection_reason`: Optional disconnection reason
- `cost`: Call cost from Retell
- `call_summary`: Optional call summary
- `user_sentiment`: Optional user sentiment
- `call_successful`: Boolean success indicator
- `recording_url`: Optional recording URL
- `created_at`: Creation timestamp
- `updated_at`: Last update timestamp

## Error Handling

The API returns consistent error responses:

```json
{
  "error": true,
  "message": "Error description",
  "stack": "..." // Only in development
}
```

Common HTTP status codes:

- `400`: Bad Request (validation errors)
- `401`: Unauthorized (invalid API key)
- `404`: Not Found (resource not found)
- `500`: Internal Server Error

## Logging

Logs are written to:

- Console (development)
- `logs/combined.log` (all logs)
- `logs/error.log` (errors only)
- `logs/exceptions.log` (uncaught exceptions)
- `logs/rejections.log` (unhandled rejections)

## Rate Limiting

- 100 requests per 15 minutes per IP address
- Configurable via environment variables

## Security Features

- Helmet.js for security headers
- CORS configuration
- API key authentication
- Input validation with Joi
- SQL injection protection via Prisma
- Rate limiting

## Development

### Prisma Studio

```bash
npm run db:studio
```

### Database Migrations

```bash
npm run db:migrate
```

### Logs

Check the `logs/` directory for application logs.

## Production Deployment

1. Set `NODE_ENV=production`
2. Configure production database URL
3. Set up proper logging
4. Configure reverse proxy (nginx)
5. Set up SSL certificates
6. Configure monitoring and alerting

## Support

For issues and questions, please check the logs and ensure all environment variables are properly configured.
