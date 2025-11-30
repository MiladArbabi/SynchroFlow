"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.opsIntelEmitter = void 0;
//packages/api/src/services/opsIntel/emitter.ts
const events_1 = require("events");
/**
 * A simple, in-memory event bus.
 * The OpsIntelEngine will 'emit' events to this,
 * and the SSE route will 'listen' to this.
 */
class OpsIntelEmitter extends events_1.EventEmitter {
}
// Create a singleton instance to be shared across the app
exports.opsIntelEmitter = new OpsIntelEmitter();
