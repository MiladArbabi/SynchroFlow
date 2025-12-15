// ModuleEntry.stub.js - simple CommonJS stub for contract tests
exports.descriptor = {
  id: "analytics",
  name: "Analytics",
  version: "0.1.0",
  routes: [
    {
      id: "analytics-home",
      key: "analytics-home",
      name: "Analytics Home",
      path: "/analytics",
      order: 100
    }
  ],
  navItems: [
    {
      id: "analytics-home",
      title: "Analytics",
      path: "/analytics",
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
