#!/usr/bin/env bash

set -e

echo "[RLS CHECK] scanning migrations..."

# SAFETY: ensure migrations directory exists and is not empty
# Resolve migrations directory relative to script location (context-independent)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/../migrations"

echo "[RLS CHECK] resolved MIGRATIONS_DIR=$MIGRATIONS_DIR"

if [ ! -d "$MIGRATIONS_DIR" ] || [ -z "$(ls $MIGRATIONS_DIR/*.ts 2>/dev/null)" ]; then
  echo "❌ RLS CHECK FAILED: migrations directory missing or empty"
  exit 1
fi

# Tables that MUST NOT have RLS (system / global tables)
RLS_EXEMPT_MIGRATIONS=(
  "migrations/20260317181602_0066_migration_checksums.ts"
)

# Step 1: find migrations that create tables
# Detect ONLY migrations that explicitly create tables via knex.schema.createTable
# Avoid false positives from comments, helper code, or non-table migrations
table_migrations=$(grep -lE "knex\.schema\.createTable\(" $MIGRATIONS_DIR/*.ts | grep -v ".d.ts" || true)

# FILTER: exclude migrations explicitly annotated as RLS-exempt at file level
# Rule: annotation must exist INSIDE the migration file (not filename)
filtered_migrations=""
for file in $table_migrations; do
  if grep -q "@rls-exempt" "$file"; then
    echo "[RLS CHECK] skipping (annotated exempt): $file"
  else
    filtered_migrations="$filtered_migrations $file"
  fi
done

table_migrations="$filtered_migrations"

if [ -z "$table_migrations" ]; then
  echo "❌ RLS CHECK FAILED: no createTable migrations found"
  exit 1
fi

violations=$(grep -L "ENABLE ROW LEVEL SECURITY" $table_migrations || true)

# Remove exempt migrations
for exempt in "${RLS_EXEMPT_MIGRATIONS[@]}"; do
  violations=$(echo "$violations" | grep -v "$exempt" || true)
done

# DEBUG: print candidate violations BEFORE enforcement (observability)
echo "[RLS CHECK] candidate violations (pre-exemption filter):"
echo "$violations"

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