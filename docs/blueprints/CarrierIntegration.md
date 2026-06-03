# LaSyncro — Carrier Integration Blueprint

**Location:** `docs/blueprints/CarrierIntegration.md`
**Created:** June 3, 2026
**Status:** WM-38 ✅ LIVE — WM-39 through WM-42 📋 PLANNED

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
| Shipping cost per parcel | 🔜 WM-39 | From Sendcloud API response at label generation |
| Actual parcel weight | 🔜 WM-43 | Operator inputs at pack, or per-variant default |
| Parcel dimensions | 🔜 WM-43 | Operator inputs at pack, or per-variant default |
| Volumetric weight | 🔜 WM-43 | Computed: `(L×W×H) / DIM_factor` |
| Carrier zone | 🔜 WM-39 | From Sendcloud API response |
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

---

### WM-40 — Carrier Tracking Webhooks (P1)
**Effort:** 1 sprint

Sendcloud fires webhooks on every parcel status change. LaSyncro ingests these into a new table:

```
parcel_tracking_events
  id                  uuid PK
  shop_id             int FK shops
  lasyncro_order_id   uuid FK orders
  shipment_tracking_id uuid FK order_shipment_tracking
  carrier_code        varchar(32)
  event_type          varchar(64)   -- announced, in_transit, delivered, exception, returned
  event_timestamp     timestamptz
  location            text nullable -- carrier scan location string
  raw_payload         jsonb
```

**Outbound module** gets a live tracking column: `In Transit · Stockholm · 14:32`.

**"Where is my order?"** becomes a 3-second lookup. Eliminates 20–40 minutes of owner time daily at 50 orders/day with 10% query rate.

**Return detection:** when `event_type = 'returned'`, pre-create a receive job for the incoming parcel. Owner knows about the return before it arrives at the warehouse.

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
| WM-39 | P1 | 📋 PLANNED | Shipping cost ingestion — capture label price from Sendcloud response. Store on order_shipment_tracking. Feed into true margin computation. |
| WM-40 | P1 | 📋 PLANNED | Carrier tracking webhooks — Sendcloud parcel status events. parcel_tracking_events table. Outbound module tracking column. Return detection → pre-create receive job. |
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