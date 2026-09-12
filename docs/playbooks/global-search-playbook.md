# Global Search Playbook

**Status:** IMPLEMENTED / AUTOMATED VERIFIED / LIVE VERIFIED — 2026-09-12

## Purpose

Ops Console Global Search is a read-only discovery layer for merchants who
already know the entity they want to inspect.

It complements the Ops Console attention surface:

```text
Ops Console attention surface = What needs action?
Global Search                 = Take me to this entity.
```

Search is discovery-only. A result may help choose an entity, but it is never
the detail authority.

## V1 Searchable Types

- Order
- Variant/Product
- Active Pick Batch

Explicitly not V1:

- PO
- Supplier
- Location
- Operator
- Alert
- Inventory movement

## Backend Contract

Endpoint:

```http
GET /api/v1/search?q=
```

Permanent contracts:

- authenticated;
- tenant scoped;
- read-only SELECT behavior;
- trimmed query;
- query shorter than two characters produces no remote result;
- max six merged results;
- one backend fan-out; no frontend domain fan-out;
- exact IDs, SKU, and barcode rank above prefix matches, which rank above
  general text;
- external merchant order identity maps to canonical `lasyncro_order_id`;
- active batches only; `pack_complete` and `cancelled` are excluded;
- variant search covers product title, variant title, SKU, `variants.barcode`,
  and `variants.lasyncro_barcode`.

Result shape:

```ts
{
  type: 'order' | 'variant' | 'batch';
  id: string;
  label: string;
  secondary: string | null;
  meta: string | null;
  match: 'exact' | 'prefix' | 'text';
}
```

The result payload is discovery metadata only. It must not become canonical
detail truth.

## Frontend Contract

Global Search lives inside Ops Console below the OPEN / HISTORY tabs.

Interaction contract:

- 175ms debounce;
- one-character `Keep typing...` state;
- max six rendered results;
- ArrowUp / ArrowDown / Enter / Escape keyboard behavior;
- no autofocus when Ops Console opens;
- idle custom `_` caret only while the input is empty and unfocused;
- focused input uses only the native accent caret;
- Escape clears search, not Ops Console.

## Destinations

### Order

Selecting an order result opens the canonical `EntityDetailModal` with
`OrderDetailModalBody` in place.

The current route is preserved and Ops Console remains behind the modal.

### Batch

Selecting a batch result opens the canonical `EntityDetailModal` with
`BatchDetailModalBody` in place.

The current route is preserved and Ops Console remains behind the modal.

### Variant / Product

Selecting a variant result opens canonical `VariantDetailModalHost` in place.

The current route is preserved and Ops Console remains behind the modal.
`VariantDetailModalHost` resolves detail from canonical `useProductsCatalog`
data. Search payload fields such as label, SKU, meta, or status must not become
detail truth.

### Catalog Deep Link

The catalog deep link remains supported:

```text
/inventory/catalog?variant=<id>
```

It opens the same `VariantDetailModalHost`. Closing from Catalog removes only
`variant=` and preserves unrelated query params.

## Test / Verify Contracts

Permanent contract names:

- `TENANT-SEARCH-01`
- `SEARCH-SCOPE-01`
- `SEARCH-LIMIT-01`
- `SEARCH-IDENTITY-01`
- `SEARCH-RANK-01`
- `SEARCH-VARIANT-01`
- `SEARCH-READONLY-01`
- `SEARCH-DESTINATION-01`
- `OPS-CONSOLE-01`
- `SEARCH-KEYBOARD-01`
- `SEARCH-SPATIAL-01`

Final automated evidence recorded for this slice:

- test ownership clean;
- ranking unit 3/3;
- API integration 3/3 against real Postgres/RLS;
- Ops Console 100/100;
- Variant + Batch entity surface 16/16;
- commercial map contracts 54/54;
- target TypeScript errors 0;
- diff check clean.

Final live verification recorded for this slice:

- Order result opens in-place canonical Order modal;
- Variant result opens in-place canonical Variant modal;
- Catalog deep link still works;
- single-caret behavior;
- Batch result opens in-place canonical Batch modal;
- Batch to Order transition;
- Batch modal is scroll-free in dark and light themes.
