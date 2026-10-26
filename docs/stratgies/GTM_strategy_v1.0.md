# LaSyncro GTM Strategy v1.0

**Status:** APPROVED AND RATIFIED — strategy and operating-model principles\\
**Approval date:** 2026-10-26\\
**Document type:** Product-adjacent go-to-market strategy; operating directives and agent handoff reference\\
**Primary audience:** LaSyncro founders, GTM operators, and authorized VS Code / engineering agents\\
**Initial geography:** Sweden, with an initial research concentration around Gothenburg, Borås, and Helsingborg\\
**Initial program:** GTM-01 — Merchant Intelligence & Partner Acquisition Foundation\\
**Version:** 1.0\\
**Implementation state:** Strategy approved; implementation, vendor purchases, partner agreements, outreach, integrations, and automations **are not implicitly approved or completed**.

> **Important status convention:** In this document, **RATIFIED** refers to the agreed strategic model and principles. **PROPOSED / EXPERIMENTAL** describes operating parameters to test, not immutable commitments. **REQUIRES AUTHORIZATION** means no execution without explicit lead approval. Research hypotheses and named organizations are not established business relationships.

---

## 1. Purpose, mission, and success definition

### 1.1 Mission

Build a defensible, cost-conscious, lawful, evidence-based customer acquisition operating system for LaSyncro. It must reliably discover Shopify-first ecommerce merchants that operate their own stockrooms or warehouses; identify which are experiencing relevant operational friction; and convert qualified demand through direct outreach and trusted partner introductions.

### 1.2 Strategic outcome

A repeatable process that produces **retained, paying merchants with measurable operational improvements** at sustainable customer acquisition cost (CAC). The output is not a large unqualified database, a high volume of cold emails, numerous inactive partnership agreements, or a generic analytics platform.

### 1.3 Positioning

LaSyncro is the **warehouse operating layer between Shopify-native fulfillment and heavyweight WMS/ERP**.

The core merchant problem is fragmentation: disconnected inventory and fulfillment information, spreadsheet-based operations, inventory discrepancies, weak traceability, and recurring day-to-day warehouse firefighting.

**Working merchant value proposition:**

> Run your warehouse without the spreadsheets, stock discrepancies, and daily firefighting—from receiving stock to shipping orders, connected to Shopify.

This is **positioning**, not evidence that every capability is already production-ready. Claims in sales materials must match independently verified product capabilities and real merchant outcomes.

### 1.4 How the strategy wins

1. Find **correct-fit merchants** before trying to reach them.
2. Find **buying triggers** and **adoption readiness**, not just company attributes.
3. Offer a **useful diagnostic** that lets merchants identify problems without installing LaSyncro.
4. Acquire through **independently sourced intelligence (Asset A)** and **permission-based trusted partnerships (Asset B)**.
5. Improve segmentation based on **interviews, activated pilots, paying customers, retention, and observed outcomes**.
6. Automate repetitive, verified steps only after the manual workflow produces economic evidence.

---

## 2. Ratified decisions versus open decisions

### 2.1 Ratified operating principles — do not silently change

- Maintain **exactly two complementary GTM assets** feeding **one logical CRM and sales funnel**.
- **Asset A:** evidence-based merchant intelligence; identify stores, companies, candidate physical facilities, warehouse ownership, operational triggers, and relevant contacts.
- **Asset B:** a partner network producing **permission-based introductions**, starting with noncompeting or low-overlap partners that already serve the target merchants.
- Separate **ICP fit**, **warehouse-evidence confidence**, **buying trigger**, and **adoption readiness**; do not collapse these into a single unexplainable score.
- Use independent source provenance, verification timestamps, identity deduplication, and clear observed/inferred/merchant-confirmed status.
- Introduce a lightweight merchant-facing **Warehouse Health Check** as a shared conversion mechanism for direct acquisition and partner referrals; **do not require a Shopify install in its initial form**.
- Refine the ICP continuously from merchant interviews and paying customers.
- Prefer partners with actual access to the ICP, favorable commercial incentives, and **low competitive overlap** over prestigious brands with little referral feasibility.
- Develop a referral flywheel through **merchant-authorized introductions** to their existing trusted suppliers and service providers.
- Evaluate growth channels by qualified conversations, activated pilots, paid conversion, retention, CAC/payback, and stop rules—not raw lead count.
- Keep GTM prospect intelligence and credentials **separate from LaSyncro's operational/production Shopify and warehouse data**.
- Protect the current warehouse-product roadmap; GTM infrastructure must not become an unapproved competing engineering workstream.

### 2.2 Experimental parameters — calibration required

The following are **not ratified as permanent numbers or vendor commitments**:

- ICP scoring weights and thresholds.
- Conversion rates, CAC assumptions, churn assumptions, and payback targets.
- Subscription pricing, incentives, referral fees, or attribution windows.
- Specific CRM, data vendors, enrichment subscriptions, or integration tooling.
- The exact set of cities after the initial Swedish validation.
- Final diagnostic questions and scoring rubric.
- Specific partner organizations, commercial terms, or outreach sequences.

Agents may **recommend** modifications with evidence. They must **not enact or describe them as approved decisions** without confirmation.

### 2.3 Approval boundary

Approval of this strategy **does not authorize** purchasing subscriptions, importing external datasets, contacting businesses, signing partnership agreements, creating CRM records in a live account, building/deploying GTM services, modifying product source code, or accessing production data. Each real-world or system-changing action requires the applicable authorization.

---

## 3. Initial ICP and qualification philosophy

### 3.1 Core ICP — initial acquisition focus

