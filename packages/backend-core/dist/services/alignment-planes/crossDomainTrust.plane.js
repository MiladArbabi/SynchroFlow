export const crossDomainTrustPlane = {
    planeId: 'cross-domain-trust',
    compute(input) {
        const { visibilities } = input;
        // No signals → cannot assess trust
        if (visibilities.length === 0) {
            return 'unknown';
        }
        // Any null → epistemically unknown
        if (visibilities.some(v => v === null)) {
            return 'unknown';
        }
        const hasSufficient = visibilities.some(v => v === 'sufficient');
        const hasInsufficient = visibilities.some(v => v === 'insufficient');
        // Mixed epistemic states → divergent
        if (hasSufficient && hasInsufficient) {
            return 'divergent';
        }
        // All sufficient → trusted
        if (hasSufficient) {
            return 'aligned';
        }
        // All insufficient → unusable, not contradictory
        return 'unknown';
    }
};
