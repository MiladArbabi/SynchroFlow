# LaSyncro WMS — Mobile Workflow Playbook

**Version:** 0.1 (DRAFT)
**Date:** June 9, 2026
**Status:** ✅ RATIFIED — June 9, 2026 (DECISION-A→F closed)
**Scope:** All WMS workflows on the mobile app (`apps/mobile/`, Expo + React Navigation): Receive, Stow, Pick, Pack/Ship
**Authority:** Once ratified, this document is the engineering and UX contract for all mobile WMS workflow surfaces. Every mobile workflow session (MOB-RECEIVE-01 → MOB-PACK-01) MUST be audited against this playbook before shipping.
**Parent contract:** `docs/playbooks/wms_webapp_workflow_playbook.md` — all backend, data-model, and exception contracts in the webapp playbook apply to mobile unchanged. This document defines only what differs on mobile or is mobile-specific. Where the two conflict, this document wins for mobile surfaces.

---

## 1. What Transfers Unchanged From the Webapp Playbook

The following are SHARED contracts. Mobile reuses them verbatim — no mobile-specific variants:

| Contract | Source |
|---|---|
| Barcode namespaces: `LSU-` (unit), `LSO-` (order invoice), location codes, legacy EAN/UPC fallback gated by `shop_wms_settings.legacy_barcode_fallback_enabled` | WM-46/47, webapp playbook |
| Unit lifecycle: `received → stowed → picked → packed → shipped` on `inventory_units` | WM-46 |
| Sibling bulk-update rule: scanned unit first, then siblings by `receive_job_line_id` up to confirmed qty | WEB-STOW-UNIT-01, WEB-PICK-UNIT-01 |
| `current_location_code` written on stow confirm, nulled on pick confirm | WEB-STOW/PICK-UNIT-01 |
| Exception taxonomy + every exception creates a `problem_center_tasks` row | Webapp playbook §3 |
| All WMS API endpoints — mobile calls the SAME endpoints. No mobile-only endpoints unless registered here with justification | All sessions |
| `lasyncro_unit_id` threading: resolver returns it on product scan; client carries it into the confirm call; cleared between items | WEB-PICK-UNIT-01 |
| Idempotency via `device_event_id` on every scan-confirm POST | WMS-lite core |
| Pack is item-centric free-scan (`POST /wms/pack/free-scan`), LSU- + LSO- routing, auto-claim, auto-print, batch auto-complete | WEB-PACK-02 |
| Soft bin capacity check → `bin_over_capacity` Problem Center task | WEB-STOW-UNIT-01 |

**Rule:** if a backend behavior needs to change to support mobile, that change is a backend sprint with its own WM- ID — never an undocumented side effect of a MOB- session.

---

## 2. Mandatory Session Structure (Mobile)

Receive, Stow, and Pick follow the four-phase structure:

```
Brief → Scan (one item per screen) → Summary → Done
```

Pack follows the WEB-PACK-02 free-scan structure: **no Brief, no Summary** — always-on scan surface, batch auto-completes.

Mobile-specific phase requirements:

| Phase | Mobile requirements (beyond webapp) |
|---|---|
| **Brief** | Reached via push notification deep link OR TaskListScreen banner tap. Shows task summary + expected counts + single full-width CTA. Must render correctly when app is cold-started from a push. |
| **Scan** | ONE item per full screen. NO scrolling. Three zones top-to-bottom: (1) Location, (2) Product identity, (3) Action — scan input + Confirm + Report Problem. Progress indicator "Item N of M" pinned in header. |
| **Summary** | Per-line expected vs actual, exception count, single CTA. Back-navigation from Summary returns to last item, never discards state. |
| **Done** | What was created (stow tasks, fulfillment status), then returns to TaskListScreen — which MUST refetch on focus. |

---

## 3. Scan Surface Contract (Mobile-Native)

This is the largest divergence from the webapp. The webapp assumes USB/Bluetooth keyboard-wedge scanners feeding `ScanInput`. Mobile must support three input methods, all resolving through the same dual-namespace resolver:

1. **Camera scan (primary)** — `expo-camera` barcode scanning. Full-screen viewfinder opens from a scan button; on decode: haptic + decoded value injected into the same code path as manual entry; viewfinder closes automatically on single-target screens, stays open in free-scan (pack) mode for consecutive scans with a 1500ms duplicate-read debounce per value.
2. **Bluetooth HID scanner** — appears as keyboard input. The scan TextInput must hold focus (`autoFocus` + refocus on blur while screen is active) so a paired scanner works with the phone in a pocket. Submit on Enter/newline terminator.
3. **Manual entry (fallback)** — same TextInput, manual keyboard, explicit submit. Always available; never hide it behind the camera.

