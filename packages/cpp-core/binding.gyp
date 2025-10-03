{
  "targets": [
    {
      "target_name": "sf_core",
      "sources": [ "main.cpp" ],
      "include_dirs": [
        "node_modules/node-addon-api",
        "src",
        "<!(pkg-config --cflags-only-I libpqxx | sed 's/-I//g')"
      ],
      "libraries": [
        "<!(pkg-config --libs libpqxx)"
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions", "-fno-rtti" ],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "GCC_ENABLE_CPP_RTTI": "YES",
        "MACOSX_DEPLOYMENT_TARGET": "10.15"
      }
    }
  ]
}