| Dimension | Preferred initial focus |
|---|---|
| Commerce | Shopify-first |
| Fulfillment | Own stockroom/warehouse; team physically executes warehouse work |
| Revenue | Approximately **USD $500K–$10M annually** |
| Warehouse workforce | Roughly **2–10 regular operators** |
| Daily order volume | Approximately **20–200 orders/day** |
| Complexity | Hundreds to several thousand SKUs/variants, or demonstrable equivalent operational complexity |
| Current systems | Shopify + spreadsheets, shipping software, lightweight inventory systems, and/or manually coordinated workflows |
| Typical pain | Inventory drift, receiving confusion, fulfillment errors, unclear ownership, weak traceability, rising warehouse workload |
| Primary contacts | Owner/founder, ecommerce/operations lead, warehouse manager, or appropriate decision-maker |

### 3.2 Adjacent market — research, not default targeting

Merchants between approximately $100K and $20M in annual revenue, 1–10 warehouse operators, and adjacent configurations may be attractive; they are **not automatically first-priority**. Capture exceptions with reasons, rather than widening the core ICP silently.

### 3.3 Critical exclusions / caution flags

- Dropshipping-only stores or brands where all fulfillment is performed by a third-party logistics provider (3PL).
- Merchants already operating a suitable WMS with little dissatisfaction or change trigger.
- Organizations requiring enterprise-scale or specialized warehouse functionality outside proven LaSyncro product scope.
- Merchant requirements that demand undocumented features, unsupported integrations, or high-touch customization as a prerequisite.
- Very low-complexity or inactive storefronts.
- Inadequate legal/commercial basis to use the contact data or make the proposed outreach.

**Rule:** Merchant revenue and product count are useful filters, not substitutes for verifying physical operations and a real problem.

### 3.4 Three distinct priority dimensions

1. **ICP fit:** Is the merchant objectively an appropriate type of customer?
2. **Buying trigger:** Is there evidence of an operational problem, relevant change, or near-term need?
3. **Adoption readiness:** Does the merchant have decision-making capacity, willingness to evaluate, and an achievable deployment path?

Track **evidence confidence independently** for all three.

---

## 4. Two-asset operating architecture

```text
ASSET A — MERCHANT INTELLIGENCE           ASSET B — PARTNER NETWORK
Discover storefronts / companies          Discover prospective partners
        |                                           |
Resolve identity & enrich                 Verify ICP overlap & incentives
        |                                           |
Verify in-house warehouse                 Qualify / contact partner
        |                                           |
Detect buying triggers                    Agree pilot + referral rules
        |                                           |
Score & approve for contact               Merchant-authorized introduction
        +-------------------+-----------------------+
                            |
            SHARED IDENTITY + EVIDENCE + COMPLIANCE
                            |
                  ONE CRM / ONE SALES FUNNEL
                            |
       Discovery -> Health Check -> Pilot -> Paid -> Retained
                            |
           Channel economics + customer learning loop
```

**Do not double-count** a merchant originating in Asset A and later introduced by a partner. Preserve both source events; report one primary acquisition attribution and optional assisted attribution.

---

## 5. Asset A — Merchant Intelligence workflow

### A0. Authorize and register each source

Before using a source, document:

- Source and accountable owner.
- Permitted access method (official API, manual research, licensed export, etc.).
- Relevant terms/licensing limits, retention and redistribution restrictions.
- Allowed purpose and whether personal data may be included.
- Rate limits, subscription cost, refresh policy, and geographic coverage.
- Fields the source *actually* provides versus inferred fields.
- Authorization status and last review date.

**Never** bypass source access controls, harvest private carrier records, use unauthorized scraping, or treat purchased data as freely reusable or redistributable.

### A1. Discover Shopify merchants

Prioritize Shopify-first stores with product/catalog complexity and signs of actual fulfillment operations. Discovery inputs may include:

- Licensed ecommerce technology/merchant intelligence (e.g., Store Leads, subject to license review).
- Public merchant websites, shipping/returns pages, career pages, product catalogs, business announcements.
- Public or licensed company databases and business directories.
- Industry associations and public member directories.
- Partner-originated leads that satisfy referral and consent rules.

Capture **source, retrieval time, observed values, and exact support**. Installed-app signals, sales estimates, carrier indicators, and storefront product counts may be inaccurate or incomplete and must be labeled accordingly.

### A2. Resolve business identity

Distinguish **brand**, **storefront**, **legal entity**, **physical site**, **contact**, and **opportunity**.

Identity keys:

- Legal entity: country + registration/organization number when established.
- Storefront: normalized canonical domain plus platform account evidence where lawfully available.
- Swedish workplace: SCB CFAR identifier if available.
- Facility: normalized address and associated organization with a stable internal ID.

**Do not assume:** one domain = one company; one company = one brand; registered workplace = warehouse; carrier pickup location = owned warehouse.

Where automated matching is ambiguous, quarantine the candidate for manual review rather than merging.

### A3. Enrich company and workplace information

For Sweden, evaluate **SCB business register / workplace data** as a primary official source; access and specific fields must be verified before implementation. Other company financial sources should be accessed using permitted interfaces or licensed datasets.

Store revenue and workforce data as reported band/estimate with provenance. Preserve the difference between employees in the entire organization and warehouse operators.

### A4. Verify warehouse / self-fulfillment

Assign one of the following statuses:

