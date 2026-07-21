import type { SpecterFt1Scenario } from '../types.js';
interface SpecterFt1Input {
    sessionCount: number | null;
    signalConfidence: number | null;
}
export declare function useSpecterFt1Scenario(input: SpecterFt1Input): SpecterFt1Scenario;
export {};
