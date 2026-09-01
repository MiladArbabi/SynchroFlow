import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ACTIVATION_TIMING,
  WORKFLOW_SCENES,
} from '../activationMotionTokens';
import type { WorkflowSceneDefinition, WorkflowSceneId } from '../activationMotionTokens';

export type WorkflowStoryStateId = WorkflowSceneId | 'AMBIENT' | 'INTERRUPTED';

export interface WorkflowStorySnapshot {
  state: WorkflowStoryStateId;
  scene: WorkflowSceneDefinition | null;
  sceneIndex: number;
  elapsedMs: number;
  sceneElapsedMs: number;
  sceneDurationMs: number;
  sceneSettled: boolean;
  sceneCanExit: boolean;
  isAmbient: boolean;
  interrupted: boolean;
}

export interface WorkflowStoryOptions {
  syncComplete: boolean;
  interrupted: boolean;
  reducedMotion: boolean;
  durationScale?: number;
}

function normalizeScale(scale: number | undefined) {
  return scale && scale > 0 ? scale : 1;
}

function scaledDuration(durationMs: number, scale: number | undefined) {
  return Math.max(1, Math.round(durationMs / normalizeScale(scale)));
}

function totalWorkflowDurationMs(scale: number | undefined) {
  return WORKFLOW_SCENES.reduce((sum, scene) => sum + scaledDuration(scene.durationMs, scale), 0);
}

export function getWorkflowStorySnapshot(
  elapsedMs: number,
  options: WorkflowStoryOptions
): WorkflowStorySnapshot {
  if (options.interrupted) {
    return {
      state: 'INTERRUPTED',
      scene: null,
      sceneIndex: -1,
      elapsedMs,
      sceneElapsedMs: 0,
      sceneDurationMs: 0,
      sceneSettled: true,
      sceneCanExit: false,
      isAmbient: false,
      interrupted: true,
    };
  }

  const totalDuration = totalWorkflowDurationMs(options.durationScale);
  if (elapsedMs >= totalDuration) {
    const lastScene = WORKFLOW_SCENES[WORKFLOW_SCENES.length - 1];
    const lastDuration = scaledDuration(lastScene.durationMs, options.durationScale);
    return {
      state: options.syncComplete ? lastScene.id : 'AMBIENT',
      scene: options.syncComplete ? lastScene : null,
      sceneIndex: options.syncComplete ? WORKFLOW_SCENES.length - 1 : -1,
      elapsedMs,
      sceneElapsedMs: lastDuration,
      sceneDurationMs: lastDuration,
      sceneSettled: true,
      sceneCanExit: options.syncComplete,
      isAmbient: !options.syncComplete,
      interrupted: false,
    };
  }

  let cursor = elapsedMs;
  for (let i = 0; i < WORKFLOW_SCENES.length; i += 1) {
    const scene = WORKFLOW_SCENES[i];
    const sceneDuration = scaledDuration(scene.durationMs, options.durationScale);
    if (cursor < sceneDuration) {
      const sceneSettled =
        options.reducedMotion ||
        cursor >= Math.min(scaledDuration(ACTIVATION_TIMING.SCENE_NATURAL_SETTLE_MS, options.durationScale), sceneDuration);
      return {
        state: scene.id,
        scene,
        sceneIndex: i,
        elapsedMs,
        sceneElapsedMs: cursor,
        sceneDurationMs: sceneDuration,
        sceneSettled,
        sceneCanExit: sceneSettled,
        isAmbient: false,
        interrupted: false,
      };
    }
    cursor -= sceneDuration;
  }

  const fallbackScene = WORKFLOW_SCENES[0];
  return {
    state: fallbackScene.id,
    scene: fallbackScene,
    sceneIndex: 0,
    elapsedMs,
    sceneElapsedMs: 0,
    sceneDurationMs: fallbackScene.durationMs,
    sceneSettled: options.reducedMotion,
    sceneCanExit: options.reducedMotion,
    isAmbient: false,
    interrupted: false,
  };
}

export function getNextWorkflowStoryDelay(snapshot: WorkflowStorySnapshot): number | null {
  if (snapshot.interrupted || snapshot.isAmbient) return null;
  if (!snapshot.scene) return null;
  const remaining = snapshot.sceneDurationMs - snapshot.sceneElapsedMs;
  return remaining > 0 ? remaining : null;
}

function isDocumentHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export function useWorkflowStory(options: WorkflowStoryOptions): WorkflowStorySnapshot {
  const [elapsedMs, setElapsedMs] = useState(0);
  const elapsedRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleSinceRef = useRef(Date.now());
  const hiddenRef = useRef(isDocumentHidden());

  const snapshot = useMemo(
    () => getWorkflowStorySnapshot(elapsedMs, options),
    [elapsedMs, options.syncComplete, options.interrupted, options.reducedMotion]
  );

  useEffect(() => {
    if (options.interrupted) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      return;
    }

    const clearStoryTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const schedule = () => {
      clearStoryTimer();
      if (hiddenRef.current) return;

      const current = getWorkflowStorySnapshot(elapsedRef.current, options);
      const delay = getNextWorkflowStoryDelay(current);
      if (delay === null) return;

      visibleSinceRef.current = Date.now();
      timerRef.current = setTimeout(() => {
        elapsedRef.current += delay;
        setElapsedMs(elapsedRef.current);
      }, delay);
    };

    hiddenRef.current = isDocumentHidden();
    schedule();

    const onVisibilityChange = () => {
      if (isDocumentHidden()) {
        hiddenRef.current = true;
        elapsedRef.current += Math.max(0, Date.now() - visibleSinceRef.current);
        setElapsedMs(elapsedRef.current);
        clearStoryTimer();
        return;
      }

      hiddenRef.current = false;
      visibleSinceRef.current = Date.now();
      schedule();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearStoryTimer();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [elapsedMs, options.syncComplete, options.interrupted, options.reducedMotion]);

  return snapshot;
}
