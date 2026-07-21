export interface ScanQueueEntry {
    id: string;
    url: string;
    method: string;
    body: string;
    queuedAt: number;
}
export interface UseOfflineScanQueueOptions {
    httpPost: (url: string, body: Record<string, unknown>) => Promise<void>;
}
export interface UseOfflineScanQueueResult {
    isOnline: boolean;
    queuedCount: number;
    submitScan: (params: {
        deviceEventId: string;
        url: string;
        body: Record<string, unknown>;
    }) => Promise<void>;
}
export declare function useOfflineScanQueue({ httpPost, }: UseOfflineScanQueueOptions): UseOfflineScanQueueResult;
//# sourceMappingURL=useOfflineScanQueue.d.ts.map