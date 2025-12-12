# 11-UI-Module-Scaffolding-CLI.md

**LaSyncro — UI Module Scaffolding CLI**

**Version:** 1.0

**Status:** Draft — ready for implementation

**Purpose**

Provide a deterministic, auditable, and repeatable CLI to create new UI modules that fully comply with LaSyncro's Module Folder Structure Guide (docs/ui/10-UI-Module-Folder-Structure-Guide.md). The CLI should create files, populate initial boilerplate, wire up TypeScript configs, add CI-friendly test stubs, and optionally register a stub ModuleEntry for local development and contract-test workflow.

---

## Table of contents

1. Goals and constraints
2. Installation
3. CLI commands & flags (full reference)
4. Generated layout (exact file tree)
5. File templates (high-level contents)
6. TypeScript, build & lint integration
7. Contract-test integration & fixture generation
8. Best-practice options (presets)
9. Post-generation checklist and validation command
10. Implementation notes for maintainers
11. Example usage scenarios
12. Security & repository hygiene

---

## 1. Goals and constraints

* **Deterministic:** Running the CLI with the same inputs produces the same files/content.
* **Safe:** The CLI must never overwrite existing module folders unless `--force` is provided.
* **CI-friendly:** Includes contract test stub generators and `tsconfig` tuned for isolated build.
* **Easy to extend:** Add new presets, templates and hooks.
* **Repo-consistent:** Use monorepo root `tsconfig.json` paths and existing lint/prettier configs.

---

## 2. Installation

Two usage forms: (A) Local dev script (preferred for contributors) and (B) global npm package (for automation).

### A — Local (dev) usage

Add a script to `package.json` at repo root (if not present):

```json
"scripts": {
  "scaffold:ui-module": "node ./scripts/scaffold-ui-module.js"
}
```

Run:

```bash
# interactive
npm run scaffold:ui-module -- --interactive

# non-interactive
npm run scaffold:ui-module -- --name order-nexus --preset standard --module-id order-nexus
```

### B — Global install (optional)

Publish a small package `@lasyncro/scaffold-ui-module` and install globally:

```bash
npm i -g @lasyncro/scaffold-ui-module
lasyncro-scaffold-ui --name order-nexus --preset standard
```

---

## 3. CLI commands & flags (full reference)

```
Usage: lasyncro-scaffold-ui [options]

Options:
  -n, --name <name>             Human-friendly display name (e.g. "Order Nexus")
  -i, --module-id <id>          Module folder name / canonical id (kebab-case) (required)
  -p, --preset <preset>         Preset: minimal|standard|advanced  (default: standard)
  -t, --template <template>     Base template: react|react-ts|vue (default: react-ts)
  -f, --force                   Overwrite existing module folder
  --no-install                  Don't run `npm install` inside module
  --stub-contract               Create contract fixture in `tests/fixtures/stubs/`
  --git-commit                  Run `git add` + `git commit -m "feat: scaffold <id>"`
  --skip-lint                   Don't add lint config files
  -h, --help                    Display help
```

**Notes**

* `module-id` is the authoritative name used across ModuleDescriptor `id` and folder name.
* The CLI must validate `module-id` to match regex `^[a-z0-9]+(?:-[a-z0-9]+)*$`.

---

## 4. Generated layout (exact file tree)

When run with `--preset standard` (recommended), the CLI generates the following under `modules/<module-id>`:

```
modules/<module-id>/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── ModuleEntry.ts               # REQUIRED
│   ├── index.ts                     # re-export ModuleEntry
│   ├── lifecycle.ts                 # optional lifecycle hooks
│   ├── routes/
│   │   └── index.ts                 # RouteDescriptor[]
│   ├── navigation/
│   │   └── index.ts                 # NavigationItem[]
│   ├── ui/
│   │   ├── pages/
│   │   │   └── HomePage.tsx
│   │   └── components/
│   │       └── HelloModule.tsx
│   ├── api/
│   │   └── client.ts
│   ├── state/
│   │   └── index.ts
│   ├── domain/
│   │   └── types.ts
│   └── assets/
│       ├── icon.svg
│       └── locales/en.json
└── __tests__/ (optional, developer only)
```

If `--preset minimal` the CLI only creates `ModuleEntry.ts`, `routes/index.ts`, `navigation/index.ts`, `tsconfig.json`, and `package.json`.

---

## 5. File templates (high-level contents)

Below are the canonical contents (sanitized, short) for critical files. The exact templates should be part of the repo under `scripts/templates/ui-module/`.

### 5.1 `package.json` (module)

```json
{
  "name": "@lasyncro/module-<module-id>",
  "version": "0.0.0-dev",
  "main": "dist/ModuleEntry.js",
  "types": "dist/ModuleEntry.d.ts",
  "scripts": {
    "build": "tsc -p ./tsconfig.json",
    "test": "echo 'module-local tests are dev-only' && exit 0"
  },
  "dependencies": {}
}
```

### 5.2 `tsconfig.json`

(extends root `tsconfig.json`)

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "module": "ESNext",
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"]
}
```

### 5.3 `src/ModuleEntry.ts` (minimal canonical export)

```ts
import { ModuleDescriptor } from '@lasyncro/shared'; // optional shared types
import routes from './routes';
import navigation from './navigation';

const id = '<module-id>'; // replaced by CLI

export const ModuleDescriptor: ModuleDescriptor = {
  id,
  version: '0.0.0-dev',
  routes,
  navigation
};

export default ModuleDescriptor;
```

### 5.4 `src/routes/index.ts`

```ts
import HomePage from '../ui/pages/HomePage';

