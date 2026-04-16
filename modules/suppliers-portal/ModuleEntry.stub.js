// ModuleEntry.stub.js – FT0 contract stub

exports.default = {
  id: 'suppliers-portal',
  name: 'SuppliersPortal',
  version: '0.1.0',

  navItems: [
    {
      id: 'suppliers-portal',
      title: 'SuppliersPortal',
      path: '/suppliers-portal',
      group: 'operations',
      order: 20,
      requiredModuleId: 'suppliers-portal'
    }
  ],

  routes: [
    {
      id: 'suppliers-portal',
      path: '/suppliers-portal',
      requiredModuleId: 'suppliers-portal',
      order: 100
    }
  ]
};
