//packages/api/src/services/opsIntel/emitter.ts
import { EventEmitter } from 'events';

/**
 * A simple, in-memory event bus.
 * The OpsIntelEngine will 'emit' events to this,
 * and the SSE route will 'listen' to this.
 */
class OpsIntelEmitter extends EventEmitter {}

// Create a singleton instance to be shared across the app
export const opsIntelEmitter = new OpsIntelEmitter();