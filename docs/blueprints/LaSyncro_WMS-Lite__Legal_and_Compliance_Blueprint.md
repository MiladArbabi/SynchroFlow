# LaSyncro WMS-Lite — Legal & Compliance Blueprint

**Version:** 1.0 | **Effective:** Upon deployment | **Jurisdiction:** US (Delaware), EU, UK

---

## 1. SOFTWARE IDENTITY

**Legal entity:** LaSyncro Inc. (Delaware C-Corp, to be registered)
**Role designation:** Data Processor for merchant operational data; Data Controller for platform analytics
**Product surface:** WMS-Lite is a sub-module of LaSyncro, governed by the master SaaS Agreement
**Presentation to users:** Clickwrap acceptance at first WMS-Lite activation — operator and owner roles accept separately
**Governing law:** Delaware (US merchants); GDPR Article 28 DPA (EU/UK merchants)

---

## 2. USER IDENTITY & ACCESS BOUNDARIES

### Role Definitions (RBAC — Codified in `users.role`)

| Role | Legal Designation | Binding Authority |
|---|---|---|
| `owner` | Account Controller | Full authority; accepts ToS on behalf of business |
| `admin` | Delegated Administrator | Operates under owner delegation; owner liable for admin actions |
| `operator` | Restricted End User | Warehouse task execution only; no data export rights |

### Authentication Standards

- **MFA:** Required for `owner` and `admin` roles at first login (enforcement: Sprint post-WM-19)
- **Session:** JWT with 15-minute expiry; refresh tokens scoped to device
- **SSO:** Roadmap item — not yet implemented; no contractual commitment until available
- **Account ownership:** Tied to business entity, not individual — owner transfer requires written notice to LaSyncro support

### Delegation Limits

- Owner may grant `admin` role; admin may NOT grant `admin` to others
- Operator accounts are warehouse-scoped — no cross-shop access permitted
- Pick/pack/stow reassignment (`WM-29`) requires `owner` or `admin` role — not delegatable to operators

---

## 3. DATA BOUNDARIES

### Ownership

- **Merchant data:** Owned by the merchant at all times. LaSyncro holds a limited license to process it for service delivery only.
- **Operational telemetry** (scan logs, UPH metrics, exception signals): Owned by merchant; LaSyncro may use anonymized, aggregated derivatives for product improvement with opt-out right.
- **Shopify data:** Subject to Shopify Partner Program Agreement — LaSyncro processes it as a downstream processor under merchant's Shopify authorization.

### Data Types Processed by WMS-Lite

| Data Type | Legal Basis | Retention |
|---|---|---|
| `pick_scan_log` | Contract performance | Duration of subscription + 90 days |
| `pack_scan_log` | Contract performance | Duration of subscription + 90 days |
| `pick_exceptions` | Legitimate interest (operational integrity) | 12 months post-resolution |
| `order_warehouse_status` | Contract performance | Duration of subscription + 90 days |
| `inventory_movements` | Contract performance + legal obligation | 7 years (financial record) |
| `shopify_fulfillment_id` | Contract performance | Duration of subscription + 90 days |
| Operator device/location signals | Not collected — confirmed architecture constraint | N/A |

### Prohibited Data Types

WMS-Lite must never collect or store:

- Biometric data (fingerprints, facial recognition)
- Payment card data (PCI-DSS scope exclusion maintained)
- Health or medical information
- Data on individuals under 16

### Subprocessors (WMS-Lite specific)

| Subprocessor | Purpose | Region |
|---|---|---|
| Shopify Inc. | Order/fulfillment data source | US/Global |
| PostgreSQL host (TBD) | Data persistence | Merchant's elected region |
| ZXing (client-side only) | Barcode decode — no data leaves device | N/A |

### Data Portability

- Merchant may export all WMS data (batches, scan logs, exceptions, warehouse status) via API within 30 days of termination request
- Format: JSON via authenticated API endpoints
- LaSyncro will provide export tooling no later than 6 months post-GA

### Deletion

- On subscription termination: soft delete at day 0, hard delete at day 90
- `inventory_movements` exempt from 90-day deletion — retained 7 years per financial record obligations
- Operator accounts deleted within 30 days of operator removal by owner

---

## 4. USAGE BOUNDARIES

### Permitted Use

WMS-Lite is licensed for:

- Physical warehouse pick, pack, stow, and ship confirmation operations
- Single-tenant SMB warehouses (one shop per installation)
- Mobile device operation by authorized operators under a valid subscription

### Prohibited Conduct

- Reverse engineering the scan resolution or inventory ledger logic
- Automated barcode injection (scripted scan simulation)
- Using WMS-Lite to process orders for shops other than the authenticated shop
- Reselling or white-labeling WMS-Lite without a separate reseller agreement
- Circumventing `requireRole` middleware or RLS tenant isolation controls

### API Rate Limits (WMS-Lite endpoints)

| Endpoint category | Limit | Window |
|---|---|---|
| Barcode resolution | 300 req | 1 minute |
| Pick/pack scan confirmation | 120 req | 1 minute |
| Batch operations | 30 req | 1 minute |
| SKU Gaps / reporting | 60 req | 1 minute |

*Limits enforced at infrastructure layer — not yet implemented; contractually committed for enforcement within 90 days of GA.*

### Uptime SLA

- **Target:** 99.5% monthly uptime for WMS-Lite API endpoints
- **Exclusions:** Shopify API outages, scheduled maintenance (4-hour window, 48-hour notice), force majeure
- **Remedy:** Service credits — 10% of monthly fee per 0.5% below SLA, capped at 30% monthly fee
- **No SLA** applies to: auto-release worker polling intervals, idle alert latency, push notification delivery (WM-22, not yet implemented)

