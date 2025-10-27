#include <napi.h>
#include <pqxx/pqxx>
#include <iostream>
#include <unordered_map>
#include <cstdint>
#include "types.h"

// The in-memory cache
static std::unordered_map<std::string, InventoryItem> inventory_cache;

// This function now connects to the DB and loads the cache.
void ReloadCacheSync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
    try {
        pqxx::connection conn("user=sf_user password=sf_pass host=localhost port=5432 dbname=synchroflow_db");
        std::cout << "C++ Core: Successfully connected to PostgreSQL." << std::endl;

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
            if (!row["quantity_available"].is_null()) item.quantity = row["quantity_available"].as<int64_t>();
            if (!row["price"].is_null()) item.price = row["price"].as<double>();
            if (!row["warehouse_location"].is_null()) item.warehouse_location = row["warehouse_location"].as<std::string>();
            
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

// --- FUNCTION for Order Status ---
Napi::Object getOrderStatus(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) { /* ... error handling ... */ }
    std::string orderId = info[0].As<Napi::String>().Utf8Value();

    Napi::Object result = Napi::Object::New(env);
    result.Set("orderId", orderId);
    std::string status = "Unknown";

    try {
        // --- ADD LOGGING ---
        std::cout << "[C++ LOG] Connecting to DB for order_id: " << orderId << std::endl;
        pqxx::connection conn("user=sf_user password=sf_pass host=localhost port=5432 dbname=synchroflow_db");
        std::cout << "[C++ LOG] Connected. Starting transaction." << std::endl;
        pqxx::work txn(conn); // Start transaction

        std::cout << "[C++ LOG] Executing query: SELECT status FROM order_fulfillment_status WHERE order_id = '" << orderId << "'" << std::endl;

        // Execute the query
        pqxx::result r = txn.exec_params(
            "SELECT status FROM public.order_fulfillment_status WHERE order_id = $1",
            orderId);

        // --- ADD LOGGING ---
        std::cout << "[C++ LOG] Query executed. Result size: " << r.size() << std::endl;

        // Commit is not strictly needed for SELECT, but harmless
        txn.commit();
        std::cout << "[C++ LOG] Transaction committed." << std::endl;

        // Process result
        if (!r.empty()) { // Check if result set is not empty
            status = r[0]["status"].as<std::string>("StatusColumnNull"); // Use a different default if status itself is NULL
            std::cout << "[C++ LOG] Found status: " << status << std::endl;
        } else {
            status = "NotFound"; // No rows returned
            std::cout << "[C++ LOG] No rows found for order_id: " << orderId << std::endl;
        }

    } catch (const std::exception &e) {
        std::cerr << "[C++ ERROR] Database exception: " << e.what() << std::endl; // Use cerr for errors
        Napi::Error::New(env, "Database error fetching order status: " + std::string(e.what())).ThrowAsJavaScriptException();
        return Napi::Object::New(env);
    }

    result.Set("status", status);
    return result;
}

// The Init function loads the cache from the DB
Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "getInventoryItem"),
              Napi::Function::New(env, getInventoryItem));
  exports.Set(Napi::String::New(env, "reloadCacheSync"),
              Napi::Function::New(env, ReloadCacheSync));
  exports.Set(Napi::String::New(env, "getOrderStatus"),
                Napi::Function::New(env, getOrderStatus));
  return exports;
}

NODE_API_MODULE(sf_core, Init);