# Alerts Module — Blueprint

**Status:** ✅ Implemented · Sprint closed 2026-05-30 · ALR-02–12 shipped
**Scope:** Web module surface + topnav bell dropdown. Notification bell ✅. Operator mobile = fast-follow.
**Out of scope:** rules-engine backend, `shop_alert_rules`, evaluation hooks, escalation worker, external routing (separate Alerts/Backend sprint).
**Project root:** `/Users/miladarbabi/Codes/projects/SynchroFlow/`

---

## 1. Strategic context

Alerts is the one module that converts laSyncro from reactive to proactive — the direct
answer to the firefighting culture (stockout learned from a customer complaint, margin
problem learned from the quarterly report, SLA breach learned from a 1-star review).

ICP: 1–20 operators + owners/admins, own-warehouse fulfilment, $100K–$50M revenue,
high SKU complexity. If Alerts works, the owner stops opening fifteen tabs every morning.

Every other module answers "what is true?" — Alerts answers "what is about to go wrong,
who must act, and have they?"

---

## 2. Locked decisions

| # | Decision |
|---|----------|
| D1 | Default view = **consequence taxonomy**; severity is a toggle, not the primary grouping. ✅ |
| D2 | Lifecycle verbs = **Acknowledge / Snooze / Resolve**. Operators acknowledge-only; owners/admins resolve. Auto-resolve when the signal clears is primary. Dismiss is retired. ✅ |
| D3 | This sprint ships the **web module surface + bell dropdown**. Operator mobile follows. ✅ |
| D4 | Severity = **commercial consequence**, not technical severity. critical = money leaving / customer breach imminent; warning = trending to breach; info = state transition. ✅ |
| D5 | Severity is communicated by **rail + icon + label**, never colour alone (inclusive design; survives dark mode + colour-blindness). ✅ |
| D6 | Counts live **inside the module** and on the bell (hover); the **sidenav stays a calm dot** (B-07). ✅ |

---

## 3. Routes & IA

Module mounted at `/alerts/*` (`LifecycleRouteHost.tsx` ~L221; import ~L39; vite alias
`@lasyncro/alerts` ~L76). Sidenav entry in `modules/alerts/src/ui/ModuleEntry.tsx`
(Bell icon, group `operations`).

`ModuleTabBar` (same component as Products/Inventory):

| Tab | Path | Purpose | Status |
|-----|------|---------|--------|
| Inbox | `/alerts` | Active + acknowledged alerts (live working surface) | ✅ |
| Snoozed | `/alerts/snoozed` | Parked until timer expires | ✅ |
| Resolved | `/alerts/resolved` | Auto/owner-resolved history (read-only) | ✅ |
| Rules | `/alerts/rules` | Rule-builder shell (gated: growth tier) | ✅ |

---

## 4. Backend endpoints

**Implemented:**

- `GET /api/v1/alerts?status=inbox|snoozed|resolved` — tab-aware ranked inbox.
- `POST /api/v1/alerts/:id/acknowledge` → sets `acknowledged_at`, `acknowledged_by`. ✅
- `POST /api/v1/alerts/:id/snooze` → body `{ until: ISO }` → sets `snoozed_until`. ✅
- `POST /api/v1/alerts/:id/resolve` → owner/admin only; sets `resolved_at`. ✅
- `POST /api/v1/alerts/:id/dismiss` → **410 Gone** — retired (KI-2 fix). ✅

**Rules (existing, gated):**
- `GET /api/v1/alerts/rules`
- `POST /api/v1/alerts/rules`
- `DELETE /api/v1/alerts/rules/:ruleId`

---

## 5. Data contract

```tsc
`apps/frontend/src/pages/alerts/useAlerts.ts` — `Alert` type:
id, alert_key, source, alert_type, severity, title, message, entity_id, entity_type,
revenue_impact, is_active, dismissed_at, resolved_at, created_at, updated_at,
category, audience, acknowledged_at, acknowledged_by, snoozed_until, escalated_at, rule_id
```

All new fields implemented and populated by all producers (aggregator, demand, wms).
Frontend tolerates absence via optional types for forward-compat.

**Hooks:**
```
useAlerts(filters)         GET /alerts, poll 30s (inbox only)
useAlertCount()            feeds sidenav health dot
useAcknowledgeAlert()      POST /:id/acknowledge  ✅
useSnoozeAlert()           POST /:id/snooze        ✅
useResolveAlert()          POST /:id/resolve        ✅
useDismissAlert()          DEPRECATED — no-op stub, remove when call sites cleared
```

---

## 6. Consequence taxonomy & source mapping

| Category | Fed by (`source` / signal) | audience | Status |
|----------|----------------------------|----------|--------|
| Revenue at risk | snapshot (revenue-at-risk), constraint (SLA breach, blocked fulfilment), order_age | all | ✅ |
| Stock & reorder | demand (stockout, reorder), constraint (inventory block) | all | ✅ |
| Money & margin | AL-06 missing COGS, low-margin, blended-margin drop vs shop baseline | owner | ✅ |
| Supplier & inbound | supplier (PO overdue, on-time/fill/defect), defective receive batch | operator/owner | ✅ |
| Warehouse floor | wms (pick/pack exception, stow pending, batch ready, operator idle) | operator | ✅ |
| Data trust | sync stale, SKUs missing cost, identity-map gaps | owner | ✅ |

Within a category: severity-ranked, then `revenue_impact`-ranked.

---

## 7. Frontend component tree

