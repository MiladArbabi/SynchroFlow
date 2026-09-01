import { useEffect, useRef, useState } from 'react';

/**
 * useDisplayProgress
 * --------------------------------------------------
 * EXPERIENCE / DISPLAY projection of onboarding progress.
 *
 * This is NOT a lifecycle authority. It never drives sync completion and it is
 * never read back by the sync / story / experience-buffer clocks. It only
 * decides what the progress bar *shows* so the bar visibly builds through the
 * seven-scene film instead of snapping to 100% the instant the real Shopify
 * sync finishes.
 *
 * Contract:
 * - monotonic (never moves backwards);
 * - stays <= DISPLAY_PROGRESS_CEILING (95) until completion is eligible
 *   (real sync complete AND the first-run dwell/resolve contract permits exit);
 * - only then smoothly finishes to 100.
 */

export const DISPLAY_PROGRESS_INITIAL = 8;
export const DISPLAY_PROGRESS_CEILING = 95;
export const DISPLAY_PROGRESS_COMPLETE = 100;

/** Scene-aligned DISPLAY targets (not sync percentages). */
export const DISPLAY_PROGRESS_SCENE_TARGETS: Record<string, number> = {
  SCENE_1: 30,
  SCENE_2: 60,
  SCENE_3: 82,
  SCENE_4: 88,
  SCENE_5: 91,
  SCENE_6: 93,
  SCENE_7: 95,
};

export const DISPLAY_PROGRESS_AMBIENT = 95;

/** Ramp duration between two scene targets (skipped under reduced motion). */
export const DISPLAY_PROGRESS_RAMP_MS = 650;

export interface DisplayProgressInput {
  storyState: string;
  isAmbient: boolean;
  interrupted: boolean;
  completionEligible: boolean;
}

/**
 * Pure DISPLAY target for the current story/completion state. Callers combine
 * this with the previous displayed value to keep the projection monotonic.
 */
export function computeDisplayProgressTarget(input: DisplayProgressInput): number {
  if (input.completionEligible) return DISPLAY_PROGRESS_COMPLETE;
  if (input.interrupted) return DISPLAY_PROGRESS_INITIAL;
  if (input.isAmbient || input.storyState === 'AMBIENT') return DISPLAY_PROGRESS_AMBIENT;
  const sceneTarget = DISPLAY_PROGRESS_SCENE_TARGETS[input.storyState];
  return typeof sceneTarget === 'number' ? sceneTarget : DISPLAY_PROGRESS_INITIAL;
}

/**
 * Pure monotonic resolver: never below `previous`, never above the ceiling
 * unless completion is eligible.
 */
export function resolveMonotonicDisplayProgress(
  previous: number,
  target: number,
  completionEligible: boolean
): number {
  const ceiling = completionEligible ? DISPLAY_PROGRESS_COMPLETE : DISPLAY_PROGRESS_CEILING;
  return Math.max(previous, Math.min(target, ceiling));
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

export interface UseDisplayProgressOptions extends DisplayProgressInput {
  reducedMotion: boolean;
}

/**
 * Stateful DISPLAY value. Advances toward the scene-aligned target with a short
 * eased ramp (single rAF loop, no timer farm). Reduced motion steps directly to
 * the target. Always monotonic, always clamped below 100 until eligible.
 */
export function useDisplayProgress(options: UseDisplayProgressOptions): number {
  const target = computeDisplayProgressTarget(options);
  const ceiling = options.completionEligible
    ? DISPLAY_PROGRESS_COMPLETE
    : DISPLAY_PROGRESS_CEILING;
  const clampedTarget = Math.min(target, ceiling);

  const [value, setValue] = useState(() =>
    Math.max(DISPLAY_PROGRESS_INITIAL, Math.min(clampedTarget, DISPLAY_PROGRESS_INITIAL))
  );
  const valueRef = useRef(value);
  valueRef.current = value;
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (valueRef.current >= clampedTarget) return;

    if (options.reducedMotion || typeof requestAnimationFrame !== 'function') {
      setValue((prev) => Math.max(prev, clampedTarget));
      return;
    }

    let cancelled = false;
    const startValue = valueRef.current;
    const startedAt = Date.now();
    const distance = clampedTarget - startValue;

    const tick = () => {
      if (cancelled) return;
      const elapsed = Date.now() - startedAt;
      const t = Math.min(1, elapsed / DISPLAY_PROGRESS_RAMP_MS);
      const eased = startValue + distance * easeOutCubic(t);
      setValue((prev) => Math.max(prev, Math.min(eased, clampedTarget)));
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, [clampedTarget, options.reducedMotion]);

  return Math.round(Math.min(value, ceiling));
}