| Status | Minimum evidentiary meaning | Action |
|---|---|---|
| **Confirmed** | Merchant or independently authoritative source explicitly confirms self-operated physical fulfillment | ICP-fit assessment eligible |
| **Probable** | Multiple independent and credible indicators support in-house operations | Targeted validation; mark unconfirmed |
| **Unknown** | Insufficient or contradictory evidence | Research; do not present as verified |
| **Disconfirmed** | Reliable evidence says entirely outsourced or otherwise out of scope | Exclude/park unless facts change |

Candidate signals: warehouse jobs, publicly identified fulfillment sites, stockroom photos with context, facility references on merchant channels, equipment expansions, relevant staff biographies, or merchant interviews. A registered workplace alone does **not** confirm warehouse operation.

### A5. Detect operational buying triggers

Suggested signal classes:

- Hiring or reorganizing warehouse operations.
- Opening, relocating, or expanding storage/warehouse capacity.
- Increasing catalog/variant complexity or entering new fulfillment channels.
- Publicly stated problems with fulfillment speed, inventory reliability, or operational scaling.
- Newly adopted shipping/ERP/stock tools or a planned systems replacement.
- Direct merchant disclosure of recurring errors, manual reconciliation, or onboarding challenges.

Store each trigger with event date, first-seen date, origin, confidence, relevance, and expiry/recheck rule. **Signals are hypotheses until confirmed**; do not infer private shipment volumes or invent buyer intent.

### A6. Evaluate fit, trigger, and readiness separately

Suggested dimensions for a **provisional** rubric:

- Fit: Shopify, physical fulfillment, operator count, warehouse complexity, commercial suitability.
- Trigger: urgency, operational cost of current workarounds, active change events.
- Readiness: right decision-maker, feasible pilot scope, integration/onboarding constraints, budget/willingness to evaluate.
- Confidence: evidence quality, independent corroboration, recency.

Do not silently fix numerical weighting. If an implementation requires scores, first propose a versioned rubric, data examples, and calibration method for approval. Missing fields must remain **unknown**, not coerced to false.

### A7. Promote only sales-usable accounts

Suggested Asset A states:

1. **Discovered** — Shopify merchant found.
2. **Identity resolving** — legal entity / brand linkage incomplete.
3. **Researching** — enriching and validating warehouse operation.
4. **Candidate** — potentially strong fit; one or more critical uncertainties.
5. **Outreach eligible** — sufficient evidence, valid contact route and approved compliance checks.
6. **Sales qualified** — direct merchant confirmation of meaningful fit and opportunity.
7. **Disqualified / parked** — explicit reason and reactivation condition if any.

A high fit score without verified contact legality or sufficient evidence does not make an account outreach eligible.

### A8. Maintain intelligence quality

- Refresh new discoveries and priority signals according to documented cadence.
- Reassess active prospect details before key outreach.
- Date-stamp every source assertion; define reasonable freshness periods by field.
- Record contradictions and corrections instead of overwriting evidence silently.
- Track disqualification reasons and false positives to improve sourcing.
- Reuse existing canonical company records rather than cloning accounts.

---

## 6. Asset B — Partner Network workflow

### B1. Partner priority order

Initially prioritize partners with clear ICP access and low competitive overlap:

1. Shopify agencies, ecommerce systems integrators, and ecommerce consultants.
2. Warehouse equipment, barcode/Auto-ID, label printer, shelving, and packaging solution vendors serving SMB merchants.
3. Logistics and warehouse operations consultants; ecommerce industry networks.
4. Complementary shipping and delivery software platforms.
5. Carrier integration/ecosystem teams and larger industry operators for longer-horizon distribution and co-marketing.

**Potential organizations to evaluate, not confirmed partners:** Shopify agencies in western Sweden; E-handelsstaden Borås and relevant logistics networks; nShift, Sendcloud, Shipmondo, Ingrid; warehouse equipment/packaging providers; PostNord's public integration-partner route. Revalidate current details and commercial compatibility before outreach.

### B2. Partner assessment

Capture independently:

- ICP overlap and examples of merchants served.
- Access to a relevant decision-maker and credible referral pathway.
- Competitive overlap / incentive conflicts.
- Possible value provided to the partner (better merchant retention, implementation revenue, integration coverage, education, referral fee).
- Commercial and technical effort required.
- Data-sharing feasibility and legal/privacy considerations.
- Partner relationship owner and status.

Avoid selecting partners on brand recognition or claimed customer count alone.

### B3. Partner lifecycle

`Identified -> Researched -> Qualified -> Contact approved -> Engaged -> Pilot proposed -> Pilot agreed -> Active -> Productive / Inactive / Closed`

Maintain distinct states for commercial agreement, technical integration, and actual referral productivity. A signed document or partner-directory listing is **not** proof of an active acquisition channel.

### B4. Partner value propositions by category

| Partner class | Useful offer | Low-friction first test |
|---|---|---|
| Shopify agency/integrator | Address client warehouse pain; possible service opportunity | Co-hosted discovery or 1–3 opted-in introductions |
| Auto-ID / warehouse supplier | Add warehouse-process software option to equipment projects | Merchant-facing Warehouse Health Check |
| Logistics consultant | Practical system for clients needing execution discipline | Joint assessment and referred pilot |
| Shipping platform | Better upstream order/warehouse execution; possible ecosystem coverage | Joint educational content or co-qualified lead |
| Carrier/ecosystem team | Improved fulfillment handoff for merchant segment | Integration-partner discovery / webinar, not shipper database request |

### B5. Referral handling — default consent-based

