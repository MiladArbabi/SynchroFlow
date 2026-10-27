# GTM-01-S01 Sprint Charter

Sanitized sprint charter (workflow v1.2 §3). No merchant names, contact details, prospect lists or source exports. Values marked `ASSIGN` or `PENDING` are not approvals, and agents must never fill them.

**Charter status:** G0-A FOUNDATION PASS; G0-B RESEARCH_ONLY PASS (`GTM-01-S01-G0B-LEAD-001`) for run `GTM-01-S01-RESEARCH-001` during 2026-10-27 to 2026-11-09. Research authorization is TRUE within this bounded scope; outreach authorization is FALSE.

## How to read this charter

- **Published directive:** a rule in an approved document listed in `docs/stratgies/GTM_INDEX.md`. It binds every sprint.
- **Approved research permission:** a value below that carries a lead decision ID. Only these permit action.
- **Pending decision:** any `ASSIGN`, `PENDING`, `FALSE` or `null` value. It permits nothing.

## Charter

```yaml
sprint_id: GTM-01-S01
program: GTM-01
mode: RESEARCH_ONLY            # RESEARCH_AND_CONTACT requires G5 PASS

# Active documents (from GTM_INDEX.md)
index:
  path: docs/stratgies/GTM_INDEX.md
  version: "GTM-CHG-003 published; GTM-CHG-004 S01 execution-status sync"
  sha256: 35a0a48056da49e0f98d2435f48147fedb772dd9f9b1e90874f668e5eed2d503
strategy:
  path: docs/stratgies/GTM_strategy_v1.0.md
  version: "1.0"
  sha256: 2f2b4e98ff0f647479473c65cd6566f6f97e88a562e9d0ace7d3a4b507277bd7
workflow:
  path: docs/stratgies/GTM_sprint_workflow_v1.2.md
  version: "1.2"
  sha256: 99f2e8c2afd55674341719d09c4ff68e6d401310bf5d833d2e40ad6296ebf070
source_baseline_commit: d7fafc66e51e0ecbeccc6804576e2c4cef7aaa40   # baseline the charter was drafted from
document_baseline_commit: a5363140497f96b91c1096c9e40b56e4878d8506  # Published workflow/index baseline
execution_commit: RESTRICTED_DRIVE_EXECUTION_RECORD  # exact charter commit recorded after publication in approved GTM S01 Drive handoff; no self-reference

# Decisions
workflow_decision_id: GTM-CHG-003     # workflow v1.2 approved; effective after publication and charter pinning
charter_convention_decision_id: GTM-CHG-002
setup_decision_id: GTM-01-S01-SETUP-001
reviewer_designation_decision_id: GTM-01-S01-REVIEWER-DESIGNATE-001
c1_record_decision_id: GTM-01-S01-C1-RECORD-001  # lead-approved setup recording, not gate authorization
g0a_decision_id: GTM-01-S01-G0A-LEAD-001  # 2026-10-27; conditional lead approval + QA-01 final cold-start PASS
g0b_decision_id: GTM-01-S01-G0B-LEAD-001  # lead approved 2026-10-27, scoped to RESEARCH-001 and dates
g5_decision_id: null                  # no contact authorization
previous_blocker_review: GTM-01-S01-BLOCKER-REVIEW-001  # published 2026-10-27; verified evidence still pending

# Scope
geography_decision_id: GTM-01-S01-GEO-REV-001  # lead ratified 2026-10-27; only S01 pilot territory
geography: [Stockholm County (all 26 municipalities), Uppsala, Västerås, Eskilstuna, Enköping, Strängnäs, Håbo]
geography_extended_selective: [Örebro, Norrköping, Linköping, Gävle]  # when merchant fit justifies travel
geography_sample_guidance: "~8–10 Greater Stockholm, ~3–5 core Mälardalen, ~0–2 extended; not quotas; total <=15"
geography_scope_rule: "Stockholm-based visit access and ICP evidence outrank population; warehouse site may differ from company office; visits not mandatory in research-only S01"
segment: Shopify-first, self-fulfilling SMB (strategy §3.1 core ICP)
core_icp:
  revenue: "~USD 500K–10M"
  warehouse_operators: "2–10"
  orders_per_day: "~20–200"
research_target: 15                   # max new unique merchant accounts
self_fulfillment_candidate_target: 5  # experimental; confirmed + probable
contact_ready_target: 0               # 0 until G5 PASS
followup_queue: N/A                   # no authorized outreach exists
partner_review_target: 2              # max; review only
budget_cap: 0
research_hours_cap: 12                # planning cap approved by GTM-01-S01-SETUP-001; not research authorization
qa_hours_cap: 4                       # planning cap approved by GTM-01-S01-SETUP-001; not research authorization
calendar: "S01 Day 0 = program Days 1–7; S01 Days 1–8 = program Days 8–15 (workflow §2.1)"
start_date: 2026-10-27
end_date: 2026-11-09

# Responsibilities
lead: approving user, GTM lead
evidence_reviewer: GTM-01-S01-QA-01   # lead-designated distinct reviewer agent session; not a second human
compliance_reviewer: null             # required before any G5 decision
researcher: dedicated GTM research agent
researcher_id: GTM-01-S01-RESEARCH-01 # approved scoped research run; not a second person
retention_review_deletion_owner: GTM lead  # dates assigned after actual sprint close

# Sources (approved METHOD IDs; scoped research run GTM-01-S01-RESEARCH-001 only)
source_charter_decision_id: GTM-01-S01-SOURCES-CHARTER-001  # lead-approved C1 alignment on 2026-10-27
source_register: GTM-01-S01 restricted company Drive / Research Source Permissions Register
approved_sources:
  - SRC-002        # SCB; primary structured AB discovery
  - SRC-004        # JobTech; OPTIONAL corroboration, no hiring-based quota
approved_access_methods:
  - id: SRC-002
    provider: SCB Allmänna företagsregister, current free API
    permission_id: GTM-01-S01-SRC002-PERM-001
    terms_clearance_id: GTM-01-S01-SRC002-TERMS-CLEAR-001
    scope: bounded AB-level filtered queries, Stockholm County and named Mälardalen pilot municipalities, selective outer cities; company-only fields
    geography_extension_id: GTM-01-S01-SRC002-GEO-EXT-001
    one_time_screening_amendment_id: GTM-01-S01-SRC002-METHOD-ADJ-001  # CONSUMED: prior HTTP 200, unrecognized envelope, 0 retained
    second_one_time_screening_amendment_id: GTM-01-S01-SRC002-METHOD-ADJ-002  # CONSUMED: one extra HTTP 200, 5 non-AB records excluded, 0 retained
    terms_status: APPROVED_FOR_RESEARCH
    cost_sek: 0
    review_by: 2027-01-25
    execution: GTM-01-S01-RESEARCH-001  # authorized by GTM-01-S01-G0B-LEAD-001
  - id: SRC-004
    provider: Arbetsförmedlingen JobTech JobSearch
    permission_id: GTM-01-S01-SRC004-PERM-001
    scope: at most 3 optional candidate-specific lookups, no negative signal from absent ads
    terms_status: APPROVED_FOR_RESEARCH
    cost_sek: 0
    review_by: 2027-01-25
    execution: GTM-01-S01-RESEARCH-001  # authorized by GTM-01-S01-G0B-LEAD-001
candidate_sources:
  - id: SRC-003
    role: primary merchant-domain Shopify and self-fulfillment verification
    status: NOT_APPROVED_FOR_RESEARCH  # requires reviewed domain-specific method/terms
  - id: SRC-001
    role: supporting Bolagsverket legal-entity verification
    status: NOT_APPROVED_FOR_RESEARCH  # exact method pending approval
personal_data: NONE  # company-level only; no named contacts or raw responses

# Storage
workspace_proposal: restricted company Google Drive
workspace_location: "https://drive.google.com/drive/folders/1tLruW0KvPOKB7kSPTnRH5dx4pBn93bUa"  # verified folder; not research permission
workspace_owner: "milad.arbabi@lasyncro.com"
workspace_access_evidence: "restricted owner-only Google Drive; QA-01 read access via owner account (read-only by conduct, not ACL)"
sanitized_outputs:
  blocker_register: docs/stratgies/gtm_sprints/blocker_register.md
  sprint_review: docs/stratgies/gtm_sprints/GTM-01-S01/review.md

# Authorizations
research_authorized: true           # GTM-01-S01-G0B-LEAD-001, RUN_ID GTM-01-S01-RESEARCH-001 only
outreach_authorized: false
live_crm_write_authorized: false
purchases_authorized: false
account_registration_authorized: false
data_import_authorized: false
```

