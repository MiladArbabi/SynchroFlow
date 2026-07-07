# LaSyncro — Carrier Integration Blueprint

**Location:** `docs/blueprints/CarrierIntegration.md`
**Created:** June 3, 2026
**Status:** WM-38 ✅ LIVE — WM-39 ✅ LIVE — WM-40 ✅ LIVE (Sendcloud + Shippo) — WM-41 through WM-45 📋 PLANNED

---

## 1. Strategic Context

### 1.1 The SMB Fragmentation Problem

LaSyncro's target audience — SMB commerce doing £100K–£50M annually, 1–20 warehouse operators, fulfilling from their own storage, high SKU complexity — runs their operation across four disconnected systems:

| System | What it sees | What it is blind to |
|---|---|---|
| Shopify | Orders, revenue, customers | Warehouse reality, shipping cost, true margin |
| Sendcloud / carrier portal | Parcels, labels, tracking | Order context, inventory, margin impact |
| Excel / Google Sheets | Pick lists, manual counts | Real-time state, exceptions, performance |
| WhatsApp / Slack | Firefighting, ad-hoc decisions | Structured data, patterns, history |

**The owner is the integration layer.** Every day they are the human API between four systems — re-entering data, reconciling discrepancies, answering "where is my order?" from customers, and making margin decisions based on gut feel because no system has ever shown them the complete picture.

**The fragmentation tax is paid in four currencies:**
- **Time** — re-keying data between systems, manual pick list generation, CSV export/import cycles
- **Errors** — every manual transfer introduces mistakes: wrong quantity, missed order, wrong variant
- **Lag** — decisions made on data that is hours or days stale ("we thought we had 50 units, we had 12")
- **Insight** — no system sees enough of the picture to surface the right alert at the right moment

### 1.2 Why Carrier Integration is the Final Silo

After WM-38, LaSyncro closes the last major data silo in the SMB operational stack:

```
BEFORE WM-38:
  Shopify revenue ✅ in LaSyncro
  Inventory / COGS ✅ in LaSyncro
  Pick / pack / ship ✅ in LaSyncro
  Shipping cost ❌ lives in Sendcloud only
  Parcel tracking ❌ lives in carrier portal only
  Carrier performance ❌ never computed anywhere

AFTER WM-38 + roadmap:
  All of the above ✅ in LaSyncro
```

**True margin = revenue − COGS − shipping cost − return cost**

LaSyncro is the only system in the SMB stack that has access to all four components. No other tool sees this number. This is not a feature — it is a category.

---

## 2. Parcel Economics — Weight, Dimensions, and Carrier Pricing

### 2.1 Why Weight and Dimensions Are First-Class Data

Carriers do not price on item count. They price on:

- **Actual weight** — physical weight of packed parcel in grams/kg
- **Volumetric (dimensional) weight** — `(L × W × H) / DIM_factor` — carriers charge whichever is greater
- **Destination zone** — domestic vs. EU vs. international, country-specific surcharges
- **Service level** — standard, express, next-day, economy
- **Surcharges** — fuel, remote area, signature required, oversized, dangerous goods

For high-SKU SMBs the shipping cost per order can swing by 200–400% depending on what was packed together. An owner who does not know the volumetric weight of their top 20 SKUs is making blind pricing and margin decisions every day.

### 2.2 The Dimensional Weight Problem in Practice

```
Example — fashion retailer, 3 SKUs:

SKU-A: wool coat    → actual 1.2kg, dims 60×40×20cm → vol weight 4.8kg → DHL charges 4.8kg
SKU-B: silk blouse  → actual 0.3kg, dims 35×25×5cm  → vol weight 0.44kg → DHL charges 0.44kg
SKU-C: denim jeans  → actual 0.8kg, dims 40×30×8cm  → vol weight 0.96kg → DHL charges 0.96kg

Multi-item order (A+B+C):
  Actual weight: 2.3kg
  Box dims: 65×45×25cm → vol weight: 7.3kg
  DHL charges: 7.3kg (volumetric wins)
  Shipping cost: ~£18.40

Owner's assumption from Shopify revenue alone: "healthy order"
True margin after shipping: potentially negative on a £65 order
```

**No SMB tool surfaces this today.** The owner discovers the margin problem in the monthly P&L — months after the pricing decision was made.

### 2.3 LaSyncro's Data Position

LaSyncro already has or can capture:

| Data point | Current state | Path to capture |
|---|---|---|
| Order line items | ✅ `order_line_items` | Already live |
| Variant SKU | ✅ `variants` | Already live |
| Unit cost (COGS) | ✅ `variants.unit_cost` | Already live |
| Selling price | ✅ `order_line_items.unit_price` | Already live |
| Shipping cost per parcel | ✅ WM-39 | From Sendcloud API response at label generation |
| Actual parcel weight | 🔜 WM-43 | Operator inputs at pack, or per-variant default |
| Parcel dimensions | 🔜 WM-43 | Operator inputs at pack, or per-variant default |
| Volumetric weight | 🔜 WM-43 | Computed: `(L×W×H) / DIM_factor` |
| Carrier zone | ✅ WM-39 | From Sendcloud API response |
| Tracking events | 🔜 WM-40 | From Sendcloud webhooks |
| Carrier transit time | 🔜 WM-41 | Aggregated from tracking events |
| Return rate by SKU | 🔜 WM-41 | Aggregated from return tracking events |

---

## 3. Current Implementation — WM-38 (✅ LIVE June 3, 2026)

### 3.1 Architecture

**Adapter pattern.** `ICarrierProvider` interface at `services/wms/carriers/ICarrierProvider.ts`. Every carrier or aggregator implements one interface. The rest of the system never talks to a specific carrier directly — only to the interface. Adding a new carrier = one new file + one line in `PROVIDERS` map.

