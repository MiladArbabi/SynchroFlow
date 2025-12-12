import React from 'react';

/* Minimal ModuleEntry required by the loader.
   Keep this in module src/ui so the Vite plugin finds it.
*/
const DummyPage = () => <div style={{padding:20}}>My Test Module</div>;

const descriptor = {
  id: 'my-test-module',
  name: 'my-test-module',
  version: '0.0.0',
  routes: [
    { id: 'my-test-home', key: 'my-test-home', name: 'My Test', path: '/my-test', component: DummyPage, order: 100 }
  ],
  navItems: [{ id: 'my-test', title: 'My Test', path: '/my-test', order: 999 }]
};

// Descriptor already contains `id` — export it directly to avoid duplicate-id
// object-literals (and satisfy the checker).
export default descriptor;