## Setup decision record

`GTM-01-S01-SETUP-001` records only the named roles, proposed workspace type, planning-hour caps and zero budget above. It does not pass G0-A or G0-B and does not authorize research execution, source use or access, contact/outreach, CRM writes/imports, purchases or account registration. The GTM lead designated `GTM-01-S01-QA-01` in decision `GTM-01-S01-REVIEWER-DESIGNATE-001` and assigned the GTM lead as retention review/deletion owner under `GTM-01-S01-C1-RECORD-001`. One person can coordinate or operate every sprint role; separate people, computers and Google accounts are not prerequisites. Research and independent QA remain distinct passes (separate agent sessions when using agents). This recording does not authorize research, source use, outreach or any gate.

## S01 geographical decision

`GTM-01-S01-GEO-REV-001` (GTM lead ratification, 2026-10-27) supersedes the earlier Gothenburg/Borås/Helsingborg sampling assumption **for GTM-01-S01 only**. The underlying Sweden-first strategy, ICP, source legality, G0-A PASS and research caps remain unchanged. Prioritize Greater Stockholm and nearby Mälardalen for potential future warehouse visits; cities and population are research sampling inputs, not qualification evidence or visit obligations. Source-method geographic clearance for SRC-002 is recorded in restricted Drive as `GTM-01-S01-SRC002-GEO-EXT-001`. Merchant-site SRC-003 remains method/domain-specific pending. No G0-B execution, G5 outreach, contact collection or API credential use is authorized by this geographical decision.

