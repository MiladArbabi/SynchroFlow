# Specter: HTTP API Reference

## Overview

Specter provides a comprehensive HTTP API for both operational state management and customer intelligence. This document covers all available endpoints, request/response formats, authentication, and usage examples.

## Base Information

### Base URL

```
https://api.yourdomain.com/api/v1/specter
```

### Authentication

All endpoints require Bearer token authentication:

```http
Authorization: Bearer {access_token}
```

### Common Headers

```http
Content-Type: application/json
Accept: application/json
X-Request-ID: {unique_request_id}  # Optional for tracing
X-Shop-ID: {shop_id}               # Required for shop-scoped endpoints
```

### Response Formats

#### Success Response

```json
{
  "data": { ... },
  "meta": {
    "requestId": "req_123",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

#### Error Response

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": { ... }  // Optional additional context
  },
  "meta": {
    "requestId": "req_123",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

### Common Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request (validation error) |
| 401 | Unauthorized (invalid/missing token) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Resource not found |
| 429 | Too many requests (rate limited) |
| 500 | Internal server error |

## Core State Management API

### Get Shop State

Retrieves the complete current state of a shop including sessions, events, and configuration.

```http
GET /:shopId/state
```

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `include` | string | No | `all` | Comma-separated list: `sessions,events,config,meta` |
| `eventLimit` | integer | No | 50 | Maximum number of events to return |
| `sessionLimit` | integer | No | 1000 | Maximum number of sessions to return |
| `since` | ISO timestamp | No | null | Only return data updated after this timestamp |

#### Response

```json
{
  "data": {
    "shopId": 42,
    "session": {
      "sessionId": "s-abc123",
      "shopId": 42,
      "landingPage": "/products/widget",
      "pagesViewed": ["/products/widget", "/cart"],
      "exitIntent": true,
      "createdAt": "2024-01-15T10:30:00Z"
    },
    "config": {
      "sync_frequency": "hourly",
      "retry_policy": {
        "max_attempts": 3,
        "backoff_ms": 5000
      },
      "event_ttl_days": 30,
      "session_ttl_days": 7
    },
    "events": [
      {
        "type": "sync.complete",
        "timestamp": 1705300200000,
        "payload": {
          "durationMs": 2450,
          "itemsSynced": 42,
          "success": true
        }
      },
      {
        "type": "canonical.ingested",
        "timestamp": 1705300000000,
        "payload": {
          "orderCount": 1,
          "totalValue": 99.99,
          "platform": "shopify"
        }
      }
    ],
    "meta": {
      "sessionCount": 15,
      "lastSync": 1705300200000,
      "lastIngestion": 1705300000000,
      "currentState": "HEALTHY",
      "stateSince": "2024-01-15T10:20:00Z"
    }
  },
  "meta": {
    "requestId": "req_123",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

#### Example Usage

```bash
curl -X GET \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.yourdomain.com/api/v1/specter/42/state?eventLimit=10&include=sessions,events"
```

### Get Shop Events

Retrieve paginated event history for a shop.

```http
GET /:shopId/events
```

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `limit` | integer | No | 50 | Number of events to return (max 1000) |
| `offset` | integer | No | 0 | Pagination offset |
| `type` | string | No | null | Filter by event type |
| `since` | ISO timestamp | No | null | Events after this timestamp |
| `until` | ISO timestamp | No | null | Events before this timestamp |

#### Response

```json
{
  "data": {
    "events": [
      {
        "type": "sync.complete",
        "timestamp": 1705300200000,
        "payload": { ... }
      }
    ],
    "pagination": {
      "total": 150,
      "limit": 50,
      "offset": 0,
      "hasMore": true
    }
  },
  "meta": { ... }
}
```

### Get Shop Sessions

Retrieve paginated session history for a shop.

```http
GET /:shopId/sessions
```

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `limit` | integer | No | 100 | Number of sessions to return (max 1000) |
| `offset` | integer | No | 0 | Pagination offset |
| `since` | ISO timestamp | No | null | Sessions created after this timestamp |
| `until` | ISO timestamp | No | null | Sessions created before this timestamp |
| `hasExitIntent` | boolean | No | null | Filter by exit intent presence |

#### Response

```json
{
  "data": {
    "sessions": [
      {
        "sessionId": "s-abc123",
        "shopId": 42,
        "landingPage": "/products/widget",
        "pagesViewed": ["/products/widget", "/cart"],
        "exitIntent": true,
        "createdAt": "2024-01-15T10:30:00Z"
      }
    ],
    "summary": {
      "totalSessions": 150,
      "exitIntentSessions": 45,
      "exitIntentRate": 0.3,
      "avgPagesPerSession": 2.5
    },
    "pagination": {
      "total": 150,
      "limit": 100,
      "offset": 0,
      "hasMore": true
    }
  },
  "meta": { ... }
}
```

## Configuration Management API

### Get Shop Configuration

Retrieve the current configuration for a shop.

```http
GET /config
```

#### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `X-Shop-ID` | Yes | The shop identifier |

#### Response

```json
{
  "data": {
    "config": {
      "sync_frequency": "hourly",
      "retry_policy": {
        "max_attempts": 3,
        "backoff_ms": 5000
      },
      "allowed_platforms": ["shopify", "woocommerce"],
      "event_ttl_days": 30,
      "session_ttl_days": 7,
      "nudge_settings": {
        "enabled": true,
        "max_daily_nudges": 10,
        "channels": ["onsite"],
        "safety_rules": {
          "no_discounts": true,
          "max_frequency_minutes": 30
        }
      }
    },
    "source": "redis", // or "database", "default"
    "lastUpdated": "2024-01-15T10:30:00Z",
    "validUntil": "2024-02-15T10:30:00Z" // if TTL exists
  },
  "meta": { ... }
}
```

### Update Shop Configuration

Update or create shop configuration.

```http
PUT /config
```

#### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `X-Shop-ID` | Yes | The shop identifier |

#### Request Body

```json
{
  "config": {
    "sync_frequency": "daily",
    "retry_policy": {
      "max_attempts": 5,
      "backoff_ms": 10000
    },
    "nudge_settings": {
      "enabled": true,
      "max_daily_nudges": 20
    }
  },
  "merge": true, // Optional: merge with existing config (default: false)
  "validate": true // Optional: validate config before saving (default: true)
}
```

#### Response

```json
{
  "data": {
    "config": { ... }, // Full config after update
    "changes": {
      "updated": ["sync_frequency", "retry_policy.max_attempts"],
      "added": [],
      "removed": []
    },
    "warnings": [
      "nudge_settings.max_daily_nudges exceeds recommended limit"
    ]
  },
  "meta": { ... }
}
```

### Partial Configuration Update

Update specific configuration fields.

```http
PATCH /config
```

#### Request Body

```json
{
  "updates": {
    "sync_frequency": "hourly",
    "retry_policy.backoff_ms": 15000
  },
  "validate": true
}
```

#### Response

Same as PUT response.

### Validate Configuration

Validate configuration without saving.

```http
POST /config/validate
```

#### Request Body

```json
{
  "config": { ... } // Configuration to validate
}
```

#### Response

```json
{
  "data": {
    "valid": true,
    "errors": [],
    "warnings": [
      {
        "field": "nudge_settings.max_daily_nudges",
        "message": "Value exceeds recommended limit",
        "severity": "warning"
      }
    ]
  },
  "meta": { ... }
}
```

## Customer Intelligence API

### Nudge Recommendation Request

Request a nudge recommendation for a customer session.

```http
POST /nudge-recommendation
```

#### Request Body

```json
{
  "shopId": 42,
  "session": {
    "landingPage": "/products/widget",
    "pagesViewed": ["/products/widget", "/cart"],
    "exitIntent": true
    // Note: customerId is NOT allowed here (PCD compliance)
  },
  "context": {
    "device": "mobile",
    "locale": "en-US",
    "timezone": "America/New_York"
  },
  "options": {
    "preferredChannel": "onsite",
    "maxLatencyMs": 100,
    "includeReasoning": true
  }
}
```

#### Response

```json
{
  "data": {
    "recommendation": {
      "shopId": 42,
      "sessionId": "s-abc123",
      "channel": "onsite",
      "nudgeType": "REMINDER",
      "offer": {
        "type": "NONE",
        "value": 0,
        "expiration": null,
        "conditions": []
      },
      "messageKey": "specter.exit_intent.reminder",
      "reason": "Exit intent detected on high-value product page",
      "expectedLift": 0.05,
      "marginImpactEstimate": 0,
      "confidence": 0.75
    },
    "executionRequest": {
      "recommendation": { ... },
      "sessionContext": {
        "sessionId": "s-abc123",
        "shopId": 42,
        "landingPage": "/products/widget",
        "pagesViewed": ["/products/widget", "/cart"],
        "exitIntent": true,
        "createdAt": "2024-01-15T10:30:00Z"
      },
      "customerContext": {
        "shopId": 42,
        "hashedCustomerId": "anon_xyz789",
        "specterCustomerTier": "CORE",
        "predictedLTV": 500,
        "churnRisk": 0.2,
        "priceSensitivity": 0.3,
        "returnsRisk": 0.1,
        "updatedAt": "2024-01-15T10:25:00Z"
      },
      "executionDeadline": "2024-01-15T10:30:05Z"
    },
    "meta": {
      "processingTimeMs": 45,
      "signalSource": "default",
      "signalConfidence": 0.1,
      "degradationApplied": false
    }
  },
  "meta": { ... }
}
```

#### Alternative Response (No Recommendation)

```json
{
  "data": null,
  "meta": {
    "reason": "No suitable nudge opportunity identified",
    "processingTimeMs": 32
  }
}
```

### Batch Nudge Recommendations

Request nudge recommendations for multiple sessions.

```http
POST /nudge-recommendations/batch
```

#### Request Body

```json
{
  "requests": [
    {
      "shopId": 42,
      "session": { ... },
      "context": { ... }
    },
    {
      "shopId": 42,
      "session": { ... },
      "context": { ... }
    }
  ],
  "options": {
    "parallelProcessing": true,
    "timeoutMs": 500
  }
}
```

#### Response

```json
{
  "data": {
    "results": [
      {
        "requestIndex": 0,
        "recommendation": { ... },
        "error": null
      },
      {
        "requestIndex": 1,
        "recommendation": null,
        "error": {
          "code": "NO_OPPORTUNITY",
          "message": "No exit intent detected"
        }
      }
    ],
    "summary": {
      "total": 2,
      "successful": 1,
      "failed": 1,
      "averageProcessingTimeMs": 48
    }
  },
  "meta": { ... }
}
```

## Shop State Machine API (FT1)

### Get Current State

Get the current state machine state for a shop.

```http
GET /:shopId/state-machine
```

#### Response

```json
{
  "data": {
    "currentState": "HEALTHY",
    "stateSince": "2024-01-15T10:20:00Z",
    "previousState": "SYNCING",
    "lastTransition": {
      "from": "SYNCING",
      "to": "HEALTHY",
      "trigger": "sync.complete",
      "timestamp": "2024-01-15T10:20:00Z",
      "reason": "Sync completed successfully"
    },
    "stateDurationMs": 600000, // 10 minutes in current state
    "metadata": {
      "activeSyncs": 0,
      "pendingIngestions": 2,
      "errorCount24h": 0
    }
  },
  "meta": { ... }
}
```

### Get State History

Get the history of state transitions.

```http
GET /:shopId/state-machine/history
```

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `limit` | integer | No | 50 | Number of transitions to return |
| `since` | ISO timestamp | No | null | Transitions after this timestamp |
| `until` | ISO timestamp | No | null | Transitions before this timestamp |

#### Response

```json
{
  "data": {
    "transitions": [
      {
        "from": "IDLE",
        "to": "SYNCING",
        "trigger": "sync.started",
        "timestamp": "2024-01-15T10:15:00Z",
        "reason": "Manual sync triggered via UI",
        "eventId": "evt_123"
      },
      {
        "from": "SYNCING",
        "to": "HEALTHY",
        "trigger": "sync.complete",
        "timestamp": "2024-01-15T10:20:00Z",
        "reason": "Sync completed successfully",
        "eventId": "evt_124"
      }
    ],
    "pagination": { ... }
  },
  "meta": { ... }
}
```

### Trigger State Transition

Manually trigger a state transition (admin only).

```http
POST /:shopId/state-machine/transitions
```

#### Request Body

```json
{
  "targetState": "PAUSED",
  "reason": "Manual pause for maintenance",
  "metadata": {
    "maintenanceWindow": "2024-01-15T10:30:00Z/2024-01-15T11:30:00Z",
    "initiatedBy": "admin@example.com"
  }
}
```

#### Response

```json
{
  "data": {
    "transition": {
      "from": "HEALTHY",
      "to": "PAUSED",
      "trigger": "manual.override",
      "timestamp": "2024-01-15T10:30:00Z",
      "reason": "Manual pause for maintenance",
      "metadata": {
        "initiatedBy": "admin@example.com"
      }
    },
    "validationWarnings": [
      "Shop has active syncs that will be interrupted"
    ]
  },
  "meta": { ... }
}
```

## Insights API (FT1)

### Get Insights

Retrieve insights for a shop.

```http
GET /:shopId/insights
```

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `severity` | string | No | null | Filter by severity: `info,warning,critical` |
| `status` | string | No | `active` | Filter by status: `active,resolved,dismissed` |
| `type` | string | No | null | Filter by insight type |
| `limit` | integer | No | 50 | Number of insights to return |
| `offset` | integer | No | 0 | Pagination offset |

#### Response

```json
{
  "data": {
    "insights": [
      {
        "id": "ins_123",
        "type": "STALE_INGESTION",
        "severity": "warning",
        "status": "active",
        "message": "No canonical ingestion in the last 2 hours",
        "evidence": [
          {
            "type": "event",
            "timestamp": "2024-01-15T08:30:00Z",
            "data": {
              "type": "canonical.ingested",
              "payload": { "orderCount": 1 }
            }
          }
        ],
        "recommendedActions": [
          {
            "action": "check_ingestion_worker",
            "description": "Verify ingestion worker is running",
            "priority": "high"
          }
        ],
        "createdAt": "2024-01-15T10:30:00Z",
        "updatedAt": "2024-01-15T10:30:00Z"
      }
    ],
    "summary": {
      "total": 5,
      "bySeverity": {
        "critical": 0,
        "warning": 1,
        "info": 4
      },
      "byStatus": {
        "active": 1,
        "resolved": 4
      }
    },
    "pagination": { ... }
  },
  "meta": { ... }
}
```

### Update Insight Status

Update the status of an insight.

```http
PATCH /:shopId/insights/:insightId
```

#### Request Body

```json
{
  "status": "resolved",
  "resolutionNote": "Ingestion worker restarted, events flowing again",
  "resolvedBy": "operator@example.com"
}
```

#### Response

```json
{
  "data": {
    "insight": {
      "id": "ins_123",
      "status": "resolved",
      "resolvedAt": "2024-01-15T10:35:00Z",
      "resolutionNote": "Ingestion worker restarted, events flowing again",
      "resolvedBy": "operator@example.com"
    }
  },
  "meta": { ... }
}
```

## Command API (FT1)

### Execute Command

Execute a command on a shop.

```http
POST /:shopId/commands
```

#### Request Body

```json
{
  "command": "resync",
  "parameters": {
    "platform": "shopify",
    "fullSync": false,
    "priority": "high"
  },
  "metadata": {
    "initiatedBy": "admin@example.com",
    "reason": "Data discrepancy detected",
    "timeoutSeconds": 300
  }
}
```

#### Available Commands

| Command | Description | Parameters |
|---------|-------------|------------|
| `resync` | Trigger a resync | `platform`, `fullSync`, `priority` |
| `clear_sessions` | Clear session data | `olderThan` (ISO timestamp) |
| `pause_ingestion` | Pause ingestion | `durationMinutes` |
| `resume_ingestion` | Resume ingestion | - |
| `refresh_config` | Reload configuration | - |

#### Response

```json
{
  "data": {
    "commandId": "cmd_123",
    "status": "accepted",
    "command": "resync",
    "parameters": { ... },
    "estimatedCompletion": "2024-01-15T10:35:00Z",
    "trackingUrl": "/api/v1/specter/42/commands/cmd_123"
  },
  "meta": { ... }
}
```

### Get Command Status

Check the status of a command.

```http
GET /:shopId/commands/:commandId
```

#### Response

```json
{
  "data": {
    "commandId": "cmd_123",
    "status": "completed",
    "command": "resync",
    "parameters": { ... },
    "result": {
      "success": true,
      "itemsSynced": 150,
      "durationMs": 45000,
      "errors": []
    },
    "timestamps": {
      "created": "2024-01-15T10:30:00Z",
      "started": "2024-01-15T10:30:05Z",
      "completed": "2024-01-15T10:30:50Z"
    },
    "metadata": {
      "initiatedBy": "admin@example.com"
    }
  },
  "meta": { ... }
}
```

## Behavioral Intelligence API (v2)

### Get Customer Signal

Get customer intelligence signals.

```http
GET /customer-signals/:hashedCustomerId
```

#### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `X-Shop-ID` | Yes | The shop identifier |

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `includeSources` | boolean | No | false | Include data source information |
| `refresh` | boolean | No | false | Force refresh from source systems |

#### Response

```json
{
  "data": {
    "signal": {
      "shopId": 42,
      "hashedCustomerId": "hash_abc123",
      "specterCustomerTier": "CORE",
      "predictedLTV": 500,
      "churnRisk": 0.2,
      "priceSensitivity": 0.3,
      "returnsRisk": 0.1,
      "updatedAt": "2024-01-15T10:25:00Z",
      "behavioralFingerprint": {
        "avgSessionDuration": 180,
        "pagesPerSession": 3.2,
        "exitIntentRate": 0.15,
        "conversionRate": 0.08
      }
    },
    "metadata": {
      "source": "specter+ordernexus",
      "confidence": 0.8,
      "freshness": "5 minutes",
      "dataSources": {
        "orderNexus": true,
        "skuOs": false,
        "finance": false
      }
    }
  },
  "meta": { ... }
}
```

### Get Behavioral Primitives

Get aggregated behavioral metrics for a shop.

```http
GET /:shopId/behavioral-primitives
```

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `timeWindow` | string | No | `24h` | Time window: `1h`, `24h`, `7d`, `30d` |
| `groupBy` | string | No | null | Group by: `hour`, `day`, `page` |
| `includeTrends` | boolean | No | false | Include trend calculations |

#### Response

```json
{
  "data": {
    "primitives": {
      "session_count": 1500,
      "exit_intent_count": 450,
      "exit_intent_rate": 0.3,
      "avg_session_duration_seconds": 180,
      "pages_per_session": 3.2,
      "top_exit_pages": [
        {
          "page": "/checkout",
          "exit_intent_rate": 0.45,
          "session_count": 200
        },
        {
          "page": "/products/widget",
          "exit_intent_rate": 0.35,
          "session_count": 150
        }
      ],
      "nudge_opportunities": [
        {
          "page": "/checkout",
          "exit_intent_rate": 0.45,
          "expected_lift": 0.08,
          "confidence": 0.85,
          "recommended_nudge": "REMINDER"
        }
      ]
    },
    "trends": {
      "exit_intent_rate_24h_change": 0.02,
      "session_count_7d_trend": "up"
    },
    "timeWindow": {
      "start": "2024-01-14T10:30:00Z",
      "end": "2024-01-15T10:30:00Z"
    }
  },
  "meta": { ... }
}
```

## Real-time API (WebSocket)

### Connection

```javascript
const ws = new WebSocket('wss://api.yourdomain.com/api/v1/specter/ws');

// Authentication
ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'auth',
    token: 'bearer_token_here',
    shopId: 42
  }));
};
```

### Subscribe to Events

```javascript
ws.send(JSON.stringify({
  type: 'subscribe',
  channels: ['shop_state', 'insights', 'events'],
  shopId: 42
}));
```

### Message Types

```json
{
  "type": "shop_state_update",
  "data": {
    "shopId": 42,
    "state": "HEALTHY",
    "previousState": "SYNCING",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

```json
{
  "type": "new_insight",
  "data": {
    "insight": { ... }
  }
}
```

```json
{
  "type": "event",
  "data": {
    "type": "sync.complete",
    "timestamp": 1705300200000,
    "payload": { ... }
  }
}
```

## Health and Monitoring API

### Health Check

```http
GET /health
```

#### Response

```json
{
  "data": {
    "status": "healthy",
    "timestamp": "2024-01-15T10:30:00Z",
    "components": {
      "redis": {
        "status": "healthy",
        "latency": 5
      },
      "database": {
        "status": "healthy",
        "latency": 12
      },
      "queue": {
        "status": "healthy",
        "pendingMessages": 0
      },
      "store": {
        "status": "healthy",
        "type": "redis"
      }
    },
    "metrics": {
      "uptime": 86400,
      "memoryUsage": 45.2,
      "activeConnections": 25
    }
  },
  "meta": { ... }
}
```

### Metrics (Prometheus)

```http
GET /metrics
```

Returns Prometheus-formatted metrics.

## Rate Limiting

### Limits by Endpoint

| Endpoint | Limit (per minute) | Burst |
|----------|-------------------|--------|
| State API | 100 | 20 |
| Config API | 30 | 10 |
| Nudge API | 200 | 50 |
| Command API | 20 | 5 |
| WebSocket | 1000 connections | 100 new/sec |

### Response Headers

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 85
X-RateLimit-Reset: 1610612736
Retry-After: 30  // When rate limited
```

## Error Codes

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `AUTH_REQUIRED` | 401 | Authentication required |
| `INVALID_TOKEN` | 401 | Invalid or expired token |
| `PERMISSION_DENIED` | 403 | Insufficient permissions |
| `SHOP_NOT_FOUND` | 404 | Shop not found |
| `INVALID_CONFIG` | 400 | Invalid configuration |
| `PCD_VIOLATION` | 400 | PII detected in request |
| `RATE_LIMITED` | 429 | Rate limit exceeded |
| `COMMAND_FAILED` | 500 | Command execution failed |
| `SERVICE_UNAVAILABLE` | 503 | Service temporarily unavailable |

### Error Response Example

```json
{
  "error": {
    "code": "INVALID_CONFIG",
    "message": "Configuration validation failed",
    "details": {
      "field": "sync_frequency",
      "reason": "Must be one of: hourly, daily, weekly"
    }
  },
  "meta": {
    "requestId": "req_123",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

## SDK Usage Examples

### JavaScript SDK

```javascript
import { SpecterClient } from '@synchroflow/specter-sdk';

const client = new SpecterClient({
  baseUrl: 'https://api.yourdomain.com',
  accessToken: 'your_token_here'
});

// Get shop state
const state = await client.getShopState(42, {
  include: ['events', 'sessions'],
  eventLimit: 20
});

// Request nudge recommendation
const recommendation = await client.requestNudgeRecommendation({
  shopId: 42,
  session: {
    landingPage: '/products/widget',
    pagesViewed: ['/products/widget', '/cart'],
    exitIntent: true
  }
});

// Subscribe to real-time updates
const subscription = client.subscribe(42, ['state', 'insights'], (message) => {
  console.log('Update received:', message);
});
```

### Python SDK

```python
from synchroflow_specter import SpecterClient

client = SpecterClient(
    base_url="https://api.yourdomain.com",
    access_token="your_token_here"
)

# Get behavioral primitives
primitives = client.get_behavioral_primitives(
    shop_id=42,
    time_window="24h",
    include_trends=True
)

# Update configuration
config = client.update_config(
    shop_id=42,
    config={
        "sync_frequency": "hourly",
        "nudge_settings": {
            "enabled": True,
            "max_daily_nudges": 15
        }
    },
    merge=True
)
```

## Best Practices

### 1. Request Optimization

- Use field filtering (`include` parameter) to reduce payload size
- Implement client-side caching for frequently accessed data
- Use batch endpoints for multiple operations

### 2. Error Handling

- Always check HTTP status codes
- Implement exponential backoff for retries
- Log request IDs for debugging

### 3. Security

- Never log full request/response bodies containing PII
- Rotate access tokens regularly
- Validate all inputs before sending

### 4. Performance

- Keep WebSocket connections alive for real-time updates
- Use compression for large responses
- Implement connection pooling for high-volume applications

## Migration Notes

### API Versioning

- Current version: `v1`
- Version specified in URL path
- Breaking changes will increment major version
- Deprecated endpoints will have 6-month sunset period

### Backward Compatibility

- New fields added to responses are always optional
- Old required fields are never removed, only deprecated
- Default values provided for new required fields

---

*For SDK installation and additional client libraries, refer to the SDK documentation. For integration guides and tutorials, see the integration documentation.*
