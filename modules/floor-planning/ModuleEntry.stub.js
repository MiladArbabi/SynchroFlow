// ModuleEntry.stub.js – FT0 contract stub

exports.default = {
  id: 'floor-planning',
  name: 'FloorPlanning',
  version: '0.1.0',

  navItems: [
    {
      id: 'floor-planning',
      title: 'FloorPlanning',
      path: '/floor-planning',
      group: 'operations',
      order: 20,
      requiredModuleId: 'floor-planning'
    }
  ],

  routes: [
    {
      id: 'floor-planning',
      path: '/floor-planning',
      requiredModuleId: 'floor-planning',
      order: 100
    }
  ]
};