## G0-A foundation decision

GTM lead decision: `GTM-01-S01-G0A-LEAD-001` (2026-10-27), ratified against the lead's prior explicit approval to proceed contingent on the final QA recommendation. Fresh independent reviewer pass `GTM-01-S01-G0A-FINAL-002` at `dc21bdfc764e928be93585869b81d00ca90f38ae` returned PASS; no second human reviewer is required. MFA and data-location/export controls are documented lead attestations in the restricted company Drive (not independently inspected admin controls). Previous-blocker review `GTM-01-S01-BLOCKER-REVIEW-001` has been linked. Seven previously blocking rows are VERIFIED in the published blocker register; G5-only BLK-0004 remains OPEN. **Foundation PASS does not authorize research or outreach.**

## G0-B bounded research execution decision

**Lead authorization:** `GTM-01-S01-G0B-LEAD-001`, ratified 2026-10-27 by the sole LaSyncro GTM lead's explicit "authorized and approved" for the previously proposed S01 execution scope. Run `GTM-01-S01-RESEARCH-001`, date range **2026-10-27 to 2026-11-09**. Ratified S01 geography: Stockholm County plus named core Mälardalen municipalities, with selective nearby extension under `GTM-01-S01-GEO-REV-001`. Cohort **no more than 15 unique merchants**, with 5 credible confirmed/probable self-fulfillment candidates as a research target, not a fabricated minimum; up to **2 research-only partner reviews**. Maximum **12 research hours**, **4 separate QA hours**, **0 SEK**. Research stays company-level, in the restricted company Google Drive. Exclude names/contact data/sole traders and do not retain raw API responses.

**Permitted methods:** `SRC-002` SCB Allmänna företagsregister targeted current free API, with approved SNI 2025 and size-class company-level fields in `GTM-01-S01-SRC002-PERM-001`, `GTM-01-S01-SRC002-TERMS-CLEAR-001`, and regional scope extension `GTM-01-S01-SRC002-GEO-EXT-001`; max 1 request/sec, no registry harvesting, resale or standing monitoring. `SRC-004` JobTech JobSearch **optional**, up to 3 candidate-specific lookups, first 10 results per lookup, never a negative fulfillment inference. Both reviewed by 2027-01-25 (or earlier if conditions change). Credentials remain controlled by their registered legitimate holder; the company communications email is an administrative detail, not authorization to share the individual's key. No credentials in agents, Git or Drive.

**Not permitted:** generic merchant website browsing/scraping under `SRC-003` absent site-specific method approval; Bolagsverket `SRC-001` without method approval; any merchant contact, outreach, CRM writes, account registration, data imports, new spending, production Shopify records, personal-data harvesting or unsupported Shopify/in-house warehouse claims. `G5` remains blocked. Reports may mark Shopify and in-house fulfillment **UNKNOWN** until separately verified; do not boost uncertain leads to confirmed just to hit targets.

