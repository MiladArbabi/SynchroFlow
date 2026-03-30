#!/usr/bin/env bash

set -e

echo "[RLS CHECK] scanning migrations..."

# SAFETY: ensure migrations directory exists and is not empty
if [ ! -d "migrations" ] || [ -z "$(ls migrations/*.ts 2>/dev/null)" ]; then
  echo "❌ RLS CHECK FAILED: migrations directory missing or empty"
  exit 1
fi

# Tables that MUST NOT have RLS (system / global tables)
RLS_EXEMPT_MIGRATIONS=(
  "migrations/20260317181602_0066_migration_checksums.ts"
)

# Step 1: find migrations that create tables
table_migrations=$(grep -l "createTable" migrations/*.ts | grep -v ".d.ts" || true)

if [ -z "$table_migrations" ]; then
  echo "❌ RLS CHECK FAILED: no createTable migrations found"
  exit 1
fi

violations=$(grep -L "ENABLE ROW LEVEL SECURITY" $table_migrations || true)

# Remove exempt migrations
for exempt in "${RLS_EXEMPT_MIGRATIONS[@]}"; do
  violations=$(echo "$violations" | grep -v "$exempt" || true)
done

echo "[RLS CHECK] table migrations detected:"
echo "$table_migrations"

# SAFETY: force justification for every exemption
if [ ${#RLS_EXEMPT_MIGRATIONS[@]} -gt 0 ]; then
  echo "[RLS CHECK] exemptions:"
  for exempt in "${RLS_EXEMPT_MIGRATIONS[@]}"; do
    echo " - $exempt (REQUIRES justification in rls_invariants.md)"
  done
fi

if [ -n "$violations" ]; then
echo ""
echo "❌ RLS VIOLATION DETECTED"
echo "The following migrations are missing RLS:"
echo ""
echo "$violations"
echo ""
echo "All tables MUST define RLS."
echo "See: apps/backend/docs/rls_invariants.md"
exit 1
fi

echo "✅ RLS CHECK PASSED"