1. Partner identifies a relevant merchant problem.
2. Partner explains LaSyncro and **asks whether the merchant wants an introduction**.
3. Partner submits the minimum necessary authorized business details, or the merchant completes the diagnostic/introduction form directly.
4. LaSyncro checks duplicate company records, suppression status, conflicts, referral eligibility, and partner attribution.
5. Accepted referral enters the same sales pipeline as Asset A leads.
6. Any commission is determined only under an explicitly approved agreement and eligible collected revenue.

**Do not request or accept unrestricted partner customer databases or confidential carrier/parcel records.** Large-scale sharing needs separate privacy, legal, commercial, and security reviews.

### B6. Partner attribution and commercial terms

Document before accepting compensated referrals:

- First-introduction evidence and time.
- Merchant's authorization / opt-in record.
- Existing account/opportunity overlap and conflict handling.
- Referral qualification requirements.
- Primary vs assisted channel attribution.
- Commissionable revenue, deductions/refunds, payment timing, and clawbacks.
- Termination, privacy and confidentiality terms.

**No referral percentage, fee, exclusivity period, or attribution window is preapproved by this strategy.** Propose terms for approval with a financial model.

### B7. Merchant-driven partner flywheel

After a successful onboarding or review, *optionally* ask a merchant whether they would introduce trusted agencies, equipment suppliers, shipping partners, or consultants. Record only introductions that are authorized. Never mine Shopify production data or client system integrations for prospecting relationships by default.

### B8. Partner retention

Keep product updates and relevant merchant-use cases available to partners. Review active partnerships by qualified introductions, pilot starts, paid subscriptions, merchant outcomes, and support overhead. Pause or redesign nonproductive programs before expanding them.

---

## 7. Shared Warehouse Health Check

### 7.1 Intended role

A lightweight, merchant-facing diagnostic serving both direct prospects and partner referrals. The tool should create immediate standalone value while generating first-party, self-reported context for optional follow-up.

**Initial version must not require Shopify installation, OAuth, access to orders/customers, or warehouse production credentials.**

### 7.2 Minimum merchant input

Keep the assessment short (approximately six questions; provisional):

1. Typical daily orders / fulfillment volume.
2. Number of warehouse operators.
3. How incoming stock / purchase orders are received and verified.
4. How stock accuracy and discrepancies are checked.
5. Largest current warehouse friction (errors, delays, visibility, traceability, coordination).
6. Current operational tools and degree of spreadsheet/manual dependence.

Make contact details **optional and separate** from delivering the basic value. If personal data is collected, provide clear notices and appropriate choices for future contact.

### 7.3 Output contract

- Acknowledge what was **self-reported**.
- Identify likely improvement areas with assumptions and limitations.
- Provide 2–3 practical next steps applicable even without purchasing LaSyncro.
- Optionally offer a short discussion or pilot evaluation.
- Avoid false precision, unsupported ROI percentages, automated guarantees, or claims of performing an inventory audit.

### 7.4 Initial implementation constraint

Start as a **simple form with rules-based output**. A custom app, live Shopify analysis, sophisticated AI scoring, or CRM-integrated web service requires separate product, security, privacy, and engineering authorization after conversion value is demonstrated.

---

## 8. Shared sales and onboarding funnel

Suggested standard stages:

1. **Research-ready** — potential merchant identified, not yet sales qualified.
2. **Outreach eligible** — documented source and compliant route approved.
3. **Contacted / introduced** — outreach sent or merchant-authorized introduction completed.
4. **Discovery** — actual conversation about warehouse operations.
5. **Qualified opportunity** — confirmed relevant pain, decision-maker, and achievable next step.
6. **Pilot proposed** — scoped workflow, acceptance criteria, baseline and commercial terms identified.
7. **Pilot active** — real merchant trial operating within verified product capabilities.
8. **Pilot evaluated** — baseline versus outcome recorded.
9. **Won / lost / deferred** — decision and reason captured.
10. **Activated / retained / expanded** — post-sale status with ongoing operational outcomes.

Use the Warehouse Health Check where useful, **not as a mandatory gate**. A partner-introduced merchant with an urgent problem may go straight to discovery.

### 8.1 Sell the current product, not the aspirational roadmap

Early commercial messaging should be anchored in demonstrably working operations around the Shopify catalog -> LaSyncro product registry -> PO creation -> receiving path, as appropriate to current verified releases. Broader claims covering held defects -> Problem Center -> recovery -> stow, pick, pack, returns, and full inbound-to-outbound exception traceability must match actually certified, usable product scope.

Do not shift warehouse engineering priorities to satisfy an unapproved GTM experiment, and do not describe a planned feature as shipped.

### 8.2 Pilot success contract

Each pilot should document:

- Merchant's confirmed pain and context.
- Specific workflow included / excluded.
- Pre-pilot baseline and measurement method.
- Operator onboarding and time-to-first-useful-result.
- Observable outcome (e.g., fewer receiving discrepancies, less reconciliation time, better traceability).
- Support burden and implementation effort.
- Merchant feedback, renewal/paid conversion, and reasons for failure if any.

**No invented ROI, error rates, cost savings, or production-readiness claims.**

---

## 9. Data model and information architecture

Use one logical CRM and structured evidence data. Prefer existing CRM primitives before developing dedicated infrastructure.

