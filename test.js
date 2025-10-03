const path = require('path');
const addon = require('./packages/cpp-core/build/Release/sf_core.node');

// Construct the absolute path to the data file
const dataFilePath = path.join(__dirname, 'packages/cpp-core/data/inventory.csv');

// Initialize the C++ cache with the correct file path
console.log(`Initializing C++ cache with data from: ${dataFilePath}`);
addon.initCache(dataFilePath);

console.log("\n--- Testing C++ In-Memory Cache ---");

// Test Case 1: SKU that exists in inventory.csv
console.log("\nRequesting SKU: SYN-TS-RED-LOGO");
const item1 = addon.getInventoryItem("SYN-TS-RED-LOGO");
console.log("Result from C++ Cache:", item1);

// Test Case 2: SKU that does NOT exist in inventory.csv
console.log("\nRequesting SKU: NOT-IN-CSV");
const item2 = addon.getInventoryItem("NOT-IN-CSV");
console.log("Result from C++ Cache:", item2);