```
ICarrierProvider
  └── SendcloudCarrierService    ← implementation v1
  └── [DHLCarrierService]        ← future
  └── [RoyalMailCarrierService]  ← future
  └── [PostNordCarrierService]   ← future
```

**Orchestrator:** `services/wms/carrierLabel.service.ts`
1. Read active carrier from `shop_carrier_settings`
2. Decrypt credentials (AES-256-GCM, context: `wms.carrier.sendcloud`)
3. Resolve `ICarrierProvider` implementation
4. Call `generateLabel()`
5. Persist result to `order_shipment_tracking`

### 3.2 Data Model

**`shop_carrier_settings`** — per-shop, per-carrier credential store
```
shop_id       int FK shops
carrier_code  varchar(32)        PK with shop_id
public_key    text               AES-256-GCM encrypted
private_key   text               AES-256-GCM encrypted
is_active     boolean default true
```
RLS enforced. Raw keys never returned by API.

**`order_shipment_tracking`** — one row per physical shipment
```
id                uuid PK
shop_id           int FK shops
lasyncro_order_id uuid FK orders
pick_batch_id     uuid FK pick_batches nullable
carrier_code      varchar(32)
tracking_number   varchar(255) nullable
tracking_url      text nullable
label_url         text nullable
label_pdf         bytea nullable
created_at        timestamptz
```
Supports partial shipments — one order can have multiple rows.

**`shop_wms_settings`** additions
```
include_return_label  boolean default false
```
When true, return slip composited onto WM-34 A4 invoice PDF bottom half.

### 3.3 Sendcloud Integration

- Merchant's own Sendcloud account — LaSyncro incurs zero label cost
- API call: `POST https://panel.sendcloud.sc/api/v2/parcels`
  - `request_label: true` — generates label immediately
  - `apply_shipping_rules: true` — respects merchant's Sendcloud routing rules
- Response: `tracking_number`, `tracking_url`, `label.label_printer` (PDF URL)
- Test mode: "Unstamped letter" shipping method — no charge

### 3.4 Shopify Tracking Writeback

`shipConfirmation.service.ts` step 5.5:
1. Reads `order_shipment_tracking` for the order
2. Passes `trackingInfo: { number, url, company }` to `writeShopifyFulfillment`
3. `fulfillmentCreateV2` mutation includes `trackingInfo` — customer receives Shopify shipping notification with live carrier tracking link

**Customer gets tracking automatically. Owner does nothing.**

### 3.5 Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `PUT` | `/api/v1/wms/carrier-settings` | `wms:batch:release` | Upsert carrier credentials |
| `GET` | `/api/v1/wms/carrier-settings` | `wms:read` | List configured carriers (no raw keys) |
| `DELETE` | `/api/v1/wms/carrier-settings/:carrierCode` | `wms:batch:release` | Remove carrier |
| `POST` | `/api/v1/wms/orders/:orderId/generate-label` | `wms:pack:scan` | Generate + persist shipping label |

### 3.6 UI Surface

Settings → Carriers tab (`/settings/carriers`):
- Carrier Pickup Time (CPT) — moved here from General (correct conceptual home)
- Carrier Integration card — not connected state (credential form, eye-toggle reveal) / connected state (status pill, disconnect CTA, return label toggle)

---

## 4. Planned Roadmap

### WM-39 — Shipping Cost Ingestion (P1)

**Effort:** ~2 hours (backend only, non-blocking)

Capture `label.price` and `label.price_excl_vat` from Sendcloud parcel creation response. Store on `order_shipment_tracking`:
```
shipping_cost_excl_vat  numeric(10,4) nullable
shipping_cost_currency  varchar(3) nullable
carrier_zone            varchar(64) nullable
```

Feed into margin computation in `orderFulfillmentIngestion`. Surface as **true margin** alongside gross margin in Finances module:

```
True margin = revenue − COGS − shipping_cost
```

This is the number that changes how owners price products and choose carriers. No SMB tool computes it today.

**Why P1:** highest commercial impact per hour of any item in the backlog. Two hours of backend work makes LaSyncro's margin figure more accurate than anything the owner has ever seen.

**Frontend status:** backend and data model complete; the Outbound
page itself does not yet render `latest_status`/`is_stalled` — that's
the next unit of work (stall-detection sweep job, then the UI).

---

### WM-40 — Carrier Tracking Webhooks (✅ LIVE, July 2, 2026)

Sendcloud fires webhooks on every parcel status change. LaSyncro ingests
these and surfaces live status in the Outbound module.

#### Data model

**`parcel_tracking_events`** — append-only audit trail, one row per carrier scan
id                    uuid PK
shop_id               int FK shops
lasyncro_order_id     uuid FK orders(lasyncro_order_id)
shipment_tracking_id  uuid FK order_shipment_tracking(id)
carrier_code          varchar(32)
event_type            varchar(64)  -- announced | in_transit | out_for_delivery |
-- delivered | exception | returned
raw_status            varchar(128) -- carrier's original status string, unmapped
event_timestamp       timestamptz
location              text nullable
raw_payload           jsonb
created_at            timestamptz
Idempotent on `(shipment_tracking_id, event_type, event_timestamp)`.

**Denormalized "current state" on `order_shipment_tracking`** (read on every
Outbound page load — avoids a window-function query per row):
latest_status       varchar(64)
latest_location      text nullable
latest_event_at      timestamptz
is_stalled           boolean default false

**`carrier_status_map`** — translates carrier-specific raw status strings
into the six canonical `event_type` values, per carrier. `@rls-exempt`:
shared reference data, no `shop_id`, identical across all tenants (same
category as `exchange_rates`).

