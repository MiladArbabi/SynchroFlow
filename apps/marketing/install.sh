#!/bin/bash
# install.sh — Vercel install script for apps/marketing
# Vercel sets working directory to apps/marketing (root directory setting)
# We navigate to monorepo root, install without postinstall, then rebuild native binaries

set -e

# Vercel working directory is apps/marketing — go to monorepo root
MONOREPO_ROOT="$(cd ../.. && pwd)"

echo "Monorepo root: $MONOREPO_ROOT"

# Install all deps without triggering monorepo postinstall
npm install --ignore-scripts --prefix "$MONOREPO_ROOT"

# Rebuild lightningcss for the current platform inside node_modules at monorepo root
npm rebuild lightningcss --prefix "$MONOREPO_ROOT"