# API Implementation Summary

This document lists all the APIs that have been implemented in the AI Vox Dashboard Backend.

## Authentication APIs (`/api/auth`)

### Existing APIs
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login  
- `GET /api/auth/me` - Get current user profile

---

## Dashboard APIs (`/api/dashboard`)

All dashboard APIs require authentication (JWT token or API key).

### Existing APIs
- `POST /api/dashboard/sync-calls` - Sync calls from Retell API
- `GET /api/dashboard/agent-info/:agentId` - Get single agent info
- `GET /api/dashboard/call-history/:agentId` - Get paginated call history for an agent

---

## Newly Implemented APIs

### 1. Agent Management APIs

#### `GET /api/dashboard/agents`
List all agents with pagination and filtering.

**Query Parameters:**
- `limit` (optional): Number of agents per page (1-100, default: 20)
- `offset` (optional): Number of agents to skip (default: 0)
- `status` (optional): Filter by status ("ACTIVE" or "INACTIVE")
- `search` (optional): Search by agent name or ID

**Response:**
```json
{
  "success": true,
  "data": {
    "agents": [...],
    "pagination": {
      "total": 50,
      "limit": 20,
      "offset": 0,
      "hasMore": true
    }
  }
}
```

#### `POST /api/dashboard/agents`
Create a new agent.

**Request Body:**
```json
{
  "agent_id": "agent_123",
  "agent_name": "Customer Service Agent",
  "status": "ACTIVE"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "...",
    "agent_id": "agent_123",
    "agent_name": "Customer Service Agent",
    "status": "ACTIVE",
    "created_at": "...",
    "updated_at": "..."
  }
}
```

#### `PUT /api/dashboard/agents/:agentId`
Update agent details.

**Request Body:**
```json
{
  "agent_name": "Updated Name",
  "status": "INACTIVE"
}
```

#### `DELETE /api/dashboard/agents/:agentId`
Deactivate an agent (soft delete by setting status to INACTIVE).

#### `POST /api/dashboard/sync-agents`
Sync agents from Retell API to database.

**Response:**
```json
{
  "success": true,
  "message": "Agent sync completed",
  "agentsSynced": 10,
  "agentsUpdated": 5,
  "errors": 0
}
```

---

### 2. Call Management APIs

#### `GET /api/dashboard/calls`
List all calls with filters and pagination.

**Query Parameters:**
- `limit` (optional): Number of calls per page (1-100, default: 20)
- `offset` (optional): Number of calls to skip (default: 0)
- `agentId` (optional): Filter by agent ID
- `startDate` (optional): Filter by start date (ISO date string)
- `endDate` (optional): Filter by end date (ISO date string)
- `callStatus` (optional): Filter by call status
- `sortBy` (optional): Sort by "date", "duration", or "cost" (default: "date")

**Response:**
```json
{
  "success": true,
  "data": {
    "calls": [...],
    "pagination": {
      "total": 1000,
      "limit": 20,
      "offset": 0,
      "hasMore": true
    }
  }
}
```

#### `GET /api/dashboard/calls/:callId`
Get detailed call information by call ID.

**Response:**
```json
{
  "success": true,
  "data": {
    "call_id": "...",
    "agent_id": "...",
    "transcript": "...",
    "cost": 0.50,
    "call_successful": true,
    "agent": {
      "agent_id": "...",
      "agent_name": "..."
    },
    ...
  }
}
```

#### `GET /api/dashboard/call-history`
Get call history across all agents (without agent filter).

**Query Parameters:**
- `limit` (optional): Number of calls per page (1-100, default: 20)
- `offset` (optional): Number of calls to skip (default: 0)
- `sortBy` (optional): Sort by "date", "duration", or "cost" (default: "date")

---

### 3. Analytics/Reporting APIs

#### `GET /api/dashboard/analytics/overview`
Get dashboard overview statistics.

**Query Parameters:**
- `startDate` (optional): Start date for filtering (ISO date string)
- `endDate` (optional): End date for filtering (ISO date string)
- `agentId` (optional): Filter by agent ID

**Response:**
```json
{
  "success": true,
  "data": {
    "totalCalls": 1000,
    "totalCost": 500.00,
    "avgCost": 0.50,
    "successfulCalls": 850,
    "successRate": 85.0,
    "totalAgents": 10,
    "totalDurationSeconds": 36000,
    "avgDurationSeconds": 36,
    "callsByStatus": {
      "ended": 850,
      "failed": 150
    }
  }
}
```

#### `GET /api/dashboard/analytics/agents`
Get agent performance metrics.