**`shop_carrier_webhook_tokens`** — per-shop opaque routing token for the
inbound webhook URL. Mirrors `shop_display_tokens` exactly: hash-only
storage (`token_hash = sha256(raw)`), raw token shown once at
creation/rotation, revocable. `unique(shop_id, carrier_code)` — one
token per carrier per shop.

**`shop_carrier_settings.webhook_secret`** — the HMAC signing secret the
merchant configures when registering the webhook URL in their own
Sendcloud dashboard. Encrypted via `encryption.service.ts`
(`AES-256-GCM`), context `wms.carrier.sendcloud.webhook`.

#### Why a per-shop URL token, not a shared secret

Shopify and Stripe webhooks use one signing secret per integration
(env var), because those are *our* app's own webhook subscriptions.
Sendcloud is different — **each merchant has their own Sendcloud
account** and registers the webhook URL themselves, so each shop has
its own secret. That creates a chicken-and-egg problem: verification
needs to know which shop's secret to check, but the shop is unknown
until the payload is trusted. The URL token solves this — it's the
routing key resolved *before* signature verification, the same role
`shopDomain` plays for Shopify webhooks.

#### RLS — split policy on the token table

Token resolution is genuinely cross-tenant (shop_id unknown until the
token is looked up), the same shape as auth-path tables
(`RLS_blueprint.md` §4). `shop_carrier_webhook_tokens` uses the split
pattern: permissive SELECT (works with no tenant context set), strict
ALL for writes. Pen-tested: cross-tenant SELECT returns real rows with
no context set; wrong-tenant INSERT is rejected. No `FOR UPDATE`
anywhere in the lookup — see `RLS_blueprint.md` §7 on why that would
silently return zero rows against a split-policy table.

#### Ingestion pipeline

POST /api/v1/webhooks/carriers/sendcloud/tracking/:token
→ verifySendcloudTrackingWebhook (middleware, mounted INSIDE the
router on the :token route — see gotcha below)
resolves shop via token hash (cross-tenant SELECT)
decrypts that shop's webhook_secret
verifies HMAC-SHA256 over req.rawBody
→ SendcloudWebhookAdapter.toEnvelope()
builds canonical WebhookEnvelope, shopId already resolved
→ WebhookRouter.dispatch()
ledger-based idempotency (existing integration_webhook_events
infra — no new dedup logic needed)
→ registered handler (sendcloud.tracking.handler.ts)
maps raw_status → event_type via carrier_status_map
inserts parcel_tracking_events (onConflict ignore)
updates order_shipment_tracking denormalized columns
on event_type = 'returned' → upserts an alerts row
(category: supplier_inbound, alert_type: carrier_return —
see "Why not receive_jobs" below)

**Correction, 2026-07-04 (RET-AUD-52):** this alerts-row behavior was
only ever implemented in shippo.tracking.handler.ts — sendcloud
.tracking.handler.ts had no 'returned' branch at all until fixed this
date. The two carrier handlers had diverged silently: a Sendcloud RTS
event produced zero signal anywhere, while an identical Shippo event
correctly alerted. Both handlers now share matching logic, and the
alert additionally uses carrier_status_map.fault_category (new column,
migration 0123 — see below) instead of a fixed generic message. Both
handlers now also call createReturnJobFromCarrierEvent()
(returnJobs.service.ts) — a 'returned' event creates an actual
return_jobs row (source: 'carrier_webhook'), not just an alert. See
ReturnsResolutionModule.md §2.5/§6 for the full schema and service
detail — kept there since return_jobs is a Returns-module table, not a
carrier-integration one.

Proven end-to-end with a manually signed curl request: signature
verified, shop resolved, `parcel_tracking_events` and
`order_shipment_tracking` both updated with correct values, replay of
the identical request correctly short-circuited by the ledger's
idempotency check (row count stayed at 1).

#### Why the return signal is an `alerts` row, not a `receive_jobs` row

`receive_jobs` (migration 0097) is scoped to supplier receiving against
a known PO: `po_id` is `NOT NULL`, FK'd to `purchase_orders` with
`ON DELETE RESTRICT`, and its status enum
(`pending → in_progress → inspection → barcode_assignment →
stow_ready → closed → cancelled`) has no draft/unconfirmed state. A
carrier-initiated return has no PO behind it — there's no legitimate
way to create a `receive_jobs` row for one without fabricating a fake
PO. The return signal instead goes through the existing
source-agnostic `alerts` table (upsert on `(shop_id, alert_key)`,
`alert_key = carrier_webhook:{shipment_id}:carrier_return`).

**Correction, 2026-07-04:** this was based on checking `receive_jobs`
only. `return_jobs` (a separate table, owned by the Returns module —
see ReturnsResolutionModule.md §2.5) already had no `po_id` at all and
already supported a PO-less `undelivered_return` origin since its
original migration (0008, Feb 2026) — months before this WM-40 section
was written. The actual gap was narrower: nothing invoked that
existing path from a webhook trigger, and there was no way to trace
such a job back to its triggering scan. Both closed 2026-07-04 via
migration 0122 (`source`, `triggering_parcel_tracking_event_id` columns)
and `createReturnJobFromCarrierEvent()`. No `receive_jobs` schema
change was needed or made.

#### What happens to the `return_jobs` row after creation (2026-07-07 update)

At the time this section was written (2026-07-04), `createReturnJobFromCarrierEvent()`
closed the creation gap, but two things a Type B job needed afterward were
still missing — both closed in a later Returns-module session (see
`ReturnsResolutionModule.md` §9 for full detail, summarized here since it
directly completes this WM-40 story):

