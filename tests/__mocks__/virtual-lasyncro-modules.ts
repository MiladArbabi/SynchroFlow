// Deterministic mock for Vite virtual module
// Used only in tests

const modules = [
  {
    id: 'order-nexus',
    load: async () => ({
      default: {
        id: 'order-nexus',
        name: 'OrderNexus',
        routes: [],
        navItems: [],
      }
    })
  }
];

export default modules;