| Entity | Required concepts |
|---|---|
| `Company` | Internal ID, legal identity, jurisdiction, business status, industry, revenue band |
| `Brand` | Trade name, associated company, source |
| `Storefront` | Canonical domain, platform, store status, catalog signals, linked company |
| `Facility` | Internal site ID, country, address/workplace identifier, type, operator, verification status |
| `Evidence` | Subject, claim, value, source, observation type, confidence, observed date, retrieved date, permissions |
| `Signal` | Type, affected merchant, event date, supporting evidence, confidence, expiry/review date |
| `Contact` | Business role, lawful contact route, source, permitted use, contact/suppression state |
| `Partner` | Company, category, relationship owner, qualification, status, risks, agreements |
| `Referral` | Partner, merchant, authorization proof, timestamp, primary/assisted attribution, status |
| `Opportunity` | Canonical merchant, stage, origin, expected commercial value, owner, next action |
| `Pilot` | Scope, baseline, measures, activity, result, merchant decision |
| `Suppression` | Scoped restriction, effective date, reason, enforcement across ingestion/outreach |
| `SourceRegister` | Provider, license, approved use, endpoint/import method, access owner, retention |

### 9.1 Data quality contract

Each material attribute should carry:

- **Value** (including explicit `unknown`).
- **Provenance** (source ID / URL or allowed internal interview record).
- **Observation type:** `observed`, `inferred`, or `merchant_confirmed`.
- **Confidence:** `confirmed`, `probable`, `unknown`, or `contradictory` as appropriate.
- **Observed/retrieved/verified dates** and owner.
- **Permitted use** and any handling restrictions.

A derived score must be reproducible from recorded inputs. Preserve older evidence and conflicts; do not silently overwrite contradictory facts.

### 9.2 Identity and deduplication rules

- Canonical company keyed by trusted country + registration ID when available.
- Normalize domains consistently (redirects and aliases reviewed before merging).
- One company may own multiple brands, storefronts and locations.
- A warehouse facility may be shared or third-party operated; ownership is an evidence field, not inferred from an address alone.
- Match contact identities carefully; do not infer personal identity from a shared email alias.
- Automated merges on weak identifiers require human review.
- Preserve all discovery/referral touchpoints, but avoid duplicate active sales opportunities.

### 9.3 Implementation separation

Do **not** couple GTM intelligence with LaSyncro's merchant operational databases, fulfillment events, customer/order personal data, production Shopify tokens, or auth/tenant data. Establish a distinct access and secrets boundary. Reuse external business tools as appropriate. New database services/integrations require an approved design and build scope.

---

## 10. Source and partner research register

These are **evaluation categories**, not approved procurement or verified active partnerships.

| Category | Candidate examples | Primary value | Verification / risk |
|---|---|---|---|
| Ecommerce intelligence | Store Leads and alternatives | Shopify discovery, app/catalog signals | License, field accuracy, export/API usage |
| Official Swedish register | SCB company/workplace data | Legal and workplace identity | Does not prove a site is a warehouse |
| Company financial data | Licensed business registers, public filings | Revenue and company size | Freshness, rights, legal entity mapping |
| Public company footprint | Merchant websites, job listings, announcements | Self-fulfillment indicators and triggers | Source quality and permitted access |
| Shopify agencies | Regional Shopify specialists | Trusted account introductions | ICP overlap, client permission |
| Warehouse suppliers | Auto-ID, label, storage, packaging vendors | Physical warehouse buying signals | Some enterprise-heavy; no automatic client-data access |
| Logistics consultants/networks | Industry associations / consultants | Local credibility and workshops | Conversion path must be explicit |
| Shipping software | nShift, Sendcloud, Shipmondo, Ingrid | Merchant context, ecosystem referrals | Potential software overlap and legal constraints |
| Carriers | PostNord, DHL, FedEx | Integration/ecosystem reach | Customer/shipment data generally sensitive and difficult to access |

**Carrier-specific policy:** Use documented partnerships, educational campaigns, integration discussions, and authorized introductions; never try to acquire private driver-route logs, delivery manifests, nonpublic shipper lists, or confidential shipping volume data.

---

## 11. Privacy, compliance, and security controls

**This document is an operating policy, not a legal opinion.** Obtain jurisdiction-specific review for data use and outbound marketing before activating relevant workflows.

### 11.1 Required controls

1. **Source legality / license:** Track whether each import and usage is permitted.
2. **Purpose limitation / minimization:** Collect only information necessary to qualify business prospects and manage authorized referrals.
3. **Legal basis and transparency:** Document the basis for processing identifiable contacts and provide required notices for indirectly sourced data.
4. **Marketing restrictions:** Respect GDPR, applicable e-privacy/direct-marketing rules, objections, and local B2B outreach requirements.
5. **Suppression first:** Apply opt-outs and restrictions before creating outreach tasks or sending messages.
6. **Access controls:** MFA, least privilege, separate credentials, restricted exports, reviewed vendor access.
7. **Secure storage and transport:** Encryption, credential hygiene, backups and incident response commensurate with the data.
8. **Retention:** Record-specific deletion/review schedules; preserve minimum necessary suppression records to prevent recontact.
9. **Vendor governance:** Review processors, transfers, contracts and retention before connecting tools.
10. **Auditability:** Maintain evidence and audit records for sensitive changes, merging, referrals, suppression, and attribution.

### 11.2 Prohibited shortcuts

- Reusing app merchants' production order/customer data to prospect for LaSyncro or others without specific authorization and lawful basis.
- Importing partner or carrier customer lists merely because a partner is willing to send them.
- Bulk scraping or automated browser collection in violation of access terms or controls.
- Collecting private shipment-level recipient, route, or parcel data for sales discovery.
- Sending outreach from unapproved tools/accounts or bypassing opt-out rules.
- Exposing credentials, access tokens, personal information, or complete prospect lists in agent prompts, repository commits, or public artifacts.

### 11.3 Safe sharing with development agents

