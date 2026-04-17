# LaSyncro — Legal & Operational Blueprint + Commercial Narrative

---

## PART I — SOFTWARE IDENTITY DEFINITION

### 1.1 Legal Entity & Jurisdictional Registration

**Legal Name:** LaSyncro Ltd. *(recommended: incorporate in Delaware, USA for US market; with EU subsidiary or representative for GDPR compliance)*

**Data Controller Designation:** LaSyncro Ltd. acts as **Data Controller** for account/identity data and **Data Processor** for all merchant operational data (orders, inventory, supplier, workforce records).

**Contractual Instrument:** Users accept a **Master Subscription Agreement (MSA)** combining Terms of Service + DPA at onboarding — clickwrap acceptance, timestamped, stored immutably per shop.

**Presentation to Users:** LaSyncro presents as a **B2B SaaS platform** — not a consumer product. All legal instruments are business-to-business. Individual user accounts exist only in the context of a Shop (tenant). No standalone consumer accounts.

---

### 1.2 Software Identity Statement

> *LaSyncro is the operational central nervous system for SMB commerce — a single, governed source of truth that replaces fragmented spreadsheets, siloed platforms, and manual firefighting with structured workflows, automated intelligence, and actionable signals.*

---

## PART II — USER IDENTITY & ACCESS BOUNDARIES

### 2.1 Role Hierarchy (RBAC)

| Role | Scope | Key Permissions |
|---|---|---|
| **Owner** | Shop-wide | All permissions. Billing. User management. Data export. Delete shop. |
| **Admin** | Shop-wide | All operational permissions. Cannot manage billing or delete shop. |
| **Operator** | Task-scoped | WMS pick/pack/stow. Receive sessions. No financial data. No settings. |
| **Read-Only** *(planned)* | Shop-wide | View dashboards only. No mutations. |

**Enforcement:** Role is stored in `shop_memberships.role` (source of truth post WM-19). JWT carries role claim. Backend enforces via `requireRole()` middleware on every route. Frontend gates are secondary — never sole enforcement.

**Delegation of Authority:** Only Owner can promote to Admin. Only Owner/Admin can invite Operators. Self-demotion by Owner is blocked (prevents lockout).

**Authentication Standards:**
- Password minimum: 12 characters, bcrypt hashed
- Session: JWT + refresh token rotation
- MFA: planned (TOTP) — required for Owner on Scale tier
- SSO: planned — SAML/OIDC for Growth/Scale tiers

**Account Ownership:** The Shop is the legal tenant. The Owner role is the accountable party. If an Owner leaves, another Owner must be designated before departure — enforced in offboarding flow.

---

## PART III — DATA BOUNDARIES

### 3.1 Data Ownership

| Data Type | Owner | LaSyncro Role |
|---|---|---|
| Orders, products, customers (Shopify-sourced) | Merchant | Processor |
| Supplier records, POs, workforce data | Merchant | Processor |
| Aggregated anonymized benchmarks | LaSyncro | Controller |
| Account/identity data (users, roles) | LaSyncro | Controller |
| Usage metrics, telemetry | LaSyncro | Controller |

**Core Principle (Nissenbaum — Contextual Integrity):** Data collected in one context (e.g. Shopify order sync) is never repurposed outside that context (e.g. sold to advertisers, used for competitor benchmarking without anonymization). This is a hard architectural constraint — not just a policy.

### 3.2 Prohibited Data Types

LaSyncro must never store:
- Payment card data (PCI scope — Shopify owns this)
- Government ID numbers
- Biometric data
- Health/medical data
- Data on individuals under 16

### 3.3 Data Portability & Retention

**Export:** Merchant can export all operational data (orders, POs, suppliers, inventory, workforce) in JSON/CSV at any time. Available to Owner/Admin only. Delivered within 72 hours of request.

**Retention on Termination:** Data retained for 30 days post-termination. Merchant receives one export reminder at day 1 and day 25. After day 30 — cryptographic deletion, certificate issued on request.

**Subprocessors:** Primary subprocessors at launch:
- PostgreSQL hosting (Fly.io / Supabase)
- Shopify (integration source)
- Stripe (billing)
- Expo / APNs / FCM (push notifications)
- open.er-api.com (exchange rates — anonymized, no merchant data)

Full subprocessor list maintained at `lasyncro.com/legal/subprocessors` — 30 days notice before adding new subprocessors with merchant data access.

### 3.4 Row-Level Security Guarantee

Every table storing merchant operational data enforces PostgreSQL RLS via `app.current_tenant`. This is a **hard architectural invariant** — cross-tenant data leakage is architecturally prevented, not just policy-prevented. Auditable via `check_rls.sh`.

---

## PART IV — USAGE BOUNDARIES

### 4.1 Fair Use & Plan Limits

| Limit | Free | Core | Growth | Scale |
|---|---|---|---|---|
| Active POs/month | 3 | 20 | 100 | Unlimited |
| Suppliers | 3 | 5 | 10 | Unlimited |
| Operators | 1 | 3 | 10 | Unlimited |
| API calls/min | 30 | 120 | 300 | 1000 |
| Data export | Manual | Manual | Scheduled | Scheduled + API |
| WMS sessions | 1 | 10 | Unlimited | Unlimited |

