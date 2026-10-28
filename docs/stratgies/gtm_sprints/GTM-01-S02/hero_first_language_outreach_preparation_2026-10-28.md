# GTM-01-S02 — Hero-first, language-aware outreach preparation

**Lead decision:** 2026-10-28; lead approved the contact-first sequence and evidence-based English/Swedish selection, and explicitly requested this decision be committed and pushed.
**Status:** APPROVED AS A PREPARATION DECISION; versioned integration into the governing `GTM_sprint_workflow_v1.3.md` successor remains PENDING. This record does not replace the workflow version pinned in `GTM_INDEX.md` and grants no G5/contact-data or dispatch authority.
**Scope:** All retained merchant prospects, preparation only. Merchant names, prospect lists, personal data and email addresses belong exclusively in the restricted GTM workspace, not Git.

## Required per-merchant order

1. **Retain and rank:** Keep RED-only exclusion for preliminary prospect screening. Lack of public information is not a merchant DROP.
2. **Find the hero first:** Identify a named current business owner or accountable warehouse/ecommerce/operations decision-maker. Store full name, title, current organization match, source and access/verification date in the restricted workspace. A suggested role is not an identified person.
3. **Verify the business email:** Confirm the exact legitimate professional address using a separately approved method and attributable source; never guess first.last patterns or harvest addresses. Record email provenance and verification date. No named hero or verified email means `CONTACT_RESEARCH_HOLD` and `draft_state=NOT_STARTED`, without dropping the merchant. A generic-company-route exception requires the lead and the applicable G5 reviewer.
4. **Research the relevant opportunity:** Record what is publicly observed separately from the hypothesis about a possible LaSyncro benefit. Select the best discovery question about existing receiving, picking or packing processes. Do not diagnose pain from assortment size or complaints alone.
5. **Choose Swedish or English:** Choose `SV`, `EN` or `UNDECIDED` from the person's demonstrated public professional language where legitimately available, then the company's established website/business language. Record source URLs, date and decision reason. Name or surname alone is never evidence of language preference or nationality. If inconclusive, prefer established company communication language and disclose the uncertainty.
6. **Draft only after steps 2–5:** Address the verified hero in the evidence-supported language, use one merchant-specific observation and the most relevant operational question. No generic pitch, unsupported product claim or invented bottleneck.
7. **Review and approve:** Independently review the named recipient, role, email provenance, language evidence, merchant facts/hypotheses, suppression, data-use permissions, legal basis, actual product capabilities and exact draft. Existing G5/G6/G7 requirements are not relaxed.
8. **Send one by one:** A ready/approved draft is not permission to send. Require explicit per-recipient dispatch approval; no batch sending or follow-up automation is authorized by this memo.

## Restricted contact-record fields

- `hero_full_name`, `hero_role`, `hero_company_affiliation`, `hero_identity_source_url`, `hero_verified_at`.
- `verified_business_email`, `email_source_url`, `email_verified_at`, `email_verification_method`.
- `contact_source_permission_id`, `contact_data_compliance_status`.
- `language_choice` (`SV | EN | UNDECIDED`), `language_evidence_type`, `language_source_url`, `language_verified_at`, `language_decision_reason`.
- `merchant_observed_fact`, `operational_hypothesis`, `discovery_question`.
- `draft_state` (`NOT_STARTED | WRITTEN | VERIFIED | APPROVED`), `send_state` (`NOT_AUTHORIZED | APPROVED_ONE_BY_ONE | SENT | STOPPED`).

## Boundaries and tests

- No person/email identified → no draft; prospect retained.
- Name known, email not verified → no inferred email and no draft.
- A non-Swedish-looking or Swedish-looking name never determines language; prefer actual professional/company-language evidence.
- A verified named email still does not make an account `CONTACT_READY` without G5 and G6.
- Approval of a draft never authorizes dispatch.
- S02 approved merchant discovery sources do not authorize personal contact research; separately approve sources and applicable privacy/compliance before collecting named-person data.
- Do not create new contacts, CRM entries, purchases, automated sequences or outbound messages under this decision.

## Controlled publication next step

Prepare a versioned successor workflow and supporting index/charter pin updates as a separate controlled documentation change. Until publication and pinning, the currently indexed v1.3 remains formally authoritative; this document preserves the lead's requested preparatory decision without silently altering the workflow.
