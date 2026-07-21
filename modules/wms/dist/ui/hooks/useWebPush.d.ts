export interface UseWebPushOptions {
    /** Injected HTTP post — keeps hook decoupled from axios */
    httpPost: (url: string, body: Record<string, unknown>) => Promise<void>;
    enabled?: boolean;
}
export declare function useWebPush({ httpPost, enabled }: UseWebPushOptions): void;
//# sourceMappingURL=useWebPush.d.ts.map