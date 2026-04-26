// Declares import.meta.env for Vite-bundled modules.
// This module is built with tsc standalone but consumed via Vite —
// declare the minimal interface needed to satisfy TypeScript.
interface ImportMeta {
  readonly env: Record<string, string | undefined>;
}