**Query Parameters:**
- `startDate` (optional): Start date for filtering
- `endDate` (optional): End date for filtering

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "agent_id": "agent_123",
      "agent_name": "Customer Service",
      "totalCalls": 100,
      "successfulCalls": 85,
      "successRate": 85.0,
      "totalCost": 50.00,
      "avgCost": 0.50,
      "totalDurationSeconds": 3600,
      "avgDurationSeconds": 36
    },
    ...
  ]
}
```

#### `GET /api/dashboard/analytics/calls`
Get call analytics and trends with daily statistics.

**Query Parameters:**
- `startDate` (optional): Start date (defaults to 30 days ago)
- `endDate` (optional): End date (defaults to now)
- `agentId` (optional): Filter by agent ID

**Response:**
```json
{
  "success": true,
  "data": {
    "dateRange": {
      "start": "2024-01-01T00:00:00.000Z",
      "end": "2024-01-31T23:59:59.999Z"
    },
    "summary": {
      "totalCalls": 1000,
      "successfulCalls": 850,
      "successRate": 85.0,
      "totalCost": 500.00,
      "avgCost": 0.50,
      "totalDurationSeconds": 36000,
      "avgDurationSeconds": 36
    },
    "dailyStats": [
      {
        "date": "2024-01-01",
        "totalCalls": 50,
        "successfulCalls": 45,
        "totalCost": 25.00,
        "totalDuration": 1800
      },
      ...
    ]
  }
}
```

#### `GET /api/dashboard/analytics/sentiment`
Get sentiment analysis summary.

**Query Parameters:**
- `startDate` (optional): Start date for filtering
- `endDate` (optional): End date for filtering
- `agentId` (optional): Filter by agent ID

**Response:**
```json
{
  "success": true,
  "data": {
    "totalCallsWithSentiment": 800,
    "sentimentDistribution": {
      "positive": {
        "count": 600,
        "percentage": 75
      },
      "neutral": {
        "count": 150,
        "percentage": 18.75
      },
      "negative": {
        "count": 50,
        "percentage": 6.25
      }
    }
  }
}
```

---

### 4. User Management APIs (Admin Only)

All user management APIs require admin authentication.

#### `GET /api/dashboard/users`
List all users (admin only).

**Query Parameters:**
- `limit` (optional): Number of users per page (1-100, default: 20)
- `offset` (optional): Number of users to skip (default: 0)
- `role` (optional): Filter by role ("USER" or "ADMIN")
- `search` (optional): Search by email or name

#### `GET /api/dashboard/users/:userId`
Get user details (admin only).

#### `PUT /api/dashboard/users/:userId`
Update user (admin only).

**Request Body:**
```json
{
  "name": "Updated Name",
  "role": "ADMIN"
}
```

**Note:** Admins cannot remove their own admin role.

#### `DELETE /api/dashboard/users/:userId`
Delete user (admin only).

**Note:** Admins cannot delete their own account.

---

### 5. Utility/Status APIs

#### `GET /api/dashboard/stats`
Get quick statistics.

**Response:**
```json
{
  "success": true,
  "data": {
    "agents": {
      "total": 50,
      "active": 45,
      "inactive": 5
    },
    "calls": {
      "total": 10000
    },
    "cost": {
      "total": 5000.00
    }
  }
}
```

#### `GET /api/dashboard/sync-status`
Get sync status information.

**Response:**
```json
{
  "success": true,
  "data": {
    "calls": {
      "lastSynced": "2024-01-15T10:30:00.000Z"
    },
    "agents": {
      "lastSynced": "2024-01-15T10:25:00.000Z"
    }
  }
}
```

---

### 6. Search/Filter APIs

#### `GET /api/dashboard/search/calls`
Search calls by transcript, caller info, call summary, or call ID.

**Query Parameters:**
- `query` (required): Search query string (1-500 characters)
- `limit` (optional): Number of results per page (1-100, default: 20)
- `offset` (optional): Number of results to skip (default: 0)
- `agentId` (optional): Filter by agent ID

**Response:**
```json
{
  "success": true,
  "data": {
    "calls": [...],
    "pagination": {
      "total": 50,
      "limit": 20,
      "offset": 0,
      "hasMore": true
    }
  }
}
```

#### `GET /api/dashboard/search/agents`
Search agents by name or ID.

**Query Parameters:**
- `query` (required): Search query string (1-200 characters)
- `limit` (optional): Number of results per page (1-100, default: 20)
- `offset` (optional): Number of results to skip (default: 0)

---

## Authentication

All dashboard APIs require authentication via:
- JWT token: `Authorization: Bearer <token>`
- API key: `x-api-key: <api-key>`

User management APIs additionally require admin role (JWT with `role: "ADMIN"`).

---

## Error Responses

All APIs return consistent error responses:

```json
{
  "error": true,
  "message": "Error description"
}
```

Common HTTP status codes:
- `400`: Bad Request (validation errors)
- `401`: Unauthorized (missing or invalid credentials)
- `403`: Forbidden (insufficient permissions)
- `404`: Not Found (resource not found)
- `500`: Internal Server Error

---

## Notes

1. **Case-Insensitive Search**: Search endpoints use case-insensitive matching for PostgreSQL.
2. **BigInt Timestamps**: Call timestamps are stored as BigInt and converted to numbers in API responses.
3. **Pagination**: All list endpoints support pagination with `limit` and `offset` parameters.
4. **Date Filtering**: Date parameters accept ISO 8601 date strings.
5. **Soft Delete**: Agent deletion sets status to INACTIVE rather than removing the record.