---

## 5. LIABILITY & INDEMNIFICATION

### Limitation of Liability

- LaSyncro's aggregate liability for WMS-Lite claims capped at **3 months of subscription fees paid**
- No liability for: lost inventory due to operator error, Shopify API failures, incorrect barcode data provided by merchant, or fulfillment delays caused by offline resilience gaps (WM-24, pending)
- Consequential damages excluded in all cases

### Indemnification Triggers

**Merchant indemnifies LaSyncro when:**

- Merchant grants operator access to unauthorized individuals
- Merchant provides incorrect product/barcode data causing inventory discrepancies
- Merchant's Shopify OAuth token is compromised due to merchant-side security failure

**LaSyncro indemnifies merchant when:**

- Data breach caused by LaSyncro's infrastructure failure (not merchant misconfiguration)
- WMS-Lite writes incorrect inventory movements due to confirmed platform bug

### Disclaimers

- WMS-Lite is provided "as-is" with respect to: Shopify writeback latency, barcode resolution fallback accuracy (SKU/variant ID fallback), and UPH metrics (advisory only, not contractually binding KPIs)
- Offline resilience (WM-24) not guaranteed until implemented — merchants operating in low-connectivity warehouses accept this risk explicitly at WMS activation

---

## 6. COMPLIANCE SCAFFOLDING

### GDPR / UK GDPR

- **Legal basis:** Article 6(1)(b) — contract performance for all operational data
- **DPA:** Required before onboarding EU/UK merchants — standard SCCs (Module 2: controller-to-processor) apply
- **Data subject rights:** Operators may request access/deletion through merchant owner — LaSyncro processes within 30 days of merchant-submitted request
- **Cross-border transfers:** Shopify writeback data transits Shopify's infrastructure — covered by Shopify's existing SCCs

### CCPA

- LaSyncro does not sell merchant operational data
- Operator personal data (name, email, role) classified as business contact information — not subject to CCPA consumer rights in B2B context
- Privacy policy must disclose WMS-Lite data categories — update required before GA

### SOC 2 Type II Mapping (Target Controls)

| Control | WMS-Lite Implementation | Status |
|---|---|---|
| CC6.1 — Logical access | `requireRole` middleware + RLS tenant isolation | ✅ Implemented (temporary) |
| CC6.2 — Authentication | JWT + role-based session | ✅ Implemented |
| CC6.3 — Role management | `users.role` enum + owner delegation model | ✅ Implemented |
| CC7.2 — Anomaly detection | Idle alerts, exception alerts | ✅ Implemented |
| CC9.2 — Vendor management | Shopify subprocessor agreement | ⚠️ Pending DPA |
| A1.2 — Availability monitoring | System health endpoint | ✅ Implemented |
| C1.1 — Confidentiality | AES-256-GCM token encryption | ✅ Implemented |

### Breach Notification

- Detection to internal escalation: 24 hours
- Merchant notification: 72 hours (GDPR Article 33 compliant)
- Regulatory notification: 72 hours where required
- WMS-specific breach scope: unauthorized access to `pick_scan_log`, `inventory_movements`, or `shopify_fulfillment_id`

---

## 7. CONTRACT LIFECYCLE

### Acceptance Mechanism

- **Owner:** Clickwrap at WMS-Lite first activation — explicit "I accept" required; logged with timestamp and user ID
- **Operators:** Implicit acceptance at first login to WMS surface — disclosed in owner-facing ToS that operators are bound
- **No browsewrap** — passive acceptance not permitted for WMS-Lite given operational data sensitivity

### Modification Notice

- Material changes (data retention, liability caps, subprocessors): 30 days written notice via registered email
- Non-material changes (rate limits, SLA remedies): 14 days notice
- Continued use after notice period = acceptance

### Termination

| Trigger | Notice | Data window |
|---|---|---|
| Merchant voluntary | 30 days | 90 days post-termination export window |
| Non-payment | 14 days cure | 30 days post-termination export window |
| Material breach by merchant | 7 days cure | No export window if breach involves data misuse |
| LaSyncro sunset of WMS-Lite | 90 days | 90 days post-sunset export window |

---

## 8. NEGOTIATION CHEAT SHEET

### What Can Bend (for enterprise/mid-market SMB)

- SLA uptime target: negotiable up to 99.9% with dedicated infrastructure tier
- Data retention: can extend beyond 90 days for regulated industries (logistics, food, pharma)
- Liability cap: negotiable up to 6 months fees for high-GMV merchants
- DPA terms: custom DPA accepted for EU merchants with legal counsel review
- Export format: CSV/XLSX in addition to JSON — available on request

### What Cannot Bend

- RLS tenant isolation — non-negotiable; single-tenant data boundary is a core architectural invariant
- `inventory_movements` immutability — no merchant can request retroactive ledger edits
- Shopify data usage limits — bound by Shopify Partner Program; LaSyncro cannot override
- Operator role scope — operators cannot be granted owner-level data export rights regardless of merchant request
- Prohibited data types — biometric and payment card data collection never permitted regardless of custom agreement
- Audit log retention — `pick_scan_log` and `pack_scan_log` append-only invariant cannot be contractually waived

---

*This blueprint requires review by qualified legal counsel before deployment. It is an architectural and operational reference, not a substitute for jurisdiction-specific legal advice.*
