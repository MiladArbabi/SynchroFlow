export type ActivationVerdict = {
    verdict: 'BLOCKED';
    reason: 'NOT_CONNECTED';
} | {
    verdict: 'INTEGRATION_COMPLETE_NOT_READY';
    blockingModules?: string[];
} | {
    verdict: 'ACTIVE';
    activatedModules: string[];
};
//# sourceMappingURL=activation.d.ts.map