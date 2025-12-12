// modules/order-nexus/src/ModuleEntry.ts

// A trivial “page” just to prove mounting works
const OrdersPage = () => null;

// Module metadata (expand later)
export const descriptor = {
  id: 'order-nexus',
  name: 'OrderNexus',
  version: '0.1.0',

  routes: [
    {
      id: 'orders',
      key: 'orders',
      name: 'Orders',
      path: '/orders',
      component: OrdersPage,
      requiredModuleId: 'order-nexus',
      order: 100
    }
  ],

  navItems: [
    {
      id: 'orders',
      title: 'Orders',
      path: '/orders',
      order: 50
    }
  ]
};

// MAIN ENTRY POINT
export async function register(host: any) {
  // register module metadata via host if available (optional)
  if (typeof host.registerModule === 'function') {
    try {
      host.registerModule({
        id: descriptor.id,
        name: descriptor.name,
        version: descriptor.version
      });
    } catch (_) {
      // ignore - host may not implement registerModule in some harnesses
    }
  }

  // register routes via host.registerRoute (host is the contract surface)
  if (typeof host.registerRoute === 'function') {
    for (const r of descriptor.routes) {
      host.registerRoute(r);
    }
  } else {
    // fallback: if host doesn't expose registerRoute, try calling a global fallback
    // (keeps compatibility with runtime that exposes registerRoute globally)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const globalRegister: any = (globalThis as any).registerRoute || (globalThis as any).__lasyncro_registerRoute;
    if (typeof globalRegister === 'function') {
      for (const r of descriptor.routes) {
        globalRegister(r);
      }
    }
  }

  // register nav
  for (const n of descriptor.navItems) {
    host.addNavItem(n);
  }

  // lifecycle
  return {
    mount: () => null,
    onMount: async () => {},
    onActivate: async () => {},
    onDeactivate: async () => {},
    onUnmount: async () => {}
  };
}

export default { register };