- **Visibility.** `getOrphanedReturnJobs()` (RT2-03, §7 of the Returns
  blueprint) originally inner-joined `refund_executions` to compute aging —
  which silently excluded every Type B job, since a carrier-returned parcel
  has no refund on file by definition. A stale `undelivered_return` job could
  age indefinitely with zero signal beyond the one-time `alerts` row this
  section describes. Fixed: the orphan query now ages Type B jobs off
  `created_at` directly, alongside Type A's refund-based aging.
- **Resolution path.** No operator-facing screen previously existed to work
  a Type B job at all — the `alerts` row pointed nowhere actionable. Returns
  processing (originally its own standalone free-scan endpoint,
  `WEB-RETURN-01`) was folded directly into WMS operations' existing pack
  free-scan surface (`POST /wms/pack/free-scan`) rather than kept separate —
  an already-shipped unit or order scanned there now resolves to the same
  return job this section's webhook path creates, whichever came first.
  Carrier-initiated and operator-scanned intake converge on one job, one
  screen, no duplicate paths.

This doesn't change anything in this file's data model or webhook pipeline —
both remain exactly as documented above. It closes the "then what?" question
this section left open.

#### Settings UI

Settings → Carriers, inside the connected-carrier card:
- "Live tracking updates" section — generate/rotate/revoke webhook URL
  (same UX as WMS Floor Display tokens: raw URL shown once, copy
  button, revoke with confirmation)
- Webhook signing secret input (password-masked, reveal toggle),
  saved via dedicated `PATCH /wms/carrier-settings/:carrierCode/webhook-secret`
  — kept separate from the credential-connect flow deliberately, so
  rotating/setting the secret doesn't risk the label-generation path

#### Endpoints added

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `PUT` | `/api/v1/wms/carrier-webhook-tokens` | `wms:batch:release` | Create/rotate-on-conflict webhook token |
| `GET` | `/api/v1/wms/carrier-webhook-tokens` | `wms:read` | Fetch current token metadata (no raw token) |
| `POST` | `/api/v1/wms/carrier-webhook-tokens/:id/rotate` | `wms:batch:release` | Rotate — invalidates prior URL |
| `DELETE` | `/api/v1/wms/carrier-webhook-tokens/:id` | `wms:batch:release` | Revoke |
| `PATCH` | `/api/v1/wms/carrier-settings/:carrierCode/webhook-secret` | `wms:batch:release` | Set/update the HMAC secret |
| `POST` | `/api/v1/webhooks/carriers/sendcloud/tracking/:token` | none (HMAC-verified) | Inbound Sendcloud webhook |

#### Gotchas found during implementation (for future engineers)

**Express middleware mounted via `app.use(path, middleware, router)` does
NOT see the router's own dynamic segments.** `req.params` at the
`.use()` level only reflects the static path matched so far — a router
mounted alongside a middleware at the same `.use()` call does its own
internal path matching *after* that middleware already ran. Verification
middleware that needs `:token` from the URL must be registered *inside*
the router, on the specific route (`router.post('/:token', middleware,
handler)`), not beside the router. Cost about three debugging round
trips before being traced — always mount param-dependent middleware on
the route, never on the parent `.use()`.

**`WebhookRouter.dispatch()`'s shop-resolution block only checked
`envelope.shopDomain`**, even though `WebhookEnvelope.shopId` is a
first-class optional field the type already supports and
`buildWebhookEnvelope` already threads through. Any non-Shopify webhook
provider that resolves its own `shopId` upstream (as Sendcloud does, via
the URL token) would hit `[WEBHOOK_MISSING_SHOP_ID]` even with a
correctly resolved shop. Fixed by checking `envelope.shopId` first,
falling back to `shopDomain` lookup only when absent. The later
"unsupported event" fallback path in the same file has the identical
gap (`shopDomain`-only lookup) — not yet hit in practice since
Sendcloud's registered event type has a handler, but worth the same fix
if a future Sendcloud event type ships without one.

**Migration column collisions across sequential migrations in the same
feature.** `webhook_secret` was added to `shop_carrier_settings` in
`0118_carrier_tracking_webhooks.ts`, then accidentally re-added in
`0119_carrier_webhook_tokens.ts` out of habit — caused a
`column already exists` failure on fresh `db:reset`. When a feature
spans multiple migrations, grep the earlier ones for the column name
before adding it again.

---

### WM-41 — Carrier Performance Analytics (P2)

**Effort:** 1 sprint

Aggregate `parcel_tracking_events` into a Carrier Performance tab in Warehouse Analytics:

| Metric | Description |
|---|---|
| Delivery rate | % of parcels delivered without exception |
| Average transit time | Days from dispatch to delivery, by carrier + destination country |
| Exception rate | % of parcels with carrier exceptions (lost, damaged, delayed) |
| Return rate | % of parcels returned, by carrier + SKU + destination |
| Cost per delivery | Average shipping cost, by carrier + destination zone |
| On-time rate | % of parcels delivered within carrier's stated SLA |

**The decision this enables:** "DHL delivers 94% on time to UK but only 71% to Germany. PostNord costs 12% less for German orders and delivers 89% on time. Switch German orders to PostNord." SMBs never have this conversation today because the data lives in the carrier portal and no one exports it.

---

### WM-42 — CPT Pressure Indicator (P2)

**Effort:** 1 sprint (frontend-heavy)

Real-time widget in WMS module:

```
34 min until DHL pickup
17 orders unpacked  ·  2 active packers  ·  avg 4.2 min/order
→ Projected completion: 35 min  ⚠️ Miss 1–3 orders at current pace
→ Release a third packer now to clear the queue
```

Inputs: CPT from `shop_operational_settings`, active pack sessions from `pack_sessions`, orders remaining from `order_warehouse_status`, historical UPH from `wms_analytics`.

This is the "owner running to the warehouse 30 minutes before pickup and counting boxes" problem — solved algorithmically.

