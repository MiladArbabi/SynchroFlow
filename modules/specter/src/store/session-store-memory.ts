// modules/specter/src/store/session-store-memory.ts
// In-memory session + event store used for unit tests / local runs.
// Uses Node's native crypto.randomUUID() instead of uuid package.

import { randomUUID } from 'crypto';

export type SessionState = Record<string, any>;
export type EventRecord = { id: string; type: string; payload?: any; timestamp: string };

export interface ISpecterStore {
  // Session CRUD
  setSession(shopId: string, sessionState: SessionState): Promise<void>;
  getSession(shopId: string): Promise<SessionState | null>;
  patchSession(shopId: string, delta: Partial<SessionState>): Promise<SessionState>;
  deleteSession(shopId: string): Promise<void>;

  // Events
  appendEvent(shopId: string, event: Omit<EventRecord, 'id' | 'timestamp'>): Promise<EventRecord>;
  getRecentEvents(shopId: string, limit?: number): Promise<EventRecord[]>;
  close?(): Promise<void>;
}

const sessions: Record<string, SessionState> = {};
const events: Record<string, EventRecord[]> = {};

export function createInMemorySpecterStore(): ISpecterStore {
  return {
    async setSession(shopId: string, sessionState: SessionState) {
      sessions[shopId] = JSON.parse(JSON.stringify(sessionState));
    },

    async getSession(shopId: string) {
      const s = sessions[shopId];
      return s ? JSON.parse(JSON.stringify(s)) : null;
    },

    async patchSession(shopId: string, delta: Partial<SessionState>) {
      const current = sessions[shopId] || {};
      const merged = { ...current, ...delta };
      sessions[shopId] = JSON.parse(JSON.stringify(merged));
      return JSON.parse(JSON.stringify(sessions[shopId]));
    },

    async deleteSession(shopId: string) {
      delete sessions[shopId];
    },

    async appendEvent(shopId: string, event) {
      const ev: EventRecord = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: event.type,
        payload: event.payload ?? null,
      };
      events[shopId] = events[shopId] || [];
      // newest-first semantics (like LPUSH)
      events[shopId].unshift(ev);
      // trim to a sane limit to avoid unbounded growth in tests
      if (events[shopId].length > 500) events[shopId].length = 500;
      return ev;
    },

    async getRecentEvents(shopId: string, limit = 50) {
      const list = events[shopId] || [];
      return list.slice(0, limit).map(e => ({ ...e }));
    },

    async close() {
      // no-op for in-memory
      return;
    },
  };
}