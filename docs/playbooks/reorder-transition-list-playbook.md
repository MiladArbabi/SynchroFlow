# ReorderTransitionList Playbook

## Purpose

`ReorderTransitionList` gives list reordering a smooth FLIP animation.

Use it when a list changes order after an action and the row would otherwise visually jump.

Examples:

- prioritizing an order
- moving an issue to the bottom of a queue
- re-ranking suppliers
- moving an exception from active to resolved
- changing queue order after a decision

## Location

```txt
modules/shared/src/ui/ReorderTransitionList.tsx

Import from:

import { ReorderTransitionList } from '@lasyncro/shared/ui';
Responsibility

This component only handles visual movement.

It does not:

sort items
delay business state
know what an order, supplier, SKU, or issue is
apply product-specific colors
decide when an item should move

The parent owns the data and business timing.

Basic usage
<ReorderTransitionList
  items={orders}
  getKey={(order) => order.lasyncro_order_id}
  renderItem={(order) => (
    <OrderDecisionRow order={order} />
  )}
/>
Product timing rule

If the UX needs confirmation before movement, delay the rendered order change in the parent.

Recommended pattern:

User clicks action
→ button enters pending state
→ API succeeds
→ row confirms in place for 400–600ms
→ parent allows reorder
→ ReorderTransitionList animates movement
Recommended timing
Confirmation hold: 500ms
Movement duration: 520ms
Easing: cubic-bezier(0.22, 1, 0.36, 1)
Accessibility

The component respects prefers-reduced-motion: reduce.

When reduced motion is enabled, rows reorder without animation.

Pitfalls
Do not put business logic inside this component

Bad:

<ReorderTransitionList shouldMovePriorityOrdersToBottom />

Good:

<ReorderTransitionList items={alreadySortedOrders} />
Do not use unstable keys

Bad:

getKey={(_, index) => String(index)}

Good:

getKey={(order) => order.lasyncro_order_id}
Do not rely on it to delay state

This component animates after order changes. It does not hold rows in place. Use parent state for confirmation delays.

Orders module example

For the Orders triage list:

OrdersModuleFT2 owns:
- priority API call
- local confirmation state
- delayed movement state
- sorting rule

ReorderTransitionList owns:
- row movement animation only