---

### WM-43 — Parcel Weight and Dimensions (P2)

**Effort:** 1 sprint (schema + UI + computation)

**Two capture modes:**

**Mode A — Per-variant defaults (owner configures)**
Add to `variants`:
```
weight_grams     integer nullable
dim_length_cm    numeric(6,2) nullable
dim_width_cm     numeric(6,2) nullable
dim_height_cm    numeric(6,2) nullable
```
Synced from Shopify where available (Shopify stores weight per variant). UI in Catalog for manual entry.

**Mode B — Per-pack operator input**
At pack time (WEB-PACK-02), packer enters actual packed box dimensions. Stored on `order_shipment_tracking`. Overrides variant defaults.

**Computed fields on `order_shipment_tracking`:**
```
actual_weight_grams    integer nullable
dim_length_cm          numeric(6,2) nullable
dim_width_cm           numeric(6,2) nullable
dim_height_cm          numeric(6,2) nullable
volumetric_weight_grams integer nullable  -- (L×W×H×1000) / DIM_FACTOR
chargeable_weight_grams integer nullable  -- MAX(actual, volumetric)
```

**DIM factor:** standard is 5000 for most carriers (metric). Configurable per carrier in `shop_carrier_settings`.

**Surface in Finances:** `chargeable_weight` × carrier rate per kg = predicted shipping cost before label generation. Enables pre-dispatch margin warnings: "This order's chargeable weight is 4.8kg. Estimated shipping cost: £16.40. Margin will be negative."

---

### WM-44 — Multi-Carrier Smart Routing (P3)

**Effort:** 2 sprints

When a merchant has multiple carriers configured, LaSyncro knows:
- Order destination country
- Chargeable weight (WM-43)
- Each carrier's rate for that zone + weight (from Sendcloud rates API)
- Each carrier's historical performance for that destination (WM-41)

LaSyncro can suggest or auto-select the optimal carrier per shipment:

```
Order → Germany, 2.1kg chargeable
  DHL Express:  £12.40, 94% on-time
  PostNord:     £9.80,  89% on-time
  → Recommended: PostNord (saves £2.60, acceptable SLA delta)
```

Configurable: cost-optimise, reliability-optimise, or balanced. This is a decision an SMB owner currently makes once (when they signed up for a carrier) and never revisits.

---

### WM-45 — Return Label Portal (P3)

**Effort:** 1 sprint

The `include_return_label` toggle (WM-38) generates a static return slip. The full vision:
- Sendcloud return portal integration — merchant configures return policy in Sendcloud, LaSyncro links to their return portal on the invoice
- Return label generation on demand — customer requests return via Shopify, LaSyncro generates return label via Sendcloud API, emails to customer
- Return tracking — when return parcel is scanned by carrier, WM-40 event fires, LaSyncro pre-creates receive job

### WM-40b — Shippo Carrier Provider (✅ LIVE, July 3, 2026)