### 4.2 Prohibited Conduct

Users must not:
- Reverse engineer, decompile, or extract LaSyncro source code
- Scrape LaSyncro APIs beyond plan rate limits
- Resell or white-label LaSyncro without written agreement
- Use LaSyncro to process data for third parties (agency use requires separate MSA)
- Attempt cross-tenant data access
- Submit false or misleading data to manipulate supplier ratings or operational signals

### 4.3 Uptime Commitment (SLA)

| Tier | Uptime Target | Credit Trigger |
|---|---|---|
| Free | Best effort | None |
| Core | 99.5% | < 99% in a calendar month |
| Growth | 99.7% | < 99.5% |
| Scale | 99.9% | < 99.7% |

Credits applied as subscription extension — not cash refunds. Excludes scheduled maintenance (48h notice) and force majeure.

---

## PART V — LIABILITY & INDEMNIFICATION

### 5.1 Limitation of Liability

LaSyncro's aggregate liability to any merchant in any 12-month period shall not exceed the **fees paid by that merchant in the prior 3 months**.

Excluded from limitation (LaSyncro remains liable):
- Data breach caused by LaSyncro's negligence
- Wilful misconduct
- Death or personal injury

### 5.2 Merchant Indemnification Triggers

Merchant indemnifies LaSyncro for claims arising from:
- Data submitted by merchant that violates third-party rights
- Merchant's misuse of exported data
- Merchant granting excessive permissions to operators who cause harm
- Merchant's violation of Shopify or other platform ToS via LaSyncro integration

### 5.3 Disclaimer of Warranties

LaSyncro provides operational intelligence signals (margin, demand, supplier ratings) as **informational tools only**. These signals do not constitute financial, legal, or procurement advice. Merchants remain solely responsible for all business decisions made using LaSyncro data.

---

## PART VI — COMPLIANCE SCAFFOLDING

### 6.1 GDPR/CCPA Readiness

| Requirement | LaSyncro Implementation |
|---|---|
| Lawful basis | Contractual necessity (MSA) |
| Data subject rights | Export + deletion via Owner dashboard |
| DPA | Embedded in MSA — auto-accepted at signup |
| Breach notification | 72h to affected merchants; merchants notify their customers |
| Data minimisation | Only data necessary for operational function collected |
| Cross-border transfer | Standard Contractual Clauses (SCCs) for EU→US transfers |

### 6.2 SOC 2 Type II Controls Mapping (Target)

| Control Domain | Current State | Target |
|---|---|---|
| Access Control | RBAC + RLS enforced | MFA for Owner |
| Audit Logging | Console logs | Pino structured (INFRA-001) |
| Encryption at Rest | Fly.io / managed DB | Verify + document |
| Encryption in Transit | TLS enforced | Certificate pinning planned |
| Incident Response | Ad hoc | Formal runbook needed |
| Vendor Management | Informal | Subprocessor register maintained |

### 6.3 Breach Notification Protocol

1. Detection → internal P0 incident declared within 1 hour
2. Scope assessment within 4 hours
3. Affected merchant notification within 72 hours (GDPR clock)
4. Regulatory notification where required (GDPR supervisory authority if >250 employees affected or high risk)
5. Post-mortem published to affected merchants within 14 days

---

## PART VII — CONTRACT LIFECYCLE MECHANICS

### 7.1 Acceptance Mechanism

**Clickwrap** — explicit checkbox at signup: *"I agree to LaSyncro's Master Subscription Agreement, Privacy Policy, and Data Processing Agreement."* Timestamp, IP address, and user agent stored immutably at acceptance. No browsewrap — B2B context requires explicit consent.

### 7.2 Modification Notice

Material changes to MSA or DPA: **30 days written notice** via email to Owner. Continued use after notice period = acceptance. If merchant objects: right to terminate without penalty within notice period and receive pro-rata refund.

### 7.3 Termination Conditions

**By Merchant:** Any time. Data export window: 30 days. No penalty on monthly plans. Annual plans: pro-rata refund minus 10% early termination fee.

**By LaSyncro:** Immediate for: prohibited conduct, non-payment after 14-day cure period, legal requirement. 30 days notice for any other reason with pro-rata refund.

**Post-Termination:** Read-only access for 30 days. Export only. No new data ingestion. Cryptographic deletion at day 30.

---

## PART VIII — COMMERCIAL NARRATIVE

### How LaSyncro Resolves SMB Commerce Pain Points

---

### The Problem: Fragmentation, Silos, and Daily Firefighting

Every SMB commerce operator knows the feeling. It is 8am. Three customer emails about delayed orders sit unanswered. A supplier is asking for confirmation on a PO that was negotiated over WhatsApp three weeks ago and nobody can find the thread. The warehouse operator is asking which shelf the new stock goes on because the location spreadsheet was last updated in February. The owner is running margin calculations in Excel using last month's exchange rates. And somewhere in all of this, a restock that should have arrived Tuesday is now four days late with no update from the supplier.