**Audit trail and execution identity:** Gate decision recorded here; exact published execution commit is recorded in the restricted S01 Drive G0-A/G0-B handoff because the charter cannot embed its own future commit hash. The prior `G0-A` decision and separate QA session remain valid. Status-only index alignment `GTM-CHG-004` changes no GTM strategy principles or workflow mechanics.

## One-request SCB screening decision

The GTM lead approved `GTM-01-S01-SRC002-METHOD-ADJ-001` on 2026-10-27 as a **single narrowly bounded test**, supplementing the existing SRC-002 permission for `GTM-01-S01-RESEARCH-001` only. Use the documented Stockholm municipality (0180) endpoint with `limit=5`, once, without pagination or retries. The named API-key holder executes privately on their own device, processing at most five returned rows transiently in memory. Exclude any record not positively schema-validated as Swedish AB (`jurform=49`), retaining only previously approved AB company fields in restricted Drive. Never save raw response, excluded entities, personal names/contact details or address fields. On provider error, unexpected response or missing legal-form validation, stop and report a nonidentifying result. Zero eligible ABs is valid. This does not authorize other geography or API calls, broader mixed-entity screening, SRC-003 merchant website work, contact collection or G5 outreach. Full decision conditions are recorded in the restricted Research Source Permissions Register. No authenticated request is claimed by the permission record.

## Follow-up SCB screening amendment

`GTM-01-S01-SRC002-METHOD-ADJ-002` was approved by the GTM lead on 2026-10-27 following public schema inspection and successful offline v2 self-test. It permits **one additional** authenticated request to the Stockholm municipality (0180) SCB API endpoint, with `limit=5`, run locally by the authorized key holder. No pagination, retries or additional endpoints. The v2 parser checks the `jes`/`pagination` envelope and transiently excludes non-AB records; retain only validated ABs (`jurform=49`) meeting the approved SNI and employee-class discovery screens, with the established company-only allowlist. No raw response, excluded records, personal contacts, addresses or credentials may be shared or stored. Unexpected schema/errors must stop execution; zero accepted records is valid. The earlier `METHOD-ADJ-001` allowance is consumed and cannot be reused. The decision is recorded in the restricted source register; G0-A/G0-B and all sprint caps remain intact. G5 remains BLOCKED. **No live API request has been executed by this decision record.**

## Merchant-first discovery experiment

**Decision:** `GTM-01-S01-DISCOVERY-PIVOT-001` (GTM lead, 2026-10-27). After two successful SCB authenticated responses but zero AB candidates from a five-row municipality-only sample, the lead approved a small **merchant-first method experiment** instead of expanding untargeted register queries. This is a change in **discovery sequence**, not a new source or blanket merchant-site research approval. For the first step, search-index discovery may nominate at most **three candidate merchant domains for SRC-003 permission review**. Keep domain references and access/terms decisions only in restricted Drive, not in this repository. Do not score, accept or promote those merchant candidates until their specific domains and methods are approved and qualified from authorized evidence. Domain terms restrictions and privacy must be reviewed separately before use; maintain HOLD for unknown/restrictive conditions. No automated scraping/crawling, site fingerprinting, login, personally identifying contacts, outreach, CRM writes or spending.

SCB SRC-002 remains approved only within existing method limits; one-request amendments `METHOD-ADJ-001` and `METHOD-ADJ-002` are **CONSUMED**. Use SCB for later permitted identity/size corroboration only when an efficient approved query is available. Source SRC-004 JobTech remains optional. SRC-003 and SRC-001 remain NOT APPROVED until their own source-method decisions. Existing G0-A PASS, G0-B PASS for `GTM-01-S01-RESEARCH-001`, G5 BLOCKED, <=15 merchant cap, 12 research hours, 4 QA hours and 0 SEK are unchanged. This decision **does not** automatically approve any website or enlarge data-collection authority.

## Shopify-first and fulfillment-operator research priority

**GTM lead decision:** `GTM-01-S01-FULFILLMENT-EVIDENCE-PRIORITY-001` (2026-10-27). Research **first** whether a candidate runs a Shopify storefront and has a relevant merchant or fulfillment presence in the ratified Stockholm–Mälardalen territory. **Next**, prioritize evidence answering *who actually employs the operators and performs storage, picking and packing of merchant orders*: merchant, outsourced 3PL, or hybrid/unknown. A merchant's registered office is not proof of where fulfillment occurs. In-house operation may be from a leased facility; ownership of real estate is not necessary.

