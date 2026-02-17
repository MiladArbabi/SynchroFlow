/**
 * Visibility Gate
 * ---------------
 * Alignment planes may only execute when
 * ALL required domains are epistemically usable.
 *
 * Any deviation → unknown.
 */
export function visibilityGate(visibilities) {
    return visibilities.every((v) => v === 'sufficient');
}
