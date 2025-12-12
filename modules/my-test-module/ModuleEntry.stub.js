// ModuleEntry.stub.js - simple CommonJS stub for contract tests
exports.descriptor = {
  id: "my-test-module",
  name: "MyTestModule",
  version: "0.1.0",
  routes: [
    {
      id: "my-test-module-home",
      key: "my-test-module-home",
      name: "MyTestModule Home",
      path: "/my-test-module",
      order: 100
    }
  ],
  navItems: [
    {
      id: "my-test-module-home",
      title: "MyTestModule",
      path: "/my-test-module",
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
