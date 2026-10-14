// GH-1242 — canonical non-configurable permission authority.
// Dependency-free: no middleware, database, Redis, or settings imports.
// Locked actions derive their effective roles exclusively from
// ACTION_ROLE_MAP, never persisted permission rows or cache entries.

export const ACTION_ROLE_MAP: Record<string, string[]> = {

  // ── SUPPLIERS / PO ─────────────────────────────────────────
  'suppliers:read':           ['owner', 'admin'],
  'suppliers:write':          ['owner', 'admin'],
  'po:read':                  ['owner', 'admin'],
  'po:write':                 ['owner', 'admin'],
  'po:receive':               ['owner', 'admin'],
  'po:status':                ['owner', 'admin'],
  'receive-job:create':       ['owner', 'admin'],
  'receive-job:assign':       ['owner', 'admin'],
  'receive-job:read':         ['owner', 'admin', 'operator'],
  'receive-job:inspect':      ['owner', 'admin', 'operator'],
  'receive-job:close':        ['owner', 'admin', 'operator'],
  'receive-job:exception':    ['owner', 'admin', 'operator'],

  // ── WMS ────────────────────────────────────────────────────
  'wms:read':                 ['owner', 'admin', 'operator'],
  'wms:batch:release':        ['owner', 'admin'],
  'wms:batch:claim':          ['owner', 'admin', 'operator'],
  'wms:pick:scan':            ['owner', 'admin', 'operator'],
  'wms:pack:scan':            ['owner', 'admin', 'operator'],
  'wms:returns:scan':         ['owner', 'admin', 'operator'],
  'wms:stow:claim':           ['owner', 'admin', 'operator'],
  'wms:stow:confirm':         ['owner', 'admin', 'operator'],
  'wms:stow:assign':          ['owner', 'admin'],
  'wms:stow:location':        ['owner', 'admin', 'operator'],
  'wms:exception:report':     ['owner', 'admin', 'operator'],
  'wms:ship:confirm':         ['owner', 'admin', 'operator'],
  'wms:settings:write':       ['owner', 'admin'],

  // GH-1222: management boundaries — owner/admin only, LOCKED in
  // permissionSettings so a shop cannot re-grant them to operator.
  'wms:analytics:read':          ['owner', 'admin'],
  'wms:analytics:display:write': ['owner', 'admin'],
  'wms:problem:resolve':         ['owner', 'admin'], // resolve/discard/write_off decisions

  // Inventory recount: operators count; owner/admin control task + corrections.
  'wms:recount:create':       ['owner', 'admin'],
  'wms:recount:read':         ['owner', 'admin', 'operator'],
  'wms:recount:claim':        ['owner', 'admin', 'operator'],
  'wms:recount:count':        ['owner', 'admin', 'operator'],
  'wms:recount:review':       ['owner', 'admin'],
  'wms:recount:commit':       ['owner', 'admin'],
  'wms:recount:reassign':     ['owner', 'admin'],

  // ── RETURNS ────────────────────────────────────────────────
  'returns:read':             ['owner', 'admin', 'operator'],
  'returns:job:create':       ['owner', 'admin', 'operator'], // operator creates return job on mobile
  'returns:job:claim':        ['owner', 'admin', 'operator'], // operator claims job on mobile
  'returns:job:process':      ['owner', 'admin', 'operator'], // operator sets condition on line items
  'returns:job:complete':     ['owner', 'admin', 'operator'], // operator completes job
  'returns:decision:write':   ['owner', 'admin'],             // owner/admin sets decision on flagged items

  // ── FLOOR PLANNING ─────────────────────────────────────────
  'floor-planning:read':      ['owner', 'admin'],
  'floor-planning:write':     ['owner', 'admin'],

  // ── ALERTS ─────────────────────────────────────────────────
  'alerts:read':              ['owner', 'admin', 'operator'],
  // audience filtering enforced server-side in controller
  'alerts:acknowledge':       ['owner', 'admin', 'operator'],
  'alerts:snooze':            ['owner', 'admin', 'operator'],
  'alerts:resolve':           ['owner', 'admin'],
  'alerts:rules:read':        ['owner', 'admin'],
  'alerts:rules:write':       ['owner', 'admin'],

  // ── ORDER NEXUS ────────────────────────────────────────────────────────────
  'orders:prioritise':        ['owner', 'admin'],
  // GH-1223: user-triggered Orders writes — owner/admin only, LOCKED.
  'orders:execute':                ['owner', 'admin'],
  'orders:shipping-address:write': ['owner', 'admin'],

  // ── CUSTOMERS ──────────────────────────────────────────────────────────────
  'customers:read':           ['owner', 'admin'],

  // ── OVERVIEW / MORNING BRIEF ───────────────────────────────
  'overview:read':            ['owner', 'admin'],
  'morning-brief:read':       ['owner', 'admin'],

  // ── MEMBERS ────────────────────────────────────────────────
  'members:read':             ['owner', 'admin'],
  'members:write':            ['owner'],           // owner-only: role assignment
  'members:remove':           ['owner'],           // owner-only: seat removal

  // ── EXPORTS ────────────────────────────────────────────────
  'exports:read':             ['owner', 'admin'],

  // ── BILLING ────────────────────────────────────────────────
  'billing:read':             ['owner', 'admin'],
  'billing:write':            ['owner'],           // owner-only: plan changes

  // ── INTEGRATIONS ───────────────────────────────────────────
  'integrations:write':       ['owner', 'admin'],

  // ── SHOPIFY BILLING ────────────────────────────────────────
  'shopify-billing:read':     ['owner', 'admin'],
  'shopify-billing:write':    ['owner'],
};

export const LOCKED_ACTIONS = new Set([
  'members:write',
  'members:remove',
  'billing:write',
  'shopify-billing:write',
  'wms:settings:write',
  // GH-1222: ratified owner/admin management boundaries — never configurable.
  'wms:analytics:read',
  'wms:analytics:display:write',
  'wms:problem:resolve',
  // GH-1223: ratified owner/admin Orders write boundaries — never configurable.
  'orders:execute',
  'orders:shipping-address:write',
]);