Second `ICarrierProvider` implementation, added to serve the US/UK
segment of the customer base (LaSyncro's own market data: US 1,604
impressions, UK 757 — the largest two segments by far, neither served
by Sendcloud, which only supports NL/DE/IT/BE/AT/FR/ES/GB billing
addresses). Chosen after direct signup-eligibility verification (no
billing-country gate found, confirmed by actually creating a test
account from Sweden — the same country whose billing address
disqualified LaSyncro's own Sendcloud registration attempt).

#### Structural differences from Sendcloud, and why they mattered

**Auth model.** Sendcloud uses a public/private key pair. Shippo uses
a single API token (`Authorization: ShippoToken <token>`). This
required widening `ICarrierProvider`'s credentials contract rather than
misusing `public_key` to hold a token that isn't one:

```typescript
// ICarrierProvider.ts
export interface CarrierCredentials {
  publicKey: string | null;
  privateKey: string | null;
  apiToken: string | null;
}
```

`shop_carrier_settings.public_key`/`private_key` were relaxed from
`NOT NULL` to nullable (folded into migration `0113`, not a separate
patch migration — this table had no prior deployment). A new nullable
`api_token` column was added to the same migration. Sendcloud's own
`generateLabel()` gained a guard clause requiring both keys, since the
DB-level relaxation only removes the *storage* constraint, not the
*application* requirement — Sendcloud users are unaffected.

**Webhook verification model.** Sendcloud: per-shop URL-path token +
HMAC-SHA256 signature over the raw body, secret entered by the
merchant. Shippo: **no HMAC at all** — their own webhook security docs
describe a simpler self-generated query-parameter token model. We
generate the token, embed it as `?token=<raw>` in the URL we register
with Shippo, and they echo it back on every call for us to check by
hash lookup. This meant:
- `shippo.tracking.verify.middleware.ts` reads `req.query.token`
  instead of a path segment, hashes it, and resolves the shop via the
  same `shop_carrier_webhook_tokens` table and split RLS policy
  Sendcloud already established — no schema change needed there.
- No `webhook_secret` field is used for Shippo. The Settings UI's
  `WebhookIntegrationSection` was parameterized (`showSecretField`
  prop) so Shippo's card correctly omits the secret input Sendcloud's
  requires.
- Webhook *registration* can be automated via Shippo's Webhooks API
  (`POST /webhooks`), unlike Sendcloud which requires the merchant to
  manually paste the URL into their own dashboard. Not yet automated
  in the connect flow — still a manual copy-paste-into-Shippo-portal
  step today, same UX as Sendcloud, but the API exists for a future
  one-click improvement.

**Sender address — a genuine new requirement, not carrier-specific
plumbing.** Sendcloud never needed LaSyncro to supply a "ship from"
address — it infers this from whatever the merchant has already
configured inside their own Sendcloud account. Shippo's `/shipments`
API requires an explicit `address_from` object in every request. No
table anywhere in the schema stored this (confirmed by elimination —
`warehouse_locations` is internal bin/shelf/lane geography, a
different concern entirely). New table:
shop_sender_addresses
id            uuid PK
shop_id       int FK shops
name          varchar(255)
street1       varchar(255)
street2       varchar(255) nullable
city          varchar(100)
state         varchar(100) nullable
postal_code   varchar(20)
country_code  varchar(2)
phone         varchar(50)
email         varchar(255) nullable   -- added after Shippo's USPS
-- rate purchase rejected
-- addresses missing it
is_default    boolean default true

Has its own primary key rather than one-row-per-shop, deliberately —
`warehouse_locations` already models a shop having multiple named
physical warehouses (`type` enum includes `'warehouse'`), so a
sender-address table shouldn't assume single-location when the rest of
the schema doesn't. RLS: standard strict policy, `FORCE`, both `USING`
and `WITH CHECK` present from the first migration (the earlier gap
class — missing `WITH CHECK` on older tables — was not repeated here).

New settings UI section (`SenderAddressSection`), with structural
guards rather than free-text validation for country: a constrained
`<Select>` of real countries, not a text field — this was added
*after* a real data-entry bug where a phone dialing code (`46`, for
Sweden) landed in the country-code field, which no regex could have
caught since `"46"` is syntactically valid text. The fix eliminates
the error class rather than detecting it post-hoc.

#### Field-by-field discovery, live against Shippo's real sandbox API

Every one of the following was discovered by actually attempting a
label purchase against Shippo's test API and reading the real
rejection message — not inferred from documentation, since Shippo's
own address-object docs don't enumerate all purchase-time requirements
up front (quote-time and purchase-time completeness are different
bars):

| Missing field | Shippo's error | Fix |
|---|---|---|
| `address_to.phone` | `"A rate may only be purchased if it was generated with complete address information"` | Added `shipping_phone` to `orders` select + `recipientPhone` threaded through `ICarrierProvider` |
| `address_to.state` (US) | `"Attribute \"address_to.state\" must not be empty"` | Added `shipping_province` to `orders` select + `recipientState` threaded through |
| `address_from.email` | `"Attribute \"address_from.email\" must not be empty"` (USPS-specific) | Added `email` column to `shop_sender_addresses`, threaded through `SenderAddress` |
| `address_from.state` | Same pattern, sender-side | Structural bug in test data (state left blank in a hand-created address), not a code gap |

Each fix followed the same three-file pattern established for
Sendcloud: `ICarrierProvider.ts` → `shippo.carrier.service.ts` →
`carrierLabel.service.ts` → the calling controller's `.select()` +
input mapping. `httpBulkGenerateShippingLabels` needed the identical
fields added to its own independent order-resolution query — it does
not share a query with the single-order path, a gap caught only by
explicitly re-checking that function after fixing the single-order one.

#### Resilience: multi-rate purchase fallback

Shippo's shared test carrier accounts are pre-scoped to specific
origin countries per carrier (confirmed via real rejection messages:
UPS/USPS master accounts reject non-US origins; DHL Express master
account explicitly "doesn't support shipments from outside of the
US"). Beyond origin-country scoping, individual carrier accounts can
also simply be unregistered for a given merchant (UPS: *"The UPS
account is not yet registered... click Activate Account"*) — this is
independent of address correctness and cannot be fixed by data
changes.

Rather than fail the whole label-generation attempt when the
single cheapest quoted rate happens to hit an unregistered/unsupported
carrier account, `shippo.carrier.service.ts` sorts all returned rates
cheapest-first and attempts a purchase against each in sequence,
falling through to the next on a carrier-specific rejection:

```typescript
const sortedRates = [...rates].sort((a, b) => Number(a.amount) - Number(b.amount));
// ...loop: try each rate's /transactions call; on failure, log and
// continue to the next; on success, break. Throw only if every rate
// in the response is exhausted.
```

This means the final purchased rate is "cheapest among rates whose
carrier account is actually usable right now," not strictly "cheapest
quoted" — a deliberate tradeoff (a purchasable $7.95 label beats an
unpurchasable $7.94 quote). Proven live: UPS Ground Saver ($7.94,
cheapest) failed on account registration, next several UPS rates
failed the same way, USPS Ground Advantage ($7.95) succeeded.

#### Proof — real Shippo test-mode label purchased
Order:            4ba4e3b3-f00b-322c-3d20-511a9e0544e5 (#900010)
Sender:           Test US Address, Mission Viejo, CA → US
Recipient:        Morgan Bell, Philadelphia, PA
Carrier/service:  USPS Ground Advantage
Cost:             $7.95 USD
Tracking number:  9334620845500000708101
Tracking URL:     tools.usps.com (real USPS tracking tool link)
Label:             real downloadable PDF, confirmed rendered
(Shippo branding, correct addresses, real barcode)

Confirmed independently via Shippo's own `apps.goshippo.com/shipments`
dashboard, not just our own API response — the shipment appears there
with `Track status: Unknown`, `$7.95`, `USPS Ground Advantage`,
matching exactly.

#### Known open item: webhook delivery unconfirmed

Webhook registration is fully proven: token generation, URL
construction (`?token=` query-param format), registration via
Shippo's portal, status shows **Active** in both of Shippo's dashboard
surfaces (`portal.goshippo.com` and `apps.goshippo.com` — confirmed to
be the same underlying account/webhook, not separate configurations).

However, no real `track_updated` event has been received as of this
writing. Diagnosed as external to LaSyncro, not a code gap:

- `shop_carrier_webhook_tokens.last_seen_at` remains null (this column
  updates on every inbound call that passes token verification, success
  or failure downstream — it never got set).
- No log line of any kind appears in the running dev server for a
  request to `/api/v1/webhooks/carriers/shippo/tracking`.
- Shippo's own "Send Sample" test-delivery feature was attempted twice,
  from both dashboard surfaces, and both times surfaced a **"Webhook
  Error"** label directly in Shippo's own UI — their own outbound
  attempt is failing before it leaves their infrastructure.

Conclusion: the failure is on Shippo's delivery mechanism, not our
receiving endpoint — which has never actually been reached by any of
the three delivery attempts tried (natural sandbox event, Send Sample
×2). The webhook *pipeline* itself (middleware, adapter, handler) is
code-identical in structure to Sendcloud's, which *was* proven live
earlier via a real signed curl request — there's no reason to suspect
it wouldn't work given a real inbound call, but that call has not yet
happened. Worth revisiting: retry Send Sample later (may be a
transient Shippo-side issue), or contact Shippo support with the
"Webhook Error" observation, since only their outbound request logs
would explain the root cause.

---

## 5. The Operational Intelligence Loop — Full Vision

```
                    ┌─────────────────────────────┐
                    │      SHOPIFY ORDER           │
                    │  revenue · line items · SKUs │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │      LASYNCRO WMS            │
                    │  pick · pack · label · ship  │
                    └──────────────┬──────────────┘
                                   │
             ┌─────────────────────┼─────────────────────┐
             │                     │                     │
┌────────────▼──────┐  ┌───────────▼────────┐  ┌────────▼──────────┐
│  CARRIER API      │  │  TRACKING WEBHOOKS │  │  RETURN SIGNALS   │
│  label cost       │  │  transit · delivery│  │  pre-create job   │
│  zone · weight    │  │  exceptions        │  │  alert owner      │
└────────────┬──────┘  └───────────┬────────┘  └────────┬──────────┘
             │                     │                     │
             └─────────────────────┼─────────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │      TRUE MARGIN             │
                    │  revenue − COGS −            │
                    │  shipping − returns          │
                    │                              │
                    │  per order · per SKU         │
                    │  per carrier · per region    │
                    └─────────────────────────────┘
```

**This is the number no SMB has ever seen in real time.**

---

## 6. SMB Impact Summary — The Case for Carrier Integration as Moat

| Pain | Today's reality | LaSyncro closes it |
|---|---|---|
| "Where is my order?" support tickets | 4–8 min per ticket, owner opens Sendcloud manually | Tracking auto-pushed to Shopify + visible in Outbound. Zero manual lookup. |
| Missed carrier pickup | Owner runs to warehouse 30 min before pickup and counts boxes | CPT pressure indicator (WM-42) alerts with projected miss count and packer recommendation |
| Margin blindness | Owner knows revenue and COGS, never shipping cost. Monthly P&L surprise. | WM-39 captures label cost at generation. True margin computed per order in real time. |
| Dimensional weight surprises | Carrier charges 2× expected. Discovered on invoice. | WM-43 computes chargeable weight at pack. Pre-dispatch margin warning. |
| Carrier choice gut-feel | Chose DHL in 2019. Never revisited. | WM-41 carrier performance analytics. WM-44 smart routing recommendation. |
| Returns discovered on arrival | Box arrives unannounced. Receive job created reactively. | WM-40 return tracking event pre-creates receive job before parcel arrives. |
| Return rate by SKU unknown | "Some SKUs get returned more" — no data | WM-41 return rate by SKU and carrier. Drives ranging and pricing decisions. |
| Pick list chaos | Printed from Shopify, handed to operator, errors transcribed back | Full WMS pipeline. No paper. No re-entry. |

---

## 7. Implementation Register

| ID | Priority | Status | Description |
|---|---|---|---|
| WM-38 | P1 | ✅ RESOLVED June 3, 2026 | Adapter pattern (ICarrierProvider). Sendcloud implementation. shop_carrier_settings + order_shipment_tracking. include_return_label toggle. Tracking → Shopify writeback. 4 endpoints. Settings UI. |
| WM-39 | P1 | ✅ RESOLVED June 3, 2026 | Shipping cost ingestion — migration 0114. shipping_cost_excl_vat + currency + carrier_zone on order_shipment_tracking. carrier_shipping_cost + true_margin + true_margin_pct on order_margin_snapshot. Sendcloud parcel.price captured at label generation. computeOrderMargin extended — true_margin = gross_margin − carrier_shipping_cost. order_revenue_units immutability preserved. |
| WM-40 | P1 | ✅ RESOLVED July 2, 2026 | Carrier tracking webhooks — parcel_tracking_events + denormalized columns on order_shipment_tracking. Per-shop webhook token (shop_carrier_webhook_tokens, split RLS policy) + webhook_secret for HMAC verification. Adapter/handler registered on shared WebhookRouter (required a shopId-resolution fix in shared infra — see §4 gotchas). Return detection → alerts row (not receive_jobs — schema mismatch, see §4). Settings UI: generate/rotate/revoke webhook URL, secret input. Proven end-to-end via signed curl test, idempotency confirmed. |
| WM-40 | P1 | ✅ RESOLVED July 2-3, 2026 | Carrier tracking webhooks — Sendcloud (July 2) + Shippo (July 3). Sendcloud: path-token + HMAC. Shippo: query-param token, no HMAC (per Shippo's own webhook security model). Both share parcel_tracking_events, denormalized order_shipment_tracking columns, carrier_status_map, stall detection, WebhookRouter dispatch. Shippo webhookdelivery unconfirmed live — registration/config fully proven, delivery mechanism failing on Shippo's side (see WM-40b writeup). Type B `return_jobs` created here are now aging-visible and resolvable through a real operator UI as of 2026-07-07 — see §4's "What happens after creation" note and `ReturnsResolutionModule.md` §9. |
| WM-40b | P1 | ✅ RESOLVED July 3, 2026 | Shippo carrier provider — second ICarrierProvider implementation for US/UK market segment. Single-token auth (api_token column). New shop_sender_addresses table (own PK, multi-warehouse-ready, RLS correct from first migration). Multi-rate purchase resilience (cheapest-first, fall through on carrier-account rejection). Real test-mode label purchased and confirmed in Shippo's own dashboard: USPS Ground Advantage, $7.95, tracking 9334620845500000708101. |
| WM-41 | P2 | 📋 PLANNED | Carrier performance analytics — delivery rate, transit time, exception rate, return rate, cost per delivery. Carrier Performance tab in Warehouse Analytics. |
| WM-42 | P2 | 📋 PLANNED | CPT pressure indicator — orders remaining × UPH × active packers → projected completion vs CPT. Alert on projected miss. |
| WM-43 | P2 | 📋 PLANNED | Parcel weight + dimensions — per-variant defaults (synced from Shopify), per-pack operator input, volumetric weight computation, chargeable weight, pre-dispatch margin warning. |
| WM-44 | P3 | 📋 PLANNED | Multi-carrier smart routing — rate comparison at shipment time, historical performance weighting, cost/reliability optimisation mode. |
| WM-45 | P3 | 📋 PLANNED | Return label portal — Sendcloud return portal integration, on-demand return label generation, return tracking loop. |

---

## 8. For Future Engineers

### Adding a new carrier

1. Create `services/wms/carriers/{carrier}.carrier.service.ts` implementing `ICarrierProvider`
2. Add to `PROVIDERS` map in `carrierLabel.service.ts`
3. Add carrier code to `SUPPORTED` array in `httpUpsertCarrierSettings`
4. Add carrier credentials form to `ShopSettingsCarriersPage` (or extend the generic form)
5. Add `wms.carrier.{code}` to `ALLOWED_CONTEXTS` in `encryption.service.ts`
6. No other files change — the interface enforces the contract

### Sendcloud sandbox testing

Use shipping method "Unstamped letter" (id: 8) — generates labels without charge against merchant account.

### Credential security model

Raw keys are encrypted via `encryption.service.ts` before insert. `decrypt()` is only callable from `ALLOWED_CONTEXTS`. The GET endpoint never returns key values — presence only. This matches the Shopify token pattern already established in the system.

### DIM factor configuration

Standard: 5000 (metric, most carriers). Some carriers use 4000 (UPS, some DHL contracts). Store per-carrier in `shop_carrier_settings` when WM-43 ships. Default 5000 until then.
---

## 9. UI Surfaces — Carrier Integration Wiring (June 3, 2026)

Five surfaces wired across the platform. All changes are additive — no existing data removed, all new fields nullable and gracefully degraded when no carrier is configured.

### UI-CAR-01 — Orders → Outbound (`/orders/outbound`)

**Backend:** `orders.fulfilled.controller.ts` — LEFT JOIN `order_shipment_tracking` (DISTINCT ON lasyncro_order_id, latest by created_at). Returns `tracking_number`, `tracking_url`, `carrier_code` per order.

**Frontend:**
- Tracking column: clickable accent pill (tracking_url present) → static monospace pill (number only) → `—` (no tracking)
- Carrier Tracking stat card: `X tracked / of Y shipped this week` when active; `Not configured` + deep-link `→ /settings/carriers` when no carrier connected
- Deep-link pattern: `onSubClick` prop on `StatCard` — navigates via `useNavigate`

### UI-CAR-02 — Orders → Order Detail (`/orders/:orderId`)

**Backend:** `orders.service.ts` — `getOrderDetailsById` LEFT JOINs `order_shipment_tracking`, returns `tracking` field (most recent shipment, nullable).

**Frontend:** Carrier Tracking panel in right column, rendered only when `order.tracking?.tracking_number` exists. Shows carrier code, tracking number (monospace), and `Track shipment →` ghost pill CTA linking to `tracking_url`.

### UI-CAR-03 — WMS → Pack Session

**Frontend:** `WmsPage.tsx` `handlePrintLabel` replaced — now calls `POST /api/v1/wms/orders/:orderId/generate-label` (WM-38, idempotent). Opens `labelUrl` in new tab when carrier is configured. Falls back to Shopify packing slip when no carrier configured or label generation fails. Operator is never blocked.

### UI-CAR-04 — Finances → Margin (`/finances/margin`)

**Backend:** `finances.margin.controller.ts`:
- Summary: `total_shipping_cost` (SUM carrier_shipping_cost), `avg_true_margin_pct` (AVG true_margin_pct, nulls excluded)
- Per-order: `carrier_shipping_cost`, `true_margin`, `true_margin_pct`

**Frontend:** `FinancesModuleFT2.tsx`:
- Stat cards: `Avg True Margin` + `Total Shipping` rendered conditionally (only when data exists)
- By Order table: `Shipping` column + `True Margin %` column added (7-column grid). Both show `—` when null.

### UI-CAR-05 — Finances → Intelligence (`/finances`)

**Backend:** `finances.intelligence.controller.ts` — `total_shipping_cost` aggregated from `order_margin_snapshot.carrier_shipping_cost`. Added to response as `totalShippingCost`.

**Frontend:** `FinancesIntelligencePage.tsx` — new signal card: `£X spent on carrier labels` with `View True Margin →` deep-link. Rendered only when `totalShippingCost > 0`.

### Deep-link convention

All "not configured" states deep-link to the relevant settings tab rather than showing a dead end. Established pattern: `useNavigate` + `/settings/carriers`. Apply this to all future "requires setup" states across the platform.

