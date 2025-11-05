//packages/api/src/services/opsIntel/index.ts

import { ProactiveInsight } from "./types";
import { opsIntelEmitter } from "./emitter";
/**
 * A BusinessRule defines a single piece of proactive logic.
 * - 'schedule' is a simple cron-like check (e.g., 'every 1 minute').
 * - 'execute' performs the check and returns an insight or null.
 */
export interface BusinessRule {
  id: string;
  schedule: string; // For this MVP, we'll just support 'every X seconds'
  execute: () => Promise<ProactiveInsight | null>;
}

// Simple map for our MVP scheduler
const SCHEDULE_MAP: { [key: string]: number } = {
  '* * * * *': 60 * 1000, // Every 1 minute
  '*/5 * * * *': 5 * 60 * 1000, // Every 5 minutes
};

/**
 * The OpsIntelEngine is the "radar system."
 * It runs in the background, executing registered BusinessRules
 * on a set schedule to find actionable insights for the user.
 */
export class OpsIntelEngine {
  private rules: BusinessRule[] = [];
  private timers: NodeJS.Timeout[] = [];
  private isRunning = false;

  constructor() {
    console.log('[OpsIntelEngine] Initialized.');
  }

  /**
   * Registers a new rule to be checked by the engine.
   */
  public registerRule(rule: BusinessRule) {
    console.log(`[OpsIntelEngine] Registering rule: ${rule.id}`);
    this.rules.push(rule);
  }

  /**
   * Starts the engine.
   * It sets up an interval for each registered rule.
   */
  public start() {
    if (this.isRunning) return;
    console.log('[OpsIntelEngine] Starting...');

    this.isRunning = true;
    
    // Set up a timer for each rule
    for (const rule of this.rules) {
      const intervalMs = SCHEDULE_MAP[rule.schedule];
      
      if (!intervalMs) {
        console.warn(`[OpsIntelEngine] Invalid schedule for rule: ${rule.id}. Skipping.`);
        continue;
      }

      // We use setInterval, which our test is mocking
      const timer = setInterval(async () => {
        if (!this.isRunning) return;
        
        console.log(`[OpsIntelEngine] Executing rule: ${rule.id}`);
        const insight = await rule.execute();
        
        if (insight) {
          // In the next issues, we will push this insight
          // to the SSE stream ("Kore Comlink")
          // --- USE THE EMITTER ---
          opsIntelEmitter.emit('insight', insight);
        }
      }, intervalMs);

      this.timers.push(timer);
    }
  }

  /**
   * Stops the engine and clears all scheduled timers.
   */
  public stop() {
    if (!this.isRunning) return;
    console.log('[OpsIntelEngine] Stopping...');

    this.isRunning = false;
    // Clear all active timers
    this.timers.forEach(timer => clearInterval(timer));
    this.timers = [];
  }
}