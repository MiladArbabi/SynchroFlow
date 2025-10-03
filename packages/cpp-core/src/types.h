// In packages/cpp-core/src/types.h
#pragma once 
#include <string>
#include <cstdint>

struct InventoryItem {
    std::string sku;
    int64_t quantity;
    double price;
    std::string warehouse_location;
};