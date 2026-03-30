#!/bin/zsh

echo "🔍 Checking for raw conflict string usage..."

VIOLATIONS=$(grep -RIn "'DUPLICATE_EVENT'\|'MERGE'\|'IGNORE'\|'RETRY'\|'FAIL'" apps/backend/src | grep -v "conflict.types.ts")

if [[ -z "$VIOLATIONS" ]]; then
  echo "✅ No violations found"
  exit 0
else
  echo "❌ Violations detected:"
  echo "$VIOLATIONS"
  exit 1
fi