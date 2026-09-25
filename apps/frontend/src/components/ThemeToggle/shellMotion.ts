// apps/frontend/src/components/ThemeToggle/shellMotion.ts
//
// GH-1158 — the shell's one motion language: the theme toggle's knob travel and
// sun/moon morph, the Ops Console trigger morph and the Ops Console rail slide
// all move on the same duration and brand out-expo curve.

export const SHELL_MOTION = {
  durationMs: 450,
  easing: 'cubic-bezier(.16,1,.3,1)',
} as const;

/** `transform 450ms cubic-bezier(...)` for one CSS property. */
export const shellTransition = (property: string): string =>
  `${property} ${SHELL_MOTION.durationMs}ms ${SHELL_MOTION.easing}`;

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
