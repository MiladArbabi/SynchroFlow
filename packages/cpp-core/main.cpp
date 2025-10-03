#include <napi.h>
#include "types.h"
#include <unordered_map>
#include <fstream>
#include <sstream>

static std::unordered_map<std::string, InventoryItem> inventory_cache;

// LoadInventoryData now takes a file path argument
void LoadInventoryData(const Napi::Env& env, const std::string& file_path) {
    inventory_cache.clear(); // Clear any old data
    std::ifstream file(file_path);
    if (!file.is_open()) {
        std::string error_msg = "Failed to open " + file_path;
        Napi::Error::New(env, error_msg).ThrowAsJavaScriptException();
        return;
    }
    std::string line;
    while (std::getline(file, line)) {
        std::stringstream ss(line);
        std::string sku, quantity_str, price_str, location;
        
        std::getline(ss, sku, ',');
        std::getline(ss, quantity_str, ',');
        std::getline(ss, price_str, ',');
        std::getline(ss, location, ',');

        InventoryItem item;
        item.sku = sku;
        item.quantity = std::stoll(quantity_str);
        item.price = std::stod(price_str);
        item.warehouse_location = location;
        inventory_cache[sku] = item;
    }
}

// New exported function to initialize the cache from Node.js
void InitCache(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "String file path expected").ThrowAsJavaScriptException();
        return;
    }
    std::string file_path = info[0].As<Napi::String>().Utf8Value();
    LoadInventoryData(env, file_path);
}

// getInventoryItem remains the same, but no longer loads data
Napi::Object getInventoryItem(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "String SKU expected").ThrowAsJavaScriptException();
    return Napi::Object::New(env);
  }

  std::string sku_from_js = info[0].As<Napi::String>().Utf8Value();
  auto it = inventory_cache.find(sku_from_js);

  InventoryItem item;
  if (it != inventory_cache.end()) {
    item = it->second;
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

// The Init function now exports BOTH functions
Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "initCache"),
              Napi::Function::New(env, InitCache));
  exports.Set(Napi::String::New(env, "getInventoryItem"),
              Napi::Function::New(env, getInventoryItem));
  return exports;
}

NODE_API_MODULE(sf_core, Init);