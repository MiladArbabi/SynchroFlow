#!/bin/bash
# install.sh — used by Vercel to install deps without triggering monorepo postinstall
# Installs marketing workspace deps only, then rebuilds native binaries for the target platform

set -e

# Install from repo root without running postinstall scripts
npm install --ignore-scripts

# Rebuild only the native binaries needed by the marketing app
npm rebuild lightningcss --prefix apps/marketing