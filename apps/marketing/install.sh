#!/bin/bash
# install.sh — Vercel install script for apps/marketing
# Runs from apps/marketing as working directory (Vercel root directory setting)
# Installs all deps from monorepo root without triggering postinstall, then rebuilds native binaries

set -e

# Navigate to monorepo root (two levels up from apps/marketing)
cd ../..

# Install without postinstall scripts
npm install --ignore-scripts

# Rebuild lightningcss native binary for the current platform (Linux on Vercel)
npm rebuild lightningcss