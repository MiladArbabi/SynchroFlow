{
  "targets": [
    {
      "target_name": "sf_core",
      "sources": [ "main.cpp" ],
      "include_dirs": [
        "node_modules/node-addon-api"
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "MACOSX_DEPLOYMENT_TARGET": "10.15"
      }
    }
  ]
}