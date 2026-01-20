/**
 * Visibility Gate
 * ---------------
 * Alignment planes may only execute when
 * ALL required domains are epistemically usable.
 *
 * Any deviation → unknown.
 */
export function visibilityGate(
  visibilities: Array<'sufficient' | 'insufficient' | null>
): boolean {
  return visibilities.every((v) => v === 'sufficient');
}