export default [
  {
    id: '<module-id>.home',
    path: '/<module-id>',
    component: HomePage,
    order: 100
  }
];
```

### 5.5 `src/navigation/index.ts`

```ts
export default [
  {
    id: '<module-id>.main',
    label: 'Module Friendly Name',
    path: '/<module-id>',
    order: 200
  }
];
```

### 5.6 `src/lifecycle.ts` (recommended)

```ts
export async function onLoad() {
  // warm cache, register local handlers, etc
}
export async function onUnload() {
  // cleanup
}
```

---

## 6. TypeScript, build & lint integration

* Generated `tsconfig.json` extends the monorepo root config to preserve path aliases.
* `package.json` script `build` runs `tsc -p tsconfig.json` producing `dist/ModuleEntry.js` and `.d.ts` files. CI should run `npm --workspace ./modules/<id> run build` as part of module promotion.
* Linting: if repository has ESLint config, the CLI will optionally copy `.eslintrc.js` or a module-specific override if `--skip-lint` is not set.
* Prettier: copy `.prettierrc` if present.

---

## 7. Contract-test integration & fixture generation

The CLI optionally generates a contract fixture when `--stub-contract` is provided.

Generated fixture path:

```
tests/fixtures/stubs/<module-id>-ModuleEntry.js
```

This JS stub exports a minimal `register`/`ModuleDescriptor` object that the existing contract harness can import when the real compiled module is not available during local dev.

**Contract harness expectation**

* The harness will attempt to resolve `process.env.CONTRACT_MODULE_<MODULE_ID_PREFIX>` environment variable mapping to compiled artifact. If not present, it will fall back to `tests/fixtures/stubs`.

The CLI will also optionally append the contract test skeleton into `tests/contract/<module-id>.contract.test.ts` (if the repo owner wants auto-creation), otherwise it prints a helpful message and commands to add the contract test.

---

## 8. Best-practice options (presets)

**minimal** — `ModuleEntry`, routes, navigation, tsconfig, package.json. Good for PoC or very small experience.

**standard** — minimal + pages, components, API client, lifecycle hooks, assets, translations, contract stub.

**advanced** — standard + sample state, queries (RTK Query/React Query), unit-test skeletons, storybook stories, pre-commit hooks, CI job template snippet.

---

## 9. Post-generation checklist and validation command

After scaffolding, run a single validation script to assert minimal compliance:

```bash
# run this from repo root
node ./scripts/validate-module.js --path modules/<module-id>
```

Validation checks:

* `ModuleEntry.ts` exists and exports `id` matching folder name
* `src/routes/index.ts` exports array of routes and at least one route path beginning with `/`
* `src/navigation/index.ts` exports array with at least one item
* `tsconfig.json` builds cleanly (`tsc -p modules/<module-id>/tsconfig.json`)
* contract fixture exists in `tests/fixtures/stubs` if `--stub-contract` used

The CLI should run `validate-module` automatically unless `--no-validate` passed.

---

## 10. Implementation notes for maintainers (how to implement the CLI)

### 10.1 Language & runtime

* Recommended: Node.js 18+ using `ts-node` for dev or compile straightforward to JS.
* Use `enquirer` or `inquirer` for interactive prompts.

### 10.2 Template location

* Keep template files under `scripts/templates/ui-module/`
* Template tokens must be replaced using a small templating engine (e.g., mustache or simple token replace).

### 10.3 Idempotency & safety

* If target folder exists and is non-empty, refuse to proceed unless `--force`.
* Always print a final `diff` (files created) and ask to confirm commit.

### 10.4 Git integration

* Use `simple-git` library to stage and commit changes if `--git-commit` is used.
* Commit message pattern: `feat(ui-module): scaffold <module-id>`

### 10.5 Unit tests for the CLI

* Add tests under `tests/scripts/scaffold-cli.test.ts` using a temporary directory (use `tempy`) to ensure deterministic output.

---

## 11. Example usage scenarios

### 11.1 Create a standard module interactively

```bash
npm run scaffold:ui-module -- --interactive
# follow prompts: name -> order-nexus, module-id -> order-nexus, preset -> standard
```

### 11.2 Create minimal module non-interactively

```bash
npm run scaffold:ui-module -- --module-id sku-os --preset minimal --stub-contract --git-commit
```

### 11.3 Generate stub fixture only (for contract tests)

```bash
npm run scaffold:ui-module -- --module-id specter --preset minimal --stub-contract --no-install --skip-lint
```

---

## 12. Security & repository hygiene

* The CLI must never run remote code downloads during scaffolding.
* Generated files must be deterministic and offline-first.
* Avoid embedding secrets in generated `package.json`.
* If `--git-commit` is used, the CLI should only commit created files and must not auto-stage unrelated files.

---

## 13. Troubleshooting & FAQ

**Q:** My generated ModuleEntry fails contract harness because of missing compiled files.
**A:** Use `--stub-contract` to create a fixture. CI must run `npm --workspace ./modules/<id> run build` prior to contract tests for release pipelines.

**Q:** How do I change the tsconfig baseUrl for modules?
**A:** Module tsconfig must `extends` root `tsconfig.json`. For local dev, ensure the root `tsconfig.json` maps `runtime/*` and other aliases.

---

## 14. Changelog & Versioning

* 1.0 — initial design and templates
* Future versions should bump when module entry contract changes (ModuleDescriptor shape changes)

---

## 15. Next steps (for maintainers)

1. Add template files under `scripts/templates/ui-module/`.
2. Implement CLI script `scripts/scaffold-ui-module.js`.
3. Add `scaffold:ui-module` npm script at repo root.
4. Add unit tests for CLI behavior under `tests/scripts/`.
5. Document usage in the contributor onboarding doc and add to developer handbook.

---

*End of 11-UI-Module-Scaffolding-CLI.md*