Use synthetic/redacted test data by default. For genuine prospect data, grant the smallest necessary field-level access in a controlled system, not by copying bulk exports into a Git repository. An agent must not publish merchant/contact details in issues, logs, or terminal transcripts unnecessarily.

---

## 12. Automation design and scaling boundaries

### 12.1 Good automation candidates after manual validation

- Authorized, rate-limited imports and scheduled refresh.
- URL/domain normalization and deterministic identity checks.
- Source freshness checks, quality flags, and retryable enrichment.
- Proposed lead-priority queues using an explainable ruleset.
- Duplicate alerts and potential-merge review queues.
- CRM updates on approved stage transitions.
- Suppression checks and referral attribution checks.
- Funnel dashboards and periodic reporting.

### 12.2 Human decisions that should remain gated

- Resolving ambiguous company/site identity.
- Certifying warehouse ownership without authoritative proof.
- Approving new sources, vendor contracts, privacy/legal basis, or data transfers.
- Launching email campaigns or partner outreach.
- Accepting partner commercial terms or referral disputes.
- Promising unsupported product functionality or custom implementation.
- Activating new production services, credentials, deployments, or integrations.

### 12.3 Reliability expectations for future integrations

- Idempotent imports/events and stable external-to-internal IDs.
- Bounded retry/backoff, rate-limit handling and failure quarantine.
- Per-source freshness and last-success telemetry.
- Field-level provenance; preserve unknown/conflicts.
- No silent record creation/merge on fuzzy matches.
- Data retention, deletion, and suppression propagation.
- Observability for counts imported, rejected, duplicated, qualified, and promoted.
- Reconciliation of source totals without claiming completeness when a provider is partial.

**Do not build a custom GTM platform until simpler processes have demonstrated repeatable value and the implementation is separately authorized.**

---

## 13. Measurement, attribution, and economics

### 13.1 Shared north-star

**Number of retained paying, properly activated ICP merchants acquired at sustainable fully loaded CAC, with documented operational value.**

### 13.2 Asset A metrics

- Researched merchants; number and percentage with credible self-fulfillment evidence.
- Confirmed ICP rate (not merely predicted fit).
- Cost and research time per verified ICP.
- Outreach-eligible rate and successful legal/contact verification.
- Outreach -> discovery -> opportunity -> pilot -> paid -> retained conversion.
- False-positive / disqualification reasons by source.

### 13.3 Asset B metrics

- Partners qualified, engaged, and productive (at least one accepted introduction).
- Merchant-authorized introductions per productive partner.
- Referral -> discovery -> pilot -> paid conversion.
- Partner-sourced/assisted ARR and 30/90-day outcomes.
- Fully loaded partner costs including acquisition, servicing, integration, commission and support.
- Partner concentration and competition risk.

### 13.4 Standard financial definitions

- **ARR:** monthly recurring subscription revenue × 12 for active paying subscriptions; separate from cash collected.
- **Blended CAC:** total attributable GTM cost / new paying customers in the measurement cohort; track direct and partner channels separately where feasible.
- **CAC payback (months):** CAC / monthly recurring **gross profit** per newly acquired customer, using actual gross margin assumptions.
- **Pilot -> paid:** customers who become paying / eligible completed pilots in a defined cohort.
- **Retention:** customer and net revenue retention calculated with explicitly stated period/cohort and exclusions.
- **Qualified conversations:** genuine two-way discussions with a merchant who has a relevant warehouse problem; not email opens or automated replies.

Do not report projections as outcomes. Include denominators, time windows, cohort definition and source.

### 13.5 Learning / stop-rule principle

Before running an acquisition experiment, record its hypothesis, budget/time cap, sample, pass/fail criteria and decision owner. If early evidence is weak, **diagnose and stop/adjust**, rather than scaling list volume or automation.

**Illustrative triggers (experimental, not locked):**

- After approximately 30 researched accounts, if warehouse ownership cannot be established reliably, revisit sources and qualification assumptions.
- If partner meetings repeatedly fail to yield a feasible offer or introduction path, change the value proposition or segment before broadening outreach.
- If qualified pilots fail to activate or deliver measurable benefit, stop aggressive acquisition and address the product/onboarding limitation.
- If source economics remain unfavorable after a bounded cohort, stop paying for the source until the case improves.

---

## 14. GTM-01 — first 30-day controlled validation

**Status:** Ratified *experiment outline*, not a statement that work has begun.

| Workstream | Target | Evidence required |
|---|---|---|
| Merchant discovery | Research **30** promising Shopify merchants | Source register, canonical IDs, research notes |
| Fulfillment verification | Target **10** credible self-fulfilling candidates | Independent sources and explicit confidence status |
| Merchant conversations | Target **5** relevant discovery conversations | Notes, verified pain/readiness, next action |
| Partner outreach | Approach **3** well-chosen prospective partners | Rationale, approved contact route, outreach record |
| Warehouse Health Check | Test a minimal diagnostic offer | Questions, usable output, engagement/feedback |
| Measurement | Compare source/partner quality and conversion | Cohort table, findings, next decision |

**Do not misrepresent targets as guarantees.** A researched candidate without credible evidence must not be counted as a confirmed self-fulfilling merchant; an attempted outreach is not a conversation.

### 14.1 Recommended sequence

**Days 1–7 — Foundation**

- Confirm minimal CRM properties and evidence register design.
- Confirm source usage permissions and privacy/outreach review requirements.
- Select initial research geography and shortlist candidate sources.
- Draft Warehouse Health Check questions, no-install delivery method, and transparent output.
- Define the experiment tracker, no automatic outreach.

