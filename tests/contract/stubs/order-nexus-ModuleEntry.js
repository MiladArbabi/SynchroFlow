// tests/contract/stubs/order-nexus-ModuleEntry.js
// A tiny, in-repo stub that satisfies the contract-harness for local/CI runs.
// It registers a route and a nav item and returns lifecycle hooks.

module.exports = {
  register: async function (host) {
    // register a sample route (host.registerRoute should be a spy in the harness)
    host.registerRoute({
      id: 'orders',
      key: 'orders',
      name: 'Orders',
      path: '/orders',
      component: () => null,
      requiredModuleId: 'order-nexus',
      order: 100
    });

    // register a sample nav item
    host.addNavItem({
      id: 'orders',
      title: 'Orders',
      path: '/orders',
      order: 50
    });

    // return ModuleRegistration
    return {
      mount: () => null,
      onMount: async ({ host: _host } = {}) => {
        // optional initialization
      },
      onActivate: async () => {},
      onDeactivate: async () => {},
      onUnmount: async () => {}
    };
  }
};
