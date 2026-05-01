#!/bin/bash
# install.sh — Vercel install script for apps/marketing
# Full install from monorepo root with scripts enabled but only for lightningcss

set -e

MONOREPO_ROOT="$(cd ../.. && pwd)"
echo "Monorepo root: $MONOREPO_ROOT"

# Full install from monorepo root — but override postinstall to be a no-op
npm install --prefix "$MONOREPO_ROOT" --ignore-scripts

# Explicitly install the linux-x64 lightningcss binary
npm install --prefix "$MONOREPO_ROOT" \
  lightningcss-linux-x64-gnu \
  --no-save \
  --ignore-scripts