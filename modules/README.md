# Modules folder

+Use `node scripts/scaffold-ui-module.js <module-name>` to create a new UI module scaffold.
Each module must expose `src/descriptor.json` (and optionally a root `descriptor.json`) to satisfy CI validator.
+Run `node scripts/validate-modules.js` locally to validate descriptors.
