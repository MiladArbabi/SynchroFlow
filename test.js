const addon = require('./packages/cpp-core/build/Release/sf_core.node');

console.log("--- Validating C++ Core Latency ---");

console.time("C++ Call Latency"); // Start the timer

const item = addon.getInventoryItem("SYN-TS-M-BLUE");

console.timeEnd("C++ Call Latency"); // Stop the timer and print the duration

console.log("\nReceived item:", item);