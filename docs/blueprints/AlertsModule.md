# Alerts Module — Blueprint

**Status:** GH-1147 implemented architecture
**Scope:** Merchant Alerts module, notification history, notification preferences, and delivery semantics.
**Project root:** `/Users/miladarbabi/Codes/projects/SynchroFlow/`

---

## 1. Purpose

Alerts answers one job:

> Tell me when something I care about happens.

Alerts is not an operational task workspace. It does not own assignment,
acknowledgement, resolution, operational snoozing, root-cause triage,
prioritization, task queues, or workflow state. It records notification history
and lets a merchant choose how notifications should be routed. When action is
needed, Alerts deep-links to the canonical owning module.

The canonical flow is:

```text
SOURCE CONDITION
→ ALERT ELIGIBILITY
→ USER PREFERENCES
→ NOTIFICATION EVENT
→ CHANNEL ROUTING
→ DELIVERY
→ READ / CLICK HISTORY
```

---

## 2. Routes and Surface

```text
Alerts
├── Recent
└── Settings
```

| Route | Surface |
|---|---|
| `/alerts` | Recent notification history |
| `/alerts/settings` | Alerts-module Settings |
| `/settings/alerts` | The same Alerts settings implementation inside the Settings modal |
| `/settings/notifications` | Legacy redirect to `/settings/alerts` |
| `/settings/integrations` | Legacy redirect to `/settings/alerts` |

Profile menu:

- Alerts -> `/alerts`

Ops Console:

- Alert settings -> `/settings/alerts`

Retired merchant Alerts UI: Inbox, Snoozed, Resolved, Rules, alert-rule
management, acknowledgement, assignment, operational snooze, resolution, the
commercial pulse strip, and alert-rule management are no longer part of the
merchant Alerts module. `AlertRulesPanel` is retired. The backend alert-rule
evaluation subsystem still exists where order projection depends on it.

---

## 3. Recent

Recent is notification history. One logical notification remains one Recent item
regardless of channel:

- in-app
- push
- email

Recent states are only:

- Unread
- Read
- Clicked

Recent does not own operational lifecycle state. Its CTA hands off to the
canonical owning module.

Current implemented notification conditions are exactly:

| Condition | Area | Urgency | Critical in-app protection | Action |
|---|---|---|---|---|
| `orders_cannot_be_fulfilled` | fulfillment | critical | true | `/orders` |
| `not_enough_stock_to_fulfill_orders` | inventory | important | false | `/orders/flow?constraint=inventory` |

Do not document future notification conditions as implemented until they ship.

---

## 4. Settings and Defaults

Canonical notification preference defaults:

| Preference | Default |
|---|---|
| Urgency | Important + critical |
| In-app | Always on |
| Push | ON preference |
| Email | OFF |
| Quiet hours enabled | false |
| Quiet hours prepared window | 22:00-07:00 |
| Quiet hours allow critical | true |
| Daily summary | backend field exists with default `off`; no scheduler or UI control |

Critical protection:

- A critical protected condition remains in-app even if its condition `enabled`
  preference is false.
- External channels remain suppressible.
- A non-critical condition may be disabled normally.

External-channel hierarchy:

```text
effective channel =
  global master ON
  AND condition channel override !== false
```

A condition-level `true` never resurrects a globally disabled channel.

---

## 5. Push Preference vs Registered Capability

Push preference and push capability are separate facts.

Push preference answers:

> Should LaSyncro send push where a registered destination exists?

Registered capability answers:

> Does this user currently have a registered push destination?

`GET /api/v1/notifications/push-status` exposes non-secret counts only, for the
current authenticated FT2 user and tenant. The response does not include endpoint,
key, auth, or token values.

The Settings UI can truthfully show:

```text
Push notifications [ON]
No device registered
Push won't be delivered until notifications are enabled on a device.
```

Registered means structurally present, not healthy, active, or guaranteed
working. Provider validity is known only at send time.

Push OFF suppresses delivery but does not delete subscriptions. Push ON does not
request browser permission or create a subscription.

Current registration paths:

- Web Push through the existing WMS flow
- Expo through the mobile application

Device management and user-initiated "enable on this device" UX are follow-ups,
not GH-1147.

---

## 6. Delivery Semantics

External delivery is intentionally at-least-once.

Crash window:

```text
provider may accept
→ process may die before local sent state commits
→ lease may expire
→ delivery may be retried
```

Retries are bounded. `sent` means provider acceptance/local send state, not
confirmed device delivery.

Resend uses:

```text
Idempotency-Key: notification-delivery:<deliveryId>
```

Web Push and Expo do not guarantee exactly-once provider delivery. Do not claim
exactly-once external delivery.

Web Push payload identity uses the logical notification event:

```text
tag: lasyncro-notification:<notificationEventId>
```

Semantics:

- same notification event retry -> same tag
- different notification event -> different tag

This prevents separate logical notifications from replacing one another in the
OS tray while allowing duplicate delivery of the same logical event to replace
itself. Expo collapse semantics remain a follow-up.

---

## 7. Time and Quiet Hours

`shops.timezone` is the canonical time authority. Alerts quiet-hours evaluation
consumes `shops.timezone` and is DST-safe.

Alerts does not introduce a separate timezone. Localization remains the owner of
shop timezone.

---

## 8. Audience

The two current constraint-derived conditions originate from legacy alerts with
`audience='all'`.

Current semantics:

- every active shop membership receives the notification occurrence
- owner, admin, and operator memberships are included
- revoked memberships are excluded

This is intentional current behavior. Role-specific notification preferences do
not exist.

---

## 9. Noise, Dedupe, and Reactivation

Notification occurrence rules:

- notify on activation
- do not duplicate while the same alert remains active
- clearing does not notify
- inactive -> active reactivation creates a new occurrence
- delivery is unique per notification event + channel
- one Recent item remains one logical notification

The source boundary is activation detection. Do not describe occurrence random
UUIDs as the dedupe mechanism.

---

## 10. Deployment and Migration

Migration `0187_create_notification_history_tables` must land before GH-1147
runtime starts. The canonical GitHub/Fly deploy workflow runs privileged
migrations before `flyctl deploy`; failed migration prevents runtime deployment.

The API and notification worker run in the same process. Migration 0187 is
additive.

Operational caveat: manual `flyctl deploy` bypasses the workflow migration step
and must not be used for this schema-changing release without running the
privileged migration path first.

---

## 11. Transitional #1123 Boundary

Legacy operational alerts still exist temporarily for Ops Console and shell
attention.

```text
Topnavbar / Ops Console attention source:
  legacy operational alert lifecycle

/alerts Recent:
  new notification_events history
```

These may disagree. That is accepted transitional debt owned by #1123.

Do not imply that:

- the Ops Console dot is Recent unread count
- old operational alerts were deleted
- GH-1147 migrated operational state into notification history

GH-1147 removes operational ownership from the merchant Alerts surface.

---

## 12. Follow-ups

Known follow-ups, not implemented by GH-1147:

- #1123 legacy operational-alert migration
- push device-management / user-initiated registration UX
- notification-history retention / purge policy, likely 90-180 days
- Expo duplicate-collapse improvements
- broader legacy backend alert lifecycle cleanup