Shared behaviors (all three methods):
- **NodeTrack pattern** ports to mobile: two-node track (location → product) for Pick and Stow, pulse on active node, green flash on hit, red shake + auto-dismissing sad-path banner on miss. Same visual grammar as webapp, native components.
- Resolution happens server-side via the existing resolver endpoints. The client NEVER pattern-matches barcodes locally except for prefix routing display hints (`LSU-`/`LSO-`).
- Confirm disabled until a resolved match; Report Problem always enabled.

**[DECISION-1]** Camera library: `expo-camera` (current Expo SDK bundles barcode scanning; `expo-barcode-scanner` is deprecated). Confirm against the SDK version pinned in `apps/mobile/package.json` during MOB audit before ratifying.

---

## 4. Task Entry & Push Contract (WM-22 surface)

Operators discover work through push, not by polling the app.

- Every task-creating event (batch release, stow task created, receive job assigned, pack ready) fires an Expo push to entitled operators of that shop. Trigger coverage is verified — not assumed — during each MOB- audit.
- Push payload carries a deep link: `{ screen, params }` (e.g. `{ screen: 'PickBrief', params: { batchId } }`). Tapping the push routes directly to the Brief screen, including from cold start.
- TaskListScreen mirrors every push as a tappable banner/card, so a missed notification never strands a task. TaskListScreen refetches on focus (`useFocusEffect`).
- In-app: if a push arrives while the app is foregrounded mid-session, show a non-blocking toast — NEVER navigate away from an active scan session.

---

## 5. Offline Resilience Contract (WM-24 — mobile-first)

Warehouses have dead zones. This contract is mandatory for Pick first, then Stow, then Receive; pack stations are assumed connected (printer dependency) but still get the connection indicator and replay queue.

- **Connection indicator** — persistent online/offline pill in the session header of every workflow screen.
- **Session state persisted locally** — active session (type, batchId/jobId, current item index, confirmed-scan buffer) written to AsyncStorage on every state change. On app launch, if a persisted session exists for this operator, show a resume banner → restores to the exact item.
- **Scan queue** — confirm POSTs that fail on network error are queued locally `{ endpoint, payload, device_event_id, queuedAt }` and replayed FIFO on reconnect. `device_event_id` idempotency makes replay safe.
- **Blocking rule (from WMS-lite stress test):** the operator does NOT advance to the next item while the current item's confirm is unsynced. Show "Waiting for connection — scan saved" state on the current item. Report Problem follows the same queue rule.
- **No optimistic advance.** Optimistic UI is allowed for the green flash; advancing position is not.

**[DECISION-2]** Build order: implement the offline layer as a small shared module (`apps/mobile/src/offline/`) during MOB-PICK-01 (where it matters most), then retrofit Stow/Receive in their sessions — rather than a standalone foundation sprint. Alternative: foundation sprint MOB-OFFLINE-01 before any workflow. Default proposal: in-line with MOB-PICK-01.

---

## 6. Navigation, State & Persistence Rules

