#!/bin/sh

# Set the required environment variable for pkg-config to find libpq
export PKG_CONFIG_PATH="$(brew --prefix libpq)/lib/pkgconfig"

# Run the standard node-gyp commands
node-gyp configure
node-gyp build