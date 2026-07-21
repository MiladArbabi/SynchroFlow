export type SessionState = Record<string, any>;
export type EventRecord = {
    id: string;
    type: string;
    payload?: any;
    timestamp: string;
};
export interface ISpecterStore {
    setSession(shopId: string, sessionState: SessionState): Promise<void>;
    getSession(shopId: string): Promise<SessionState | null>;
    patchSession(shopId: string, delta: Partial<SessionState>): Promise<SessionState>;
    deleteSession(shopId: string): Promise<void>;
    appendEvent(shopId: string, event: Omit<EventRecord, 'id' | 'timestamp'>): Promise<EventRecord>;
    getRecentEvents(shopId: string, limit?: number): Promise<EventRecord[]>;
    close?(): Promise<void>;
}
export declare function createInMemorySpecterStore(): ISpecterStore;