**Days 8–15 — Merchant evidence**

- Manually research first cohort; normalize identities and record uncertainties.
- Validate warehouse ownership with independent evidence where possible.
- Revisit the qualification rubric in response to actual false positives.
- Prepare source- and trigger-specific messaging for approval.

**Days 16–23 — Commercial validation**

- Conduct approved, targeted merchant discovery.
- Approach a small number of relevant partners with specific value propositions.
- Trial the simple diagnostic with interested merchants or partners.
- Record merchant objections, buying triggers, operational requirements, and useful referral pathways.

**Days 24–30 — Decision review**

- Reconcile qualified accounts, conversations, partner activity and actual costs.
- Separate what worked, what failed, and where evidence is missing.
- Recommend narrow improvements for GTM-02, with explicit decision gates.
- Do not expand paid tooling, imports, automated outreach, or integrations by default.

### 14.2 GTM-01 acceptance criteria

**Process-complete requires:**

- Traceable legal/permitted source inventory and data fields.
- Canonical account identities; visible duplicate/conflict handling.
- Explicit warehouse-evidence classification on each reviewed candidate.
- Fit, trigger, readiness and confidence separately recorded.
- A functioning manual route into CRM/sales tracking (or a justified CRM selection proposal).
- Partner pipeline and referral authorization process defined.
- A lightweight Health Check prototype/offer with privacy-conscious handling.
- Cohort report with source yield, conversation outcomes, costs, friction and proposed next actions.

**Commercial outcome assessment** is reported separately: actual merchants researched, credible matches, conversations, partners approached, partner responses, pilots and paid conversions. Do not fail or misstate process completeness solely because early conversion targets were not achieved, but do not greenlight scaling without commercially useful evidence.

### 14.3 Proceed / hold rules for GTM-02

Proceed to targeted automation or expanded acquisition only if:

1. Sources and handling are legal/contractually usable.
2. A meaningful share of candidates can be independently validated.
3. Outreach or partner introductions produce real qualified conversations.
4. The current product can credibly serve the demand being generated.
5. Costs and implementation effort remain bounded and explainable.

Otherwise, **HOLD, diagnose, and revise a narrow hypothesis**.

---

## 15. Geographic and sector expansion

### 15.1 Initial focus

Start in Sweden where interviews, warehouse visits and partner credibility can be developed efficiently, with initial emphasis on the Gothenburg–Borås–Helsingborg ecosystem. This is a **learning and execution choice**, not a claim that those cities alone maximize market size.

### 15.2 Subsequent expansion

Additional Swedish regions, Nordic markets, and larger English-language Shopify markets should be evaluated after evidence shows repeatable qualification and conversion. Do not expand merely because aggregate Shopify store counts are high.

### 15.3 Category hypotheses

Potential segments include home/lifestyle goods, hobby/sports/pet accessories, and variant-heavy apparel/accessories. These are **discovery hypotheses**, not proven conversion rankings. Select niches according to verified fulfillment complexity, operational needs, and product readiness.

---

## 16. Operating cadence and ownership

| Cadence | Asset A | Asset B | Shared |
|---|---|---|---|
| Daily, if active | Resolve priority research / merchant responses | Respond to agreed introductions | Progress active discovery and pilots |
| Weekly | Source/verification batch and trigger review | Partner discussions and follow-up | Qualification review, false positives, blockers |
| Monthly | Source yield, freshness, costs | Productivity and relationship review | Cohort funnel, CAC, product feedback |
| Quarterly | ICP refinement and geography | Scale/stop partner programs | Channel investment decisions, roadmap alignment |

Initial accountability should be held by an explicit GTM owner. Engineering support is requested only for a bounded task with demonstrated value and approval. Every external partner and internal integration should have a named accountable owner.

---

## 17. Risk register and mitigations

| Risk | Consequence | Control |
|---|---|---|
| Mistaking storefront for physical operator | Misqualified prospects | Identity and facility evidence model |
| Misclassifying 3PL usage | Wrong ICP and wasted outreach | Explicit ownership verification |
| Confusing buying trigger with fit | Low response/conversion | Separate dimensions and timestamped signals |
| Expensive but weak list vendors | High CAC and noisy data | Small licensed trial, per-source economics |
| Competitive partners | Referral disincentive | Check overlap and select complementary channels |
| Privacy/marketing violations | Legal and trust risk | Source register, authorization, suppression, review |
| Duplicate referrals/companies | Bad attribution and partner disputes | Canonical IDs, auditable attribution |
| Product promise exceeds readiness | Churn, reputational risk | Demo/offer only verified scope |
| Premature automation/build | Roadmap distraction | Manual validation and GTM-02 gates |
| Success defined by lead count | Illusory traction | Paying/retained customers and unit economics |
| CRM as uncontrolled data warehouse | Stale and risky records | Stage gates, access, freshness, minimization |

---

## 18. Agent operating directives and change control

**This section applies when this file is given to VS Code agents.** It guides their GTM-specific reasoning and output; it does **not** replace the repository's separately provided authoritative engineering workflow or agent-operation guidelines.

### 18.1 Source of authority

1. Follow higher-priority platform instructions, security constraints and applicable law.
2. Follow the project's current authorized engineering workflow and agent-operation guidelines for repository tasks.
3. Follow this ratified GTM strategy for acquisition objectives, data handling and commercial scope.
4. Treat any agent-generated design, vendor recommendation or scoring threshold as **proposed** until explicitly approved.

If directives conflict, **surface the conflict and request a decision** rather than making a hidden policy change.