This is not a failure of effort. SMB operators work extraordinarily hard. This is a failure of infrastructure. The tools they use — spreadsheets, email, WhatsApp, disconnected platforms — were not designed to work together. Every insight requires manual assembly. Every decision is made on incomplete, stale, or fragmented data. Every day is a firefighting shift.

LaSyncro exists to end this.

---

### The Solution: A Single Operational Central Nervous System

LaSyncro is not another tool to add to the stack. It is the connective tissue that makes the existing stack coherent. It ingests data from where it lives — Shopify orders, supplier agreements, warehouse movements, workforce schedules — and produces a single, governed, real-time picture of the business.

**Data Fragmentation → Single Source of Truth**

Every order, every product variant, every supplier PO, every warehouse location, every operator shift exists in one system with one identity (`lasyncro_variant_id`, `lasyncro_order_id`). When a product arrives from a supplier, gets stowed on a shelf, gets picked for an order, and gets shipped to a customer — every step is connected. No manual reconciliation. No spreadsheet merges. No version conflicts.

**Data Silos → Connected Intelligence**

In a fragmented stack, a margin problem in finances has no connection to a supplier fill rate problem in procurement, which has no connection to a pick exception in the warehouse. In LaSyncro, these signals are the same signal viewed from different angles. A supplier who consistently delivers 80% of ordered quantities creates a fill rate signal in the Suppliers Portal, a stock risk signal in the Demand module, a margin compression signal in Finances, and a pick exception pattern in WMS — all automatically, all connected, all actionable.

**Excel Chaos → Governed Workflows**

Purchase orders negotiated on WhatsApp become structured records with line items, ETAs, and supplier accountability. Warehouse locations become scannable barcodes with hierarchical structure. Workforce shifts become scheduled tasks with financial implications. The information that used to live in someone's head or inbox now lives in a system that enforces structure, tracks history, and produces accountability.

**Daily Firefighting → Proactive Signals**

LaSyncro's Morning Brief tells the owner what needs attention before the day begins. Stock-out risk signals surface before the customer complains. Supplier delivery delays trigger alerts before the pick batch fails. Margin compression appears before the month-end review. The owner stops reacting and starts operating.

---

### The Five Operational Transformations

**1. From Order Chaos to Order Intelligence**

Every Shopify order is ingested, enriched with margin data, constraint-checked, and risk-scored. Operators see not just what orders exist but which orders are at risk, which are blocked, which are approaching SLA breach. The order list becomes a prioritised action queue — not a flat export.

**2. From Supplier Guesswork to Supplier Accountability**

Every supplier interaction — PO creation, ETA commitment, delivery, quality — is recorded and computed into an objective supplier rating: on-time rate, fill rate, defect rate, average delivery delta. Over time, LaSyncro tells the owner which suppliers are reliable and which are costing them money through lateness and shortfalls — without any manual tracking.

**3. From Warehouse Chaos to Warehouse Governance**

Every location has a code and a barcode. Every product has a system identity. Every pick, pack, stow, and receive action is tracked. Operators work from structured task queues, not verbal instructions. Exceptions are recorded, not forgotten. Inventory accuracy improves with every session.

**4. From Inventory Blindness to Inventory Truth**

Inventory is not a number in a spreadsheet. It is a ledger of movements — received, stowed, picked, shipped, returned, defected. LaSyncro maintains this ledger in real time. Stock levels are derived from actual movements, not manual counts. Restock needs are predicted from demand velocity and current stock, not from gut feel.

**5. From Workforce Chaos to Workforce Intelligence**

Shifts are scheduled against task load — heavy receiving weeks trigger workforce recommendations. Operator performance is visible — pick accuracy, session completion time, exception rates. Workforce costs are tracked against operational output. The owner knows whether they have the right people in the right place at the right time.

---

## PART IX — NEGOTIATION CHEAT SHEET

### What Can Bend

| Term | Flexibility |
|---|---|
| Payment terms | Net-30 for annual contracts on Growth/Scale |
| SLA credit percentage | Up to 15% monthly credit for Scale tier |
| Subprocessor notice period | Can extend to 60 days for enterprise-adjacent SMBs |
| Data retention post-termination | Can extend to 90 days for Scale tier |
| Custom DPA | Acceptable for Scale tier — use standard SCCs as base |
| Onboarding support | Negotiable as paid add-on |

### What Cannot Bend

| Term | Reason |
|---|---|
| RLS tenant isolation | Architectural invariant — non-negotiable |
| No resale / white-label without written agreement | Core commercial protection |
| Liability cap at 3 months fees | Insurance and financial viability |
| Data deletion at 30 days post-termination | GDPR obligation |
| No PCI data storage | Regulatory — absolute |
| Owner role required at all times | Prevents orphaned tenants |
| Clickwrap acceptance required | Legal enforceability |
| No financial/legal advice warranty | Regulatory — absolute |

---

*Blueprint version 1.0 — LaSyncro Ltd. — April 2026*
*For legal review before public deployment. This document is a strategic blueprint, not a filed legal instrument.*