- Session screens are pushed onto the native stack; hardware/gesture back from an active Scan phase triggers a confirm dialog ("Leave session? Progress is saved.") — state is already persisted, so leaving is safe, but accidental back-swipes must not silently exit.
- Session identity travels in route params (`batchId`, `jobId`, `taskId`) — the mobile analog of the webapp's `?batchId=` URL persistence.
- No API calls inside shared UI components — screens own data fetching via `@lasyncro/mobile-core` apiClient; components receive data + callbacks (mirrors the webapp's gate-page injection rule).
- Theme tokens only (`src/theme` — `colors`, `font`, `spacing`, `radius`); no hardcoded hex, fontWeight max 600 (same as webapp rule).

---

## 7. Workflow-Specific Contracts

### 7.1 Receive (MOB-RECEIVE-01)
- Parity target: `ReceiveSessionPage` incl. WEB-RECEIVE-UNIT-01 — `batchConfirmUnits` fires on line inspect, LSU- IDs generated silently, shortfall guard on close.
- Free-scan Path B supported: scan any inbound unit → resolves to PO line → increments count → auto-confirm at expected qty → overcount dialog.
- Thermal label print trigger surfaced (print queue status shown; printing itself is station-side).

### 7.2 Stow (MOB-STOW-01)
- Parity target: WEB-STOW-UNIT-01 — item-first Option B: scan item (LSU-) → scan location → confirm qty. Two-node NodeTrack.
- Bulk sibling update + `current_location_code` write are backend behaviors — mobile only threads `lasyncro_unit_id` correctly.
- Bin capacity sad path surfaced as warning banner; does not block confirm (soft check, matches webapp).

### 7.3 Pick (MOB-PICK-01)
- Parity target: WEB-PICK-UNIT-01 — two-scan pattern (location → product/LSU-), `resolvedUnitId` carried product-scan → confirm, cleared between items.
- Offline layer lands here (§5).
- Pick-complete guard: Summary CTA disabled until all lines confirmed or excepted.

### 7.4 Pack (MOB-PACK-01)
- Parity target: WEB-PACK-02 — free-scan, no Brief/Summary. Continuous camera or HID scan: LSU- → resolves to order + line item, large variant image, sibling thumbnail strip; first scan per order triggers auto-print of invoice + label; LSO- invoice scan confirms shipment + Shopify writeback; batch auto-completes.
- Print is station-bound: mobile shows print-job status, never assumes the phone prints.
- **[DECISION-3]** Whether MOB-PACK-01 is worth building at all, or pack remains a webapp/station surface (packer is at a bench with a printer and screen — the phone adds little). Default proposal: build a minimal mobile pack surface last, re-evaluate after MOB-PICK-01.

---

## 8. Audit Checklist (run per MOB- session before shipping)

1. Session structure matches §2 (or §7.4 for pack)
2. All three scan input methods work and route through the server resolver
3. `lasyncro_unit_id` threaded on every confirm; cleared between items
4. `device_event_id` on every mutating scan call
5. NodeTrack visual grammar present (pulse / green flash / sad-path auto-dismiss)
6. Report Problem on every item screen → Problem Center task verified in DB
7. Push deep link cold-start lands on correct Brief
8. Kill-and-relaunch mid-session resumes to exact item
9. Airplane-mode mid-session: blocked advance, queued confirm, clean replay on reconnect (Pick onward)
10. Hardware back / swipe-back guarded
11. Theme tokens only; no scrolling on Scan screens; fits smallest supported viewport
12. Backend chain verified via SQL after simulated run (unit statuses, movements, warehouse statuses)

---

## 9. Backlog Register (Mobile WMS)

| ID | Workflow | Description | Priority | Status |
|---|---|---|---|---|
| MOB-AUDIT-00 | All | Audit existing mobile screens (ReceiveJobScreen, StowScreen, PickBriefScreen/ScanScreen, PackScreen) against this playbook; produce issue register | P1 | 📋 NEXT |
| MOB-RECEIVE-01 | Receive | Bring receive to §7.1 parity | P1 | 📋 PLANNED |
| MOB-STOW-01 | Stow | Bring stow to §7.2 parity | P1 | ✅ DONE |
| MOB-PICK-01 | Pick | Bring pick to §7.3 parity + offline layer (§5)| P1 | ✅ DONE |
| MOB-PACK-01 | Pack | §7.4 — pending DECISION-3 | P2 | 📋 PLANNED |
| MOB-PUSH-01 | Cross | Verify/complete push trigger coverage + deep links (§4) | P1 | ✅ DONE |

Following the established pattern — heredoc to run locally, review, amend before ratifying. Note this **appends** to the existing playbook; it does not overwrite. Two open points are marked **[DECISION]** inline for the workshop pass.

```zsh
cat >> docs/playbooks/wms_mobile_workflow_playbook.md << 'EOF'

---

# §10 — Mobile UX/UI System Specification

**Added:** v0.2 — June 9, 2026
**Status:** 🟡 DRAFT — pending workshop review
**Authority:** Once ratified, §10 is the UX contract for ALL mobile surfaces — workflow and non-workflow. Every MOB- session is audited against §10 in addition to §§2–8. Where §10 conflicts with §§2–8 on visual/interaction matters, §10 wins; on data/backend contracts, §§2–8 and the webapp playbook win.

---

## 10.1 Ratified Foundation Decisions

| ID | Decision | Outcome |
|---|---|---|
| DECISION-A | App identity | Operator-only. Owner intelligence stays on webapp. IA reserves one future tab slot ("Today") — no owner features built now. |
| DECISION-B | Home model | Prioritized task feed (vertical card stack). No board/Kanban metaphor. |
| DECISION-C | Global Scan tab | In IA from day one; built LAST (after MOB-PICK-01). `ScannerScreen` stub remains hidden until MOB-SCAN-01. |
| DECISION-D | Session pattern | Workflow sessions are full-screen modal stacks pushed ABOVE the tab navigator. Tab bar is not visible during an active session. |

## 10.2 Design Principles (auditable)

1. **Glanceable over readable.** Operator attention budget per screen: 1–3 seconds. Every screen must answer "what do I do next?" without reading body text.
2. **One-hand, gloves-on.** All primary interactions reachable and operable with one thumb, wearing work gloves. Minimum touch target 48dp. Primary CTAs full-width.
3. **Interruption is the normal case.** Every state survives pocketing, app kill, OS purge, connectivity loss. The operator never "remembers where they were" — the app does.
4. **Queue, not dashboard.** The spine is: tasks, in priority order, do the top one. Any element not serving task execution must justify its existence in this document or be removed.
5. **Calm urgency.** Status flows through the color/motion grammar (§10.6). Modal dialogs are reserved for data-loss decisions only (leave-session guard, shortfall confirm).

## 10.3 Information Architecture

```
[Tab Navigator — bottom bar, 4 roots]
  Home      — Task Inbox feed (§10.5.1) — push deep-link default landing
  Problems  — Problem Center: reported-by-me + assigned-to-me
  Scan      — global free-scan (HIDDEN until MOB-SCAN-01)
  Me        — availability calendar, shift status, settings, sign-out

[Reserved slot] — "Today" owner tab. NOT built. IA + nav code must
                  accommodate a 5th root without restructuring.

[Modal session stacks — above tabs, tabs hidden]
  ReceiveSession  — Brief → Inspect → Scan → Summary → Done
  StowSession     — Brief → Location → Product → Qty → Summary → Done
  PickSession     — Brief → (Location → Product)×n → Summary → Done
```

Rules:
- Sessions are entered ONLY from a TaskCard CTA, a ResumeBanner, or a push deep link. Never from a tab directly.
- PackScreen: removed from nav stack and task routing entirely (MOB-PACK-01). Pack tasks must never produce a mobile TaskCard or push deep link.
- Session identity travels in route params (`batchId`, `jobId`, `taskId`) — unchanged from §6.

## 10.4 Screen Archetypes

Every mobile screen MUST be one of four archetypes. A screen that fits none is a design error.

### 10.4.1 Feed (Home, Problems)
- Header: screen title + shift status + connectivity pip (§10.6).
- Body: vertical TaskCard stack, pull-to-refresh.
- ResumeBanner pinned above the stack whenever a session is live — always the topmost element.
- Empty state: one line + one illustration token, no CTA spam.

### 10.4.2 Brief (session entry)
- What / where / how-much summary. Target: no scroll; if line-item preview forces scroll, collapse to count + "view lines" expander.
- One primary CTA (e.g. "Start picking — 29 items"). Secondary "Not now" returns to feed WITHOUT claiming.
- Push deep links land here (or on Resume if session already claimed).

### 10.4.3 Work (Scan/Inspect phases) — strictest archetype
- Layout thirds:
  - TOP: NodeTrack + instruction line ("Go to **A-3-07**").
  - MIDDLE: the live datum at display scale (location code / product + variant attrs / qty).
  - BOTTOM: ScanDock + Report Problem.
- **NO SCROLLING. EVER.** Content that does not fit is a design failure, not a viewport problem. Audit on smallest supported viewport.
- Exit: top-left only, always guarded by leave-session dialog on active phases.

### 10.4.4 Summary
- Line checklist (done / excepted / short), shortfall callouts.
- Single confirm CTA; disabled until all lines confirmed or excepted (§7.3 guard).
- Exit guarded.

## 10.5 Layout Contracts

### 10.5.2 The 1-3-rest pyramid (hard rule, audited per screen)
Per screen state: exactly ONE element at display scale (`font.display`), at most THREE at body scale, everything else caption scale or behind an expander. 

### 10.5.3 Thumb-zone contract
- Bottom 40% of viewport = action zone: primary CTA at the very bottom edge (full-width), ScanDock directly above it.
- Top zone = read-only context. No interactive elements above the midline except header back/exit.
- Exit/close: top-left ONLY (deliberate out-of-thumb friction + guard dialog).
- Report Problem: persistent, bottom-right, one tap. NEVER inside an overflow menu (§3 exception contract).

## 10.6 Color & Motion Grammar (extends NodeTrack)

| Signal | Treatment | Trigger |
|---|---|---|
| Confirmed | Green flash + success haptic | Server-confirmed scan |
| Soft warning | Amber banner, auto-dismiss 4s | Sad path, `bin_over_capacity` |
| Blocked | Red persistent banner | Server rejection; offline with blocked advance |
| Awaiting you | Node pulse | Active NodeTrack node |
| Queued | Grey "queued" chip on line | Offline-queued confirm (Pick, §5) |
| Connectivity | Header pip: green=live, amber=degraded, grey=offline | ALL screens, not Pick-only. Operators must never discover offline state at confirm time. |

- Haptics: success (light), error (heavy double). No haptic on neutral navigation.
- Theme tokens only (`colors`, `font`, `spacing`, `radius`); fontWeight ≤ 600. No hardcoded hex. (Restated from §6 — §10 audits enforce it.)

## 10.7 Shared Component Inventory

Screens COMPOSE these; screens never reimplement their concerns. No API calls inside shared components (§6 rule stands).

| Component | Absorbs / replaces | Owns | Audit issues resolved structurally |
|---|---|---|---|
| `ScanDock` | `BarcodeScannerView` + manual-entry path | Camera decode, always-focused HID TextInput, manual fallback, per-value 1500ms debounce, haptics, server-resolver call-out via callback | MOB-AUD-01, -02, -09 |
| `NodeTrack` | new | Two-node visual, pulse/flash/transition states | MOB-AUD-07 |
| `SessionShell` | per-screen phase logic | Phase state machine, AsyncStorage persistence + resume, hardware/gesture back-guard, leave-session dialog, `device_event_id` generation per mutating call | MOB-AUD-06, MOB-RCV-04, MOB-STW-05/-06, MOB-PCK-08/-10 |
| `ProblemSheet` | per-screen exception modals | Exception taxonomy UI, Problem Center POST with retry, `lasyncro_unit_id` threading | MOB-AUD-10, MOB-STW-04, MOB-PCK-11/-12 |
| `TaskCard` | new | §10.5.1 anatomy | — |
| `ResumeBanner` | new | Live-session pin + resume deep link | — |
| `QtyStepper` | inline qty inputs | Glove-sized ± controls, min/max clamps | — |

- `WorkflowStep.tsx`: **deprecated** — decomposed into `ScanDock` + `NodeTrack` + `SessionShell` concerns. MOB-AUD-03/-04/-05/-08 die with it.
- **[DECISION-E — CLOSED]** `SessionShell` persists a full phase-state snapshot to AsyncStorage on every phase transition. Server-side resume remains the fallback at task boundary.
- **[DECISION-F — CLOSED]** Offline confirm queue is a standalone `@lasyncro/mobile-core` service (`offlineQueue`), consumed by `SessionShell`. Queue persists and replays independently of any session lifecycle, including after app restart.

## 10.8 §8 Audit Checklist — additions

13. Screen matches exactly one §10.4 archetype
14. 1-3-rest pyramid holds in every screen state
15. Thumb-zone contract holds (CTA bottom edge, exit top-left, Report Problem persistent)
16. Connectivity pip present and truthful on every screen
17. No screen reimplements a §10.7 component concern

## 10.9 Backlog Register — amendments

| ID | Workflow | Description | Priority | Status |
|---|---|---|---|---|
| MOB-UX-01 | Foundation | Build `ScanDock`, `SessionShell`, `NodeTrack`, `ProblemSheet`; deprecate `WorkflowStep`; absorbs MOB-AUD-01→10 | P1 | ✅ DONE |
| MOB-HOME-01 | Foundation | Tab scaffold (4 roots + reserved slot), Task Inbox feed, `TaskCard`, `ResumeBanner`; remove PackScreen from nav + routing | P1 | ✅ DONE |
| MOB-RECEIVE-01 | Receive | Re-scoped: re-compose onto §10.7 shell + MOB-RCV-01/-02/-03 | P1 | ✅ DONE |
| MOB-STOW-01 | Stow | Re-composed onto §10.7 shell; fixes MOB-STW-01→08 (unit_id threading, device_event_id, bin_over_capacity, ProblemSheet, WorkflowStep removed) | P1 | ✅ DONE |
| MOB-PICK-01 | Pick | Re-composed onto §10.7 shell; fixes MOB-PCK-01→14 (unit_id, device_event_id, server-side location resolve, ProblemSheet, WorkflowStep removed, Summary phase, two-file merge); offline layer via offlineQueue (@lasyncro/mobile-core, DECISION-F) | P1 | ✅ DONE |
| MOB-PUSH-01 | Cross | expo-notifications installed; token registration (usePushRegistration); foreground toast (§4 non-blocking); tap deep link → PickBrief/ReceiveJob/Stow from background + cold start; navigationRef wired | P1 | ✅ DONE |
| MOB-SCAN-01 | Cross | Global free-scan tab: resolver-driven contextual actions | P2 | 📋 PLANNED |
| MOB-PACK-01 | Pack | ❌ NOT BUILDING — folded into MOB-HOME-01 as nav/routing removal | — | ❌ DESCOPED |