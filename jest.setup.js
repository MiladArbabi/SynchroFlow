// jest.setup.js
//
// RETIRED — TEST-INFRA-FOUNDATION Slice 1B.
//
// This file is no longer referenced by jest.config.js. Its contents were
// split into:
//   tests/setup/jest.shared.js  (loaded by both of the below)
//   tests/setup/jest.node.js    (backend-legacy, backend-integration, contract)
//   tests/setup/jest.ui.js      (frontend)
//
// A repository-wide search (jest.config.js, package.json, CI workflows, all
// *.js/*.ts/*.json/*.yml/*.yaml/*.md outside node_modules/dist) found no
// remaining functional reference to this file as of Slice 1B. It is kept
// in place, deliberately empty of setup logic, rather than deleted, so that
// if something is later found to still require() it, that failure is loud
// (module simply exports nothing) instead of silently reinstating a second,
// competing setup authority.
//
// Do not add logic here. See tests/setup/jest.shared.js, jest.node.js, and
// jest.ui.js instead.