**Evidence priority (interpret within unchanged G3/G4 contract):** (1) explicit current merchant/operator statements about who manages fulfillment and where; (2) named 3PL's client case studies or joint announcements stating operational scope; (3) direct merchant-employed warehouse recruitment plus independently supported facility/operational signals; (4) independently published operating-site evidence. Two genuinely independent credible signals may support `probable`, not `confirmed`, unless a directly authoritative statement establishes operating responsibility. Attribute any outsourced evidence to the disclosed scope; *do not* infer 3PL-only or disconfirmed self-fulfillment if a hybrid is possible. Genuine ambiguity remains `unknown` or `contradictory` as appropriate. Require source-specific legal/method approval before using new merchant, 3PL or publisher sites; SRC-004 JobTech remains optional under its existing <=3 candidate-specific lookups.

**Explicit weak signals:** courier brand, daily/scheduled carrier pickup, delivery speed, shipping label/sender display, return address, registered-office location, carrier use, customer-order tracking or generic 'our warehouse' language do **not** prove merchant-operated fulfillment. PostNord's published EDI documentation distinguishes an original seller/shipper from the actual consignor where a 3PL is involved. Private carrier booking records, tracking/manifest data, recurring pickup logs, production Shopify/customer data and carrier-account APIs are **not authorized** prospect research sources. Even with future voluntary merchant access, shipping data would corroborate physical handover rather than independently prove warehouse operation. No account registrations, carrier monitoring, personal data, outreach or spending.

**Pilot measure:** for the existing two discovered merchant records, assess which permitted evidence supports Shopify, territory, operator identity and fulfillment classification; record unknowns and exact next validation step. Keep the 15-merchant / 12-hour research / 4-hour QA / 0 SEK caps and G0-A/G0-B PASS, G5 BLOCKED. No workflow version, qualification schema, source permission or status automatically changes under this methodological prioritization.

## Ratified S01 candidate-selection refinement

**Lead decision:** `GTM-01-S01-CANDIDATE-SELECTION-REFINEMENT-001`, 2026-10-27. Applies **only to S01 research selection and evidence prioritization**, not a replacement for the program workflow's G1–G7 gates. No expansion of source permissions, merchant cap, hours, geography, budgets, data collection, account registrations, contact collection, outreach, or G5. The existing 2026-10-27 to 2026-11-09 `RESEARCH_ONLY` execution remains authoritative.

**Entry conditions:** (A) **positive evidence of an active Shopify storefront**; (B) **relevant operating company/geographic link in Stockholm–Mälardalen** (distinguish registered company office from warehouse location); (C) physical-stock products. An indexed website or recognizable brand alone is not enough. Enter a **discovery pool**, not the qualified/contact-ready queue. Record source, observation date, decision rationale, and unknowns. Do not systematically browse new sites absent specific SRC-003 approval.

**Primary research discriminator:** Who operates actual receiving, storage, picking and packing: merchant-operated (including leased facilities), 3PL-only, hybrid or unknown? Prioritize direct current operator statements, credible 3PL-client descriptions, documented merchant-employed warehouse hiring and corroborated site evidence. Add **customer collection at merchant premises** as a useful operational signal: distinguish named warehouse collection, office/retail collection, pickup from third-party lockers/service points, and vague "click & collect". Collection, carrier pickup or shipping speed alone never proves in-house fulfillment. Apply unchanged G3 classifications, independence tests and G4 separate dimensions; a credible hybrid possibility must not be misclassified as 3PL-only.

**Broad carrier reference categories for allowed public business observations:** PostNord, DHL, DSV / DB Schenker (**one integrated provider group for research deduplication**), Bring, Budbee, Instabox, Airmee, Early Bird, UPS, FedEx, CityMail, Best Transport, Asendia and Jetpak. Track **observed delivery provider/service, Sweden/international coverage, service-point/locker/home/office/warehouse collection, and evidence URL/date** when permitted. Distinguish carrier from pickup network, shipping-platform software and third-party warehouse operator; avoid double-counting provider brands. Carrier diversity and fast shipping are **weak complexity signals**, **not** proof of internal fulfillment. No restricted carrier tracking, manifest, pickup or account data.

