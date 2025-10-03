const addon = require('./packages/cpp-core/build/Release/sf_core.node');

console.log("--- Testing C++ Cache Loaded from PostgreSQL ---");

// Test Case 1: SKU that exists in the database
console.log("\nRequesting SKU: SYN-TS-RED-LOGO");
const item1 = addon.getInventoryItem("SYN-TS-RED-LOGO");
console.log("Result from C++ Cache:", item1);

// Test Case 2: SKU that does NOT exist in the database
console.log("\nRequesting SKU: NOT-IN-DB");
const item2 = addon.getInventoryItem("NOT-IN-DB");
console.log("Result from C++ Cache:", item2);