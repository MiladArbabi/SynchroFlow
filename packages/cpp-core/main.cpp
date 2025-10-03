#include <napi.h>
#include "types.h"
#include <vector> // Required for the loop

Napi::Object Method(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "String expected as first argument").ThrowAsJavaScriptException();
    return Napi::Object::New(env);
  }

  std::string sku_from_js = info[0].As<Napi::String>().Utf8Value();

  // --- START: SIMULATED WORKLOAD ---
  // This loop simulates a heavy computation, like checking against multiple compliance rules
  // or transforming complex data. We'll add numbers to a vector.
  volatile double dummy_sum = 0.0;
  for (int i = 0; i < 1000000; i++) {
    dummy_sum += i * 3.14159;
  }
  // --- END: SIMULATED WORKLOAD ---

  InventoryItem item;
  // The rest of the logic remains the same...
  if (sku_from_js == "SYN-TS-M-BLUE") {
    item.sku = "SYN-TS-M-BLUE";
    item.quantity = 150;
    item.price = 29.99;
    item.warehouse_location = "Aisle 4, Bay 7";
  } else {
    item.sku = sku_from_js;
    item.quantity = 0;
    item.price = 0.0;
    item.warehouse_location = "Not Found";
  }
  
  Napi::Object result = Napi::Object::New(env);
  result.Set("sku", item.sku);
  result.Set("quantity", item.quantity);
  result.Set("price", item.price);
  result.Set("location", item.warehouse_location);

  return result;
}

// ... Init function remains the same ...
Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "getInventoryItem"),
              Napi::Function::New(env, Method));
  return exports;
}

NODE_API_MODULE(sf_core, Init);