# Alerts Module — Blueprint

**Status:** 🟡 Frontend & UX sprint · Spec locked 2026-05-29 · Awaiting AUDIT
**Scope:** Web module surface only. Notification bell + operator mobile = fast-follows.
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
| D1 | Default view = **consequence taxonomy**; severity is a toggle, not the primary grouping. |
| D2 | Lifecycle verbs = **Acknowledge / Snooze / Resolve**. Operators acknowledge-only; owners/admins resolve. Auto-resolve when the signal clears is primary. Dismiss is retired. |
| D3 | This sprint ships the **web module surface only**. Bell + mobile follow. |
| D4 | Severity = **commercial consequence**, not technical severity. critical = money leaving / customer breach imminent; warning = trending to breach; info = state transition. |
| D5 | Severity is communicated by **rail + icon + label**, never colour alone (inclusive design; survives dark mode + colour-blindness). |
| D6 | Counts live **inside the module** and on the bell (hover); the **sidenav stays a calm dot** (B-07). |

---

## 3. Routes & IA

Module mounted at `/alerts/*` (`LifecycleRouteHost.tsx` ~L221; import ~L39; vite alias
`@lasyncro/alerts` ~L76). Sidenav entry in `modules/alerts/src/ui/ModuleEntry.tsx`
(Bell icon, group `operations`).

`ModuleTabBar` (same component as Products/Inventory):

| Tab | Path | Purpose |
|-----|------|---------|
| Inbox | `/alerts` | Active + acknowledged alerts (live working surface) |
| Snoozed | `/alerts/snoozed` | Parked until timer expires |
| Resolved | `/alerts/resolved` | Auto/owner-resolved history |
| Rules | `/alerts/rules` | Rule-builder shell (gated until backend lands) |

---

## 4. Backend endpoints

**Existing:**
- `GET /api/v1/alerts` — ranked inbox (polled 30s). Returns `Alert[]` + meta.
- `POST /api/v1/alerts/:id/dismiss` — **retiring** (replaced by resolve; see KI-2).

**Required for this sprint (depends on backend-sprint schema):**
- `POST /api/v1/alerts/:id/acknowledge` → sets `acknowledged_at`, `acknowledged_by`.
- `POST /api/v1/alerts/:id/snooze` → body `{ until: ISO }` → sets `snoozed_until`.
- `POST /api/v1/alerts/:id/resolve` → owner/admin only; sets `resolved_at` manually.
- `GET /api/v1/alerts?status=resolved|snoozed` — tab filtering.

---

## 5. Data contract

`apps/frontend/src/pages/alerts/useAlerts.ts` — `Alert` type today:
`id, alert_key, source, alert_type, severity, title, message, entity_id, entity_type,
revenue_impact, is_active, dismissed_at, resolved_at, created_at, updated_at`.

**Fields added by backend sprint, consumed here:**
`category` (consequence taxonomy), `audience` (`operator|owner|all`),
`acknowledged_at`, `acknowledged_by`, `snoozed_until`, `escalated_at`, `rule_id`.

Frontend must tolerate their absence (optional types) until backend lands.

---

## 6. Consequence taxonomy & source mapping

| Category | Fed by (`source` / signal) |
|----------|----------------------------|
| Revenue at risk | snapshot (revenue-at-risk), constraint (SLA breach, blocked fulfilment), order_age |
| Stock & reorder | demand (stockout, reorder), constraint (inventory block) |
| Money & margin | AL-06 missing COGS, low-margin, blended-margin drop vs shop baseline |
| Supplier & inbound | supplier (PO overdue, on-time/fill/defect), defective receive batch |
| Warehouse floor | wms (pick/pack exception, stow pending, batch ready, operator idle) — operator audience |
| Data trust | sync stale, SKUs missing cost, identity-map gaps |

Within a category: severity-ranked, then `revenue_impact`-ranked.

---

## 7. Frontend component tree

```
AlertsPage (apps/frontend/src/pages/ft2-pages/AlertsPage.tsx)         [rebuild]
├─ PageHeader            DM Sans 22/500 "Alerts" + 13px/ink-3 signal line
├─ ModuleTabBar          Inbox · Snoozed · Resolved · Rules
├─ AlertsPulseStrip      FT2 stat cards: Critical · $ at risk · Oldest unresolved · Ack/total
├─ AlertsFilterBar       category · severity · status · source chips
├─ ViewToggle            Consequence ⇄ Severity
├─ AlertCategoryGroup[]  collapsible; header = icon + label + count   [consequence view]
│   └─ AlertCard[]
├─ AlertSeverityGroup[]  Critical → Warning → Info                    [severity view]
│   └─ AlertCard[]
├─ EmptyState            per-tab
├─ AlertsSkeleton        progressive loading (not bare spinner)
└─ ErrorState

AlertCard
├─ SeverityRail + SeverityIcon + SeverityLabel   (never colour-only)
├─ Title (ink-1, ≤500) · Message (ink-2)
├─ SourceBadge · RelativeAge · RevenueChip
├─ PrimaryCTA  "Go to {X} →"  (var(--accent); deep link)
├─ Actions: Acknowledge (ghost) · SnoozeMenu (1h/4h/tomorrow) · Resolve (owner only)
└─ AcknowledgedFooter (who + when, when acknowledged)
```

