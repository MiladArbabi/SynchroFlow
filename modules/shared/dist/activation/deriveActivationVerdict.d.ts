import { IdentitySnapshot, IntegrationSnapshot, EntitlementSnapshot, ActivationVerdict } from './types.js';
export declare function deriveActivationVerdict(input: {
    identity: IdentitySnapshot;
    integrations: IntegrationSnapshot[];
    entitlements: EntitlementSnapshot[];
}): ActivationVerdict;
//# sourceMappingURL=deriveActivationVerdict.d.ts.map