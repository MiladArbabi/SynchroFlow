export function useSpecterFt1Scenario(input) {
    const { sessionCount, signalConfidence } = input;
    if (sessionCount === null) {
        return 'LOADING';
    }
    if (sessionCount === 0) {
        return 'NO_SESSIONS';
    }
    if (signalConfidence === null) {
        return 'LOW_SIGNAL';
    }
    return 'HEALTHY';
}
//# sourceMappingURL=useSpecterFt1Scenario.js.map