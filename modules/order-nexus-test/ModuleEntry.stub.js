// ModuleEntry.stub.js - simple CommonJS stub for contract tests
exports.descriptor = {
  id: "order-nexus-test",
  name: "OrderNexusTest",
  version: "0.1.0",
  routes: [
    {
      id: "order-nexus-test-home",
      key: "order-nexus-test-home",
      name: "OrderNexusTest Home",
      path: "/order-nexus-test",
      order: 100
    }
  ],
  navItems: [
    {
      id: "order-nexus-test-home",
      title: "OrderNexusTest",
      path: "/order-nexus-test",
      order: 50
    }
  ]
};

exports.register = function (host) {
  // register routes via host if present (harness uses host.registerRoute)
  if (host && typeof host.registerRoute === 'function') {
    (exports.descriptor.routes || []).forEach(r => host.registerRoute(r));
  }
  if (host && typeof host.addNavItem === 'function') {
    (exports.descriptor.navItems || []).forEach(n => host.addNavItem(n));
  }
  return {
    mount: () => null,
    onMount: async () => {},
    onActivate: async () => {},
    onDeactivate: async () => {},
    onUnmount: async () => {}
  };
};
