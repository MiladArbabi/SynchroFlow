// ModuleEntry.stub.js - simple CommonJS stub for contract tests
exports.descriptor = {
  id: "customers",
  name: "Customers",
  version: "0.1.0",
  routes: [
    {
      id: "customers-home",
      key: "customers-home",
      name: "Customers Home",
      path: "/customers",
      order: 100
    }
  ],
  navItems: [
    {
      id: "customers-home",
      title: "Customers",
      path: "/customers",
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