**SKU and variant complexity (meaningful fit dimension):** Note visible approximate product listings, distinct categories, variation axes (size, color, material, design, configuration), product/variant combinations, seasonal turnover, replenishment frequency, bundles/multipacks and multiple stock locations where independently evidenced. Assign descriptive `low / moderate / high / very_high / unknown` based on support; use an **estimated visible variant range** only when transparent, never turn storefront listings into a claimed actual SKU count or documented inventory operations. Prioritize material variation/stock complexity, not brand recognition or shipping promises. Strategy's "hundreds to several thousand SKUs/variants, or equivalent complexity" remains unchanged, as does product readiness gating.

**Revenue and commercial maturity:** Preserve original core ICP **~USD 500K–10M annual revenue**; do not convert experimental SEK bands into mandatory eligibility thresholds. When permitted and verifiable, capture Swedish AB fiscal year, `nettoomsättning`, original reported currency/amount, legal entity/registration match, source URL/reference and observation date, source age, and whether figure is reported, estimated or a turnover-size band. Distinguish **legal-entity turnover from brand sales, Shopify GMV and run rate**; mark other figures UNKNOWN. Preliminary research-priority bands: <SEK 5M lower; SEK 5–20M high; SEK 20–50M very high; SEK 50–100M high; >SEK 100M selective. These are **testable heuristics, not hard excludes**; exceptions need reasons. SCB's inspected municipality API schema exposed **no turnover field**. Bolagsverket filings, SCB turnover classes or commercial company-information sources require separate specific source/method permission; do not access unapproved financial datasets, pay for reports, or assume public search results license unrestricted reuse.

**Provisional research ordering** (only after verified Shopify/geographic entry): self-fulfillment evidence **40%**, SKU/variant complexity **30%**, revenue fit **20%**, additional fulfillment complexity (pickup, carrier/service mix, channels, multiple locations) **10%**. Scores are **experimental triage aids**, never a composite `icp_fit` or a G3/G4/G7 substitute; explicitly flag `not_scored/unknown` dimensions and don't award points for missing data or inflate scores by renormalizing missing weights. Proven 3PL-only fulfillment cannot be rescued by high revenue/catalog scores. Each discovered account needs **selection rationale + strongest factual evidence + key unknowns + targeted next step**, no fabricated ranking. The first two trial Shopify merchants remain **discovered/partial with self-fulfillment UNKNOWN** and are not automatically priority outreach targets.

**Contact rule:** No emails now. The lead requested that any later commercial copy refer generally to existing Swedish ecommerce-brand customers **without naming Kouli Brand AB or its brands**. This copy-direction is not G5 approval. Existing S01 `outreach_authorized: false`, `g5_decision_id: null`, `contact_ready_target: 0` and the compliance workflow are unchanged.

## Gate status

| Gate | Status | Missing |
|---|---|---|
| G0-A Foundation | PASS | GTM-01-S01-G0A-LEAD-001; final QA-01 cold-start GTM-01-S01-G0A-FINAL-002 PASS; seven blockers VERIFIED. MFA and restricted export handling confirmed by lead attestation, not independently inspected UI. BLK-0004 remains OPEN, G5 only. |
| G0-B Research authorization | PASS | GTM-01-S01-G0B-LEAD-001: run GTM-01-S01-RESEARCH-001; 2026-10-27 to 2026-11-09; <=15 unique merchants, <=12 research hours, <=4 QA hours, <=2 partner reviews, 0 SEK; SRC-002 SCB targeted AB discovery and optional SRC-004 JobTech only. Execution commit read from restricted Drive after publication. G5 remains BLOCKED. |
| G5 Contact/compliance | BLOCKED by design | compliance_reviewer; legal basis; suppression list. Not required for S01 |

**Next step:** execute approved G0-B run `GTM-01-S01-RESEARCH-001` within the specified caps, source conditions and calendar window, after the exact execution commit is recorded in the restricted Drive. SRC-003 merchant-site verification remains method/domain-specific pending; SRC-001 Bolagsverket pending. No G5 outreach, CRM writes, imports, purchases or external data sharing.

## Unresolved blockers (see blocker register)

BLK-0001–BLK-0003 and BLK-0005–BLK-0008 VERIFIED after GTM-01-S01-G0A-FINAL-002; BLK-0004 OPEN (G5/S02, nonblocking for research-only). Tracked history: GTM-01-S01-G0A-REGISTER-VERIFIED-001.

## Change control

Filling a `PENDING` or `ASSIGN` value requires a lead decision ID recorded in this charter. That is a C1 change (workflow §13.5). Changing caps beyond workflow limits, or the mode, is C2.
