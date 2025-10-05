#include <napi.h>
#include <pqxx/pqxx>
#include <iostream>
#include <unordered_map>
#include "types.h"

// The in-memory cache
static std::unordered_map<std::string, InventoryItem> inventory_cache;

// This function now connects to the DB and loads the cache.
void LoadCacheFromDB(const Napi::Env& env) {
    try {
        pqxx::connection conn("user=sf_user password=sf_pass host=localhost port=5432 dbname=synchroflow_db");
        std::cout << "C++ Core: Successfully connected to PostgreSQL." << std::endl;
        std::cout << "C++ Core: Rebuild triggered!" << std::endl;

        inventory_cache.clear();
        pqxx::work txn(conn);
        
        // Execute the query to select all necessary columns
        pqxx::result r = txn.exec(
            "SELECT sku, quantity_available, price, warehouse_location FROM inventory_truth"
        );
        
        // Loop through the database results and populate the C++ cache
        for (auto row : r) {
            InventoryItem item;
            item.sku = row["sku"].as<std::string>();
            item.quantity = row["quantity_available"].as<int64_t>();
            item.price = row["price"].as<double>();
            item.warehouse_location = row["warehouse_location"].as<std::string>();
            
            inventory_cache[item.sku] = item;
        }
        
        txn.commit();
        std::cout << "C++ Core: Loaded " << inventory_cache.size() << " items into the cache." << std::endl;

    } catch (const std::exception &e) {
        Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
    }
}

// getInventoryItem now looks up items from the DB-populated cache
Napi::Object getInventoryItem(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "String SKU expected").ThrowAsJavaScriptException();
    return Napi::Object::New(env);
  }

  std::string sku_from_js = info[0].As<Napi::String>().Utf8Value();
  auto it = inventory_cache.find(sku_from_js);

  Napi::Object result = Napi::Object::New(env);
  if (it != inventory_cache.end()) {
    // Found in cache
    InventoryItem& item = it->second;
    result.Set("sku", item.sku);
    result.Set("quantity", item.quantity);
    result.Set("price", item.price);
    result.Set("location", item.warehouse_location);
  } else {
    // Not found in cache
    result.Set("sku", sku_from_js);
    result.Set("quantity", 0);
    result.Set("price", 0.0);
    result.Set("location", "Not Found");
  }

  return result;
}

// The Init function loads the cache from the DB
Napi::Object Init(Napi::Env env, Napi::Object exports) {
  LoadCacheFromDB(env);
  exports.Set(Napi::String::New(env, "getInventoryItem"),
              Napi::Function::New(env, getInventoryItem));
  return exports;
}

NODE_API_MODULE(sf_core, Init);