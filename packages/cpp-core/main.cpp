#include <napi.h>
#include "types.h"

// This is our new business logic function for compliance
double getVatRate(const std::string& countryCode) {
    if (countryCode == "DE") return 0.19; // Germany VAT 19%
    if (countryCode == "SE") return 0.25; // Sweden VAT 25%
    if (countryCode == "US") return 0.07; // Example US Sales Tax 7%
    return 0.0; // Default / No tax
}

// The main N-API method, now updated to accept two arguments
Napi::Object Method(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  // 1. Check if we received the correct number and type of arguments
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::TypeError::New(env, "Two string arguments expected: SKU and countryCode").ThrowAsJavaScriptException();
    return Napi::Object::New(env);
  }

  // 2. Get the arguments passed from Node.js
  std::string sku_from_js = info[0].As<Napi::String>().Utf8Value();
  std::string country_code_from_js = info[1].As<Napi::String>().Utf8Value();

  // 3. Create a C++ struct (simulating a database lookup)
  InventoryItem item;
  if (sku_from_js == "SYN-TS-M-BLUE") {
    item.sku = "SYN-TS-M-BLUE";
    item.quantity = 150;
    item.price = 29.99;
    item.warehouse_location = "Aisle 4, Bay 7";
  } else {
    // Return a 'Not Found' version
    item.sku = sku_from_js;
    item.quantity = 0;
    item.price = 0.0;
    item.warehouse_location = "Not Found";
  }

  // 4. Call our new business logic function
  double vatRate = getVatRate(country_code_from_js);
  double priceWithVat = item.price * (1 + vatRate);

  // 5. Convert to a JavaScript object, now including compliance data
  Napi::Object result = Napi::Object::New(env);
  result.Set("sku", item.sku);
  result.Set("quantity", item.quantity);
  result.Set("basePrice", item.price);
  result.Set("location", item.warehouse_location);
  result.Set("vatRate", vatRate);
  result.Set("priceWithVat", priceWithVat);

  return result;
}

// Init function remains the same
Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "getInventoryItem"),
              Napi::Function::New(env, Method));
  return exports;
}

NODE_API_MODULE(sf_core, Init);