# MarginCore – Public APIs (v1)

## Authentication & Authorization
All endpoints require JWT authentication with appropriate roles.

**Available Roles:**
- `ROLE_FINANCE_ADMIN` - Shop-scoped financial administration
- `ROLE_PLATFORM_ADMIN` - Cross-shop administration for high-risk operations

## Admin Endpoints

### 1. Create Draft Cost Model
Creates a new draft cost model for a shop.

```http
POST /api/finance/v1/shops/{shopId}/cost-models/draft
Authorization: Bearer <JWT with ROLE_FINANCE_ADMIN>
Content-Type: application/json

{
  "currency": "USD",
  "shippingCostModelId": "default_flat_10",
  "handlingCostPerOrder": 3.5,
  "packagingCostPerUnit": 0.75,
  "paymentFeePercent": 2.9,
  "paymentFeeFixed": 0.3,
  "overheadAllocationPercent": 15,
  "taxRatePercent": 0,
  "minAcceptableMarginPercent": 10,
  "maxCostToServePercentOfRevenue": 40,
  "notes": "Stripe fee change Jan 2025"
}
```

**Response (201 Created):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "shopId": 12345,
  "status": "draft",
  "snapshot": {
    "shopId": 12345,
    "currency": "USD",
    "shippingCostModelId": "default_flat_10",
    "handlingCostPerOrder": 3.5,
    "packagingCostPerUnit": 0.75,
    "paymentFeePercent": 2.9,
    "paymentFeeFixed": 0.3,
    "overheadAllocationPercent": 15,
    "taxRatePercent": 0,
    "minAcceptableMarginPercent": 10,
    "maxCostToServePercentOfRevenue": 40,
    "updatedAt": "2025-01-10T12:00:00Z"
  },
  "versionId": null,
  "source": "finance",
  "createdBy": "user@example.com",
  "createdAt": "2025-01-10T12:00:00Z",
  "notes": "Stripe fee change Jan 2025"
}
```

**Error Responses:**
- `400 Bad Request` - Invalid cost model data
- `401 Unauthorized` - Missing or invalid authentication
- `403 Forbidden` - Insufficient permissions for the shop
- `409 Conflict` - Draft already exists (optional constraint)

### 2. Activate Cost Model
Activates a draft cost model with specified recomputation strategy.

```http
POST /api/finance/v1/cost-models/{costModelId}/activate
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "strategy": {
    "scope": "all_orders_since",
    "since": "2025-01-01T00:00:00Z"
  }
}
```

**Recomputation Strategy Options:**
```json
// No recomputation - only new orders use the new model
{"strategy": {"scope": "none"}}

// Only new orders use the model (default)
{"strategy": {"scope": "new_orders_only"}}

// Recompute orders since specific date
{"strategy": {"scope": "all_orders_since", "since": "2025-01-01T00:00:00Z"}}
```

**Response (200 OK):**
```json
{
  "snapshot": {
    "shopId": 12345,
    "currency": "USD",
    "shippingCostModelId": "default_flat_10",
    "handlingCostPerOrder": 3.5,
    "packagingCostPerUnit": 0.75,
    "paymentFeePercent": 2.9,
    "paymentFeeFixed": 0.3,
    "overheadAllocationPercent": 15,
    "taxRatePercent": 0,
    "minAcceptableMarginPercent": 10,
    "maxCostToServePercentOfRevenue": 40,
    "updatedAt": "2025-01-10T12:00:00Z"
  },
  "versioning": {
    "versionId": "finance:2025-01-10T12:00:00Z",
    "source": "finance",
    "updatedAt": "2025-01-10T12:00:00Z",
    "recomputationScope": "all_orders_since",
    "recomputationSince": "2025-01-01T00:00:00Z"
  }
}
```

**Error Responses:**
- `400 Bad Request` - Invalid recomputation strategy
- `401 Unauthorized` - Missing or invalid authentication
- `403 Forbidden` - Insufficient permissions for the operation
- `404 Not Found` - Cost model not found
- `409 Conflict` - Model already active or invalid state

### 3. List Cost Models
Retrieves all cost models for a shop.

```http
GET /api/finance/v1/shops/{shopId}/cost-models
Authorization: Bearer <JWT with ROLE_FINANCE_ADMIN>
```

**Response (200 OK):**
```json
{
  "models": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "shopId": 12345,
      "status": "active",
      "snapshot": {...},
      "versionId": "finance:2025-01-10T12:00:00Z",
      "source": "finance",
      "createdBy": "user@example.com",
      "createdAt": "2025-01-10T12:00:00Z",
      "activatedAt": "2025-01-10T12:00:00Z"
    },
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "shopId": 12345,
      "status": "draft",
      "snapshot": {...},
      "versionId": null,
      "source": "finance",
      "createdBy": "user@example.com",
      "createdAt": "2025-01-09T12:00:00Z"
    }
  ]
}
```

### 4. Get Cost Model Details
Retrieves specific cost model details.

```http
GET /api/finance/v1/cost-models/{costModelId}
Authorization: Bearer <JWT with ROLE_FINANCE_ADMIN>
```

## Internal Endpoints

### Finance Client API
Used by OrderNexus to fetch active cost models.

```http
GET /internal/finance/v1/shops/{shopId}/cost-model
Authorization: Bearer <internal-service-token>
```

**Response:**
- `200 OK` with `CostModelSnapshot` if active model exists
- `200 OK` with `null` body if no active model

**Performance:** This endpoint is heavily cached (Redis) with 5-minute TTL.

## RBAC Matrix

| Operation | Strategy Scope | Required Role | Notes |
|-----------|----------------|---------------|-------|
| Create draft | N/A | `ROLE_FINANCE_ADMIN` | Must have access to shop |
| Activate | `none` | `ROLE_FINANCE_ADMIN` | Low impact |
| Activate | `new_orders_only` | `ROLE_FINANCE_ADMIN` | Low impact |
| Activate | `all_orders_since` (≤ 30 days) | `ROLE_FINANCE_ADMIN` | Medium impact |
| Activate | `all_orders_since` (> 30 days) | `ROLE_PLATFORM_ADMIN` | High impact |
| Activate | `all_orders_since` (above quota) | `ROLE_PLATFORM_ADMIN` | High impact |
| List models | N/A | `ROLE_FINANCE_ADMIN` | Shop-scoped |

## Rate Limiting
- Admin endpoints: 10 requests/minute per user
- Internal endpoints: 100 requests/minute per service
- Activation endpoints: 5 requests/hour per shop (additional guardrails in `RecomputationGuard`)