### 18.2 What agents MAY do when requested within scope

- Draft bounded research plans, source-comparison matrices, ICP evidence rubrics, and record schemas.
- Analyze sanitized prospect/partner records and identify evidence gaps.
- Recommend CRM fields, low-cost tooling options and workflow gates.
- Produce templates for research, diagnostic questions, authorized outreach, referral intake and cohort reporting.
- Propose focused automation or integration architecture with cost/privacy tradeoffs.
- Prepare implementation patches **only when the engineering lead has authorized the scope**, following current engineering workflow.

### 18.3 What agents MUST NOT infer from strategy approval

- Permission to create, edit, commit, merge, push or deploy production code.
- Permission to read/write LaSyncro production/shop data for GTM purposes.
- Permission to buy subscriptions, scrape sources, run broad enrichment, or publish lists.
- Permission to send messages, contact partners, sign agreements or launch campaigns.
- Permission to expose real merchant/contact data in repository assets or logs.
- Permission to replace the two-asset model or broaden the ICP without approval.
- Permission to create a new stand-alone product roadmap gate or interrupt existing warehouse-priority work.

### 18.4 Change proposal format

Every material deviation must be submitted as:

```text
GTM_CHANGE_ID:
PROPOSED_CHANGE:
CURRENT_RATIFIED_RULE:
REASON / EVIDENCE:
SCOPE AND DEPENDENCIES:
SECURITY / PRIVACY / LICENSE IMPACT:
COST / ENGINEERING IMPACT:
SUCCESS MEASURE:
ROLLBACK / STOP CONDITION:
DECISION_REQUIRED:
STATUS: PROPOSED (not executed)
```

No ratified strategy rule, outreach policy, lead rubric, partner fee, or implementation scope changes silently.

### 18.5 Reporting discipline

Every execution report should state:

- Task ID, date, repo/workspace if relevant, and precise scope.
- Inputs/sources examined, evidence provenance and unresolved uncertainty.
- Work actually performed versus merely recommended.
- Exact artifact/file names and any external actions actually executed.
- Measured results with denominators; blocked steps identified.
- Deviations and decision requests.
- Whether any purchase, account mutation, outbound message, commit, push or deploy was authorized/executed.

Use `PASS`, `HOLD`, or `BLOCKED` only with supporting evidence. Never claim a customer, partner, subscription, conversion, certification or implementation exists unless verified.

---

## 19. Deliverable contracts for authorized future tasks

### 19.1 Source register

One row per source with source ID, official URL, coverage, fields, license/terms summary, approved purpose, legal/privacy notes, API/exports, rate limits, cost, owner, status and last review.

### 19.2 Merchant intelligence record

Minimum structured content (illustrative, not software schema approval):

```yaml
company_id: internal-id
brand: Example Brand
storefront: example.invalid
legal_entity:
  name: null
  country: SE
  registration_number: null
warehouse:
  status: unknown  # confirmed | probable | unknown | disconfirmed
  facilities: []
icp:
  fit_status: researching
  revenue_band: unknown
  operators: unknown
  daily_orders: unknown
  sku_complexity: unknown
buying_triggers: []
adoption_readiness: unknown
evidence:
  - claim: shopify_storefront
    observation: observed
    source_id: source-001
    observed_at: null
    confidence: probable
outreach:
  eligible: false
  legal_review: pending
  suppression_checked: false
sources: [source-001]
last_reviewed_at: null
```

Never store this illustrative placeholder as a real lead.

### 19.3 Partner qualification record

Record entity and primary contact route, category, ICP overlap evidence, commercial and competition incentives, proposed joint offer, referral authorization mechanics, relationship owner, status, risks and next action.

### 19.4 Cohort review

Produce a dated, versioned summary with:

- Research cohort, filters, source costs and license constraints.
- Number researched, duplicates removed, confirmed/probable/unknown/disconfirmed self-fulfillment counts.
- Buying-trigger and readiness evidence.
- Outreach-eligible, contacted, responded and discovery counts.
- Partners contacted, engaged, pilot-agreed, active, and productive.
- Health Check starts/completions/voluntary follow-ups if tested.
- Pilots, wins, losses, retained accounts, attributable revenue where actually observable.
- Confidence limits, blockers and recommended narrow next experiment.
- Explicit approval requests for any spend, campaign, automation or product work.

---

## 20. Immediate next actions (not yet executed)

1. Present GTM-01's bounded operating artifacts for approval (source register, evidence model, CRM mapping, partner and outreach controls).
2. Verify current source availability, licensing and lawful uses before importing any live data.
3. Select minimum-tooling CRM and research method; avoid custom development by default.
4. Create a first **manual** research cohort of up to 30 merchants once use of relevant data sources is authorized.
5. Prepare a short Warehouse Health Check and diagnostic output for user review.
6. Define the first three prospective partner approaches with individual mutual-value propositions.
7. Review initial findings and make a GTM-02 proceed/hold decision using evidence, not target-count optimism.

---

## 21. Version history and decision log

| Date | Version | Decision | Status |
|---|---|---|---|
| 2026-10-26 | 1.0 | Ratify two-asset operating model, trigger/readiness separation, Health Check, source-confidence approach, customer-derived refinement, referral flywheel, stop rules and first 30-day validation | APPROVED / RATIFIED |
| 2026-10-26 | 1.0 | Prepare detailed Markdown directive for eventual authorized VS Code agent use | DOCUMENT CREATED; no implementation implied |

**Next major milestone:** GTM-01 foundation review and controlled validation. Further execution requires scoped authorization.