```
AlertsPage (apps/frontend/src/pages/ft2-pages/AlertsPage.tsx)         ✅ rebuilt
├─ PageHeader            DM Sans 22/500 "Alerts" + 13px/ink-3 signal line  ✅
├─ ModuleTabBar          Inbox · Snoozed · Resolved · Rules               ✅
├─ AlertsPulseStrip      Critical · $ at risk · Oldest unresolved · Ack/total ✅
├─ AlertsFilterBar       category · severity · source chips + Clear        ✅
├─ ViewToggle            Consequence ⇄ Severity (inbox only)              ✅
├─ AlertCategoryGroup[]  collapsible; header = icon + label + count        ✅
│   └─ AlertCard[]
├─ AlertSeverityGroup[]  Critical → Warning → Info                        ✅
│   └─ AlertCard[]
├─ EmptyState            per-tab (inbox / snoozed / resolved)             ✅
├─ AlertsSkeleton        3 progressive skeleton cards                     ✅
└─ ErrorState            graceful, retry message                          ✅

AlertCard
├─ SeverityRail + SeverityIcon + SeverityLabel   (never colour-only) ✅
├─ Title (ink-1, ≤500) · Message (ink-2)                             ✅
├─ SourceBadge · RelativeAge · RevenueChip                           ✅
├─ PrimaryCTA  "Go to {X} →"  (var(--accent); entity-aware deep link)✅
├─ Actions: Acknowledge (ghost) · SnoozeMenu (1h/4h/tomorrow) · Resolve (owner only) ✅
├─ AcknowledgedFooter (who + when)                                   ✅
└─ readOnly mode — actions hidden on Resolved tab                    ✅

TopnavbarContent (apps/frontend/src/layouts/AppLayout/TopnavbarContent.tsx)
└─ Bell → AlertsDropdownSheet                                        ✅
   ├─ Header: "Alerts" + active count
   ├─ BellAlertRow × 6 (severity rail, title, revenue, Go to CTA, Ack)
   └─ Footer: "See all alerts →" → /alerts
```

---

## 8. Known issues — resolved

| ID | Resolution |
|----|------------|
| KI-1 (ISSUE-007) | ✅ Fixed — `ALERT_TYPE_ROUTES` now uses underscore `alert_type` keys (matching all producers), not colon alert_key format. Entity-aware deep links for variant-scoped demand alerts. |
| KI-2 | ✅ Fixed — dismiss retired (410 Gone); replaced by Acknowledge (operator) + auto-resolve (system) + Resolve (owner). Aggregator no longer fights dismiss. |
| KI-3 | ✅ Fixed — `AlertsPage` fully rebuilt in FT2 (fontWeight ≤500, 0.5px borders, useAppTheme(), ModuleTabBar). |

---

## 9. Sprint register

| ID | Description | Status |
|----|-------------|--------|
| ALR-01 | Blueprint | ✅ |
| ALR-02 | FT2 conversion via `useAppTheme()` (note: `useModuleTheme` does not exist; `useAppTheme` is canonical) | ✅ |
| ALR-03 | Page shell: title + signal line + ModuleTabBar | ✅ |
| ALR-04 | AlertsPulseStrip (FT2 stat cards) | ✅ |
| ALR-05 | Consequence grouping + severity toggle + category icons | ✅ |
| ALR-06 | AlertCard FT2 redesign | ✅ |
| ALR-07 | Acknowledge / Snooze / Resolve model + states | ✅ |
| ALR-08 | Deep-link routing fix (KI-1) | ✅ |
| ALR-09 | Filter bar | ✅ |
| ALR-10 | Empty / skeleton / error states | ✅ |
| ALR-11 | Rules tab UI shell (gated: growth tier via ModuleTabBar `feature` prop) | ✅ |
| ALR-12 | Accessibility pass (rail+icon+label D5, ARIA label on bell, readOnly resolved tab) | ✅ |
| ALR-13 | Bell dropdown sheet (top 6, Ack + deep-link per row, See all footer) | ✅ |

**Build order completed:** 02/03 → 04/05/06 → 07/08 → 09/10 → 11 → 12 → 13

---

## 10. Design system (FT2)

Via `useAppTheme()` (canonical hook — `useModuleTheme` does not exist).

- Surfaces: `--bg` (page) / `--surface` (cards).
- Borders: `--rule`, 0.5px. fontWeight ≤ 500.
- Accent: `--accent #FF6B2B`, `--accent-hover #FF8C5A`, `--accent-ghost rgba(255,107,43,0.12)`.
- Ink: ink / ink-2 / ink-3 / ink-4.
- Title: DM Sans 22/500. Signal line: 13px/ink-3.
- Light + dark parity verified.

---

## 11. States & accessibility

- Empty: Inbox "All clear — your operations are running smoothly." Snoozed/Resolved each own copy. ✅
- Loading: skeleton cards (3 progressive). ✅
- Error: graceful message, no raw throw. ✅
- A11y: non-colour severity (rail+icon+label), ARIA label on bell button, readOnly mode hides actions on resolved tab, keyboard nav via MUI components. ✅
- Motion: Collapse on category/severity groups. Snooze menu via MUI Menu. ✅

---

## 12. Cross-sprint dependencies

- ALR-07 backend columns (`acknowledged_at`, `acknowledged_by`, `snoozed_until`) — **shipped** in base migration 0079.
- ALR-05 `category` field — **populated** by all producers (aggregator, demand, wms).
- Operator audience filtering (mobile fast-follow) needs `audience` field + role model — `audience` column now in schema, role model TBD with WMS/operator sprint.
- Rules engine backend (`shop_alert_rules`, evaluation hooks) — separate sprint.

---

## 13. Open questions

- Resolved-tab retention window (30/60/90 days) before archival.
- Operator web access vs mobile-only — to be decided in operator/WMS sprint.
- Escalation worker (phase 2) — strongest anti-firefighting feature, deferred.
- External routing (Slack / email digest / webhook) — phase 2.
- FT2DateRangeBar on Resolved tab only — confirm in next audit.