---

## 8. Hooks

```
apps/frontend/src/pages/alerts/useAlerts.ts          [extend]
  useAlerts(filters)            GET /alerts, poll 30s
  useAlertCount()               feeds useModuleHealth dot
  useAcknowledgeAlert()         POST /:id/acknowledge   [new]
  useSnoozeAlert()              POST /:id/snooze         [new]
  useResolveAlert()             POST /:id/resolve        [new, owner-gated]
  (useDismissAlert — deprecated)
```

All mutations optimistic with rollback (pattern from `useConstrainedOrders`/orders cache).

---

## 9. UX model — lifecycle

| State | Visual | Who | Notes |
|-------|--------|-----|-------|
| Active | full severity styling, primary CTA | — | default |
| Acknowledged | severity mutes to neutral; footer "ack by X" | operator + owner | stays visible; does NOT fight aggregator re-upsert (fixes KI-2) |
| Snoozed | hidden from Inbox → Snoozed tab | operator + owner | returns on timer |
| Resolved | gentle fade → Resolved tab | auto, or owner manual | system resolves when signal clears |

Action hierarchy: primary = deep link; secondary = Acknowledge + Snooze; Resolve/Dismiss
= owner/admin only. Operators acknowledge, never clear.

---

## 10. Design system (FT2)

Via `useModuleTheme()` (DS-001) — no hardcoded hex.
- Surfaces: `--bg` (page) / `--surface` (cards).
- Borders: `--rule`, 0.5px. fontWeight ≤ 500.
- Accent: `--accent #FF6B2B`, `--accent-hover #FF8C5A`, `--accent-ghost rgba(255,107,43,0.12)`.
- Ink: ink-1 / ink-2 / ink-3.
- Title: DM Sans 22/500. Editorial accents: DM Serif Display. Signal line: 13px/ink-3.
- Light + dark parity verified after every change.

---

## 11. States & accessibility

- Empty: Inbox "All clear — your operations are running smoothly." Snoozed/Resolved each own.
- Loading: skeleton cards. Error: graceful, retry.
- A11y: non-colour severity (rail+icon+label), keyboard nav on cards, ARIA live-region
  announce on new critical, focus management on tab change, AA contrast both modes.
- Motion: calm. Critical → subtle slide-in (no flashing — contrast with WMS pick screen).
  Resolved → fade. Snooze → collapse.

---

## 12. Known issues

| ID | Pri | Description |
|----|-----|-------------|
| KI-1 (ISSUE-007) | P1 | Deep links dead: backend fires colon keys w/ dynamic IDs (`wms:exception:pick:{batchId}`); frontend `ALERT_TYPE_ROUTES` matches static underscore keys. Fix routing map → ALR-08. |
| KI-2 | P1 | Dismiss is broken UX — aggregator re-upserts `is_active=true`, alert silently returns. Resolved by retiring dismiss for Acknowledge/auto-resolve → ALR-07. |
| KI-3 | P1 | `AlertsPage` is pre-FT2 (fontWeight 700, 1px borders, raw MUI, no ModuleTabBar) → ALR-02/03. |

---

## 13. Sprint register

| ID | Description |
|----|-------------|
| ALR-01 | This blueprint |
| ALR-02 | FT2 conversion via `useModuleTheme()` |
| ALR-03 | Page shell: title + signal line + ModuleTabBar |
| ALR-04 | AlertsPulseStrip (FT2 stat cards) |
| ALR-05 | Consequence grouping + severity toggle + category icons |
| ALR-06 | AlertCard FT2 redesign |
| ALR-07 | Acknowledge / Snooze / Resolve model + states *(dep: backend schema cols)* |
| ALR-08 | Deep-link routing fix (KI-1) |
| ALR-09 | Filter bar |
| ALR-10 | Empty / skeleton / error states |
| ALR-11 | Rules tab UI shell (gated) |
| ALR-12 | Accessibility pass |

**Build order:** 02/03 → 04/05/06 → 07/08 → 09/10 → 11 → 12.

---

## 14. Cross-sprint dependencies

- ALR-07 needs `acknowledged_at`, `acknowledged_by`, `snoozed_until` columns + the
  acknowledge/snooze/resolve endpoints (Alerts/Backend sprint).
- ALR-05 needs the `category` field populated by producers (backfill in backend sprint).
- Operator audience filtering (mobile fast-follow) needs `audience` + role model (WM-19).

---

## 15. Open questions

- Resolved-tab retention window (30/60/90 days) before archival.
- Does the Rules tab render disabled-with-preview, or hide until backend ships? (Lean: preview.)
- FT2DateRangeBar on Resolved tab only (Inbox/Snoozed are live) — confirm in audit.
````