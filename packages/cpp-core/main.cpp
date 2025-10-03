#include <napi.h>

// This is the C++ function that will be callable from Node.js
Napi::String Method(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  return Napi::String::New(env, "Hello from the C++ Core!");
}

// This is the addon's registration point, where you export your functions
Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "hello"),
              Napi::Function::New(env, Method));
  return exports;
}

NODE_API_MODULE(sf_core, Init);