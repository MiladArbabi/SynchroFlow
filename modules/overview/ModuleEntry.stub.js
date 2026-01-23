exports.default = {
  id: 'overview',
  name: 'Overview',
  version: '0.1.0',

  navItems: [
    {
      id: 'overview',
      title: 'Overview',
      path: '/overview',
      group: 'operations',
      order: 20,
      requiredModuleId: 'overview'
    }
  ],

  routes: [
    {
      id: 'overview',
      path: '/overview',
      requiredModuleId: 'overview',
      order: 20
    }
  ]
};