import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import { ThemeMode } from 'config';
import { useAppTheme } from 'hooks/useAppTheme';
import { ACTIVATION_LAYOUT } from './activationMotionTokens';
import type { WorkflowSceneId } from './activationMotionTokens';
import { SyncCompletionChip } from './components/SyncCompletionChip';
import { SyncProgressPanel } from './components/SyncProgressPanel';
import { WorkflowFilm } from './components/WorkflowFilm';
import {
  isSyncComplete,
  isSyncFailure,
  useFirstRunSyncExperience,
} from './hooks/useFirstRunSyncExperience';
import { useDisplayProgress } from './hooks/useDisplayProgress';
import type { SyncCounts, SyncProgress } from './hooks/useSyncStatus';
import { useWorkflowStory } from './hooks/useWorkflowStory';
import type { WorkflowStorySnapshot } from './hooks/useWorkflowStory';

export interface SyncAnimationSnapshot {
  status: string;
  counts: SyncCounts;
  progress: SyncProgress | null;
  lastError?: string | null;
}

export interface StoryPreviewOverride {
  state: WorkflowSceneId | 'AMBIENT' | 'INTERRUPTED' | 'COMPLETION';
}

export interface SyncAnimationDiagnostics {
  syncStatus: string;
  storyState: string;
  firstActivation: boolean;
  dwellSatisfied: boolean;
  syncComplete: boolean;
  postSyncResolveActive: boolean;
  completionTransitionActive: boolean;
  veryLongSync: boolean;
  reducedMotion: boolean;
  resolvedTheme: 'light' | 'dark' | 'unresolved';
}

export interface SyncAnimationExperienceProps {
  syncSnapshot: SyncAnimationSnapshot;
  firstActivation: boolean;
  reducedMotion: boolean;
  timingScale?: number;
  experienceInitialElapsedMs?: number;
  storyOverride?: StoryPreviewOverride | null;
  themeResolvedOverride?: boolean;
  diagnostics?: (diagnostics: SyncAnimationDiagnostics) => React.ReactNode;
}

function resolveStoryForDisplay(
  story: WorkflowStorySnapshot,
  override: StoryPreviewOverride | null | undefined
) {
  if (!override || override.state === 'COMPLETION') return story;
  if (override.state === 'AMBIENT') {
    return {
      ...story,
      state: 'AMBIENT',
      scene: null,
      sceneIndex: -1,
      isAmbient: true,
      interrupted: false,
      sceneSettled: true,
      sceneCanExit: false,
    } satisfies WorkflowStorySnapshot;
  }
  if (override.state === 'INTERRUPTED') {
    return {
      ...story,
      state: 'INTERRUPTED',
      scene: null,
      sceneIndex: -1,
      isAmbient: false,
      interrupted: true,
      sceneSettled: true,
      sceneCanExit: false,
    } satisfies WorkflowStorySnapshot;
  }
  return {
    ...story,
    state: override.state,
    scene: story.scene?.id === override.state
      ? story.scene
      : null,
    isAmbient: false,
    interrupted: false,
    sceneSettled: true,
    sceneCanExit: true,
  } satisfies WorkflowStorySnapshot;
}

export const SyncAnimationExperience: React.FC<SyncAnimationExperienceProps> = ({
  syncSnapshot,
  firstActivation,
  reducedMotion,
  timingScale,
  experienceInitialElapsedMs,
  storyOverride,
  themeResolvedOverride,
  diagnostics,
}) => {
  const appTheme = useAppTheme();
  const { colorScheme } = useColorScheme();
  const syncComplete = isSyncComplete(syncSnapshot.status);
  const syncFailed = isSyncFailure(syncSnapshot.status);
  const themeResolved = themeResolvedOverride ?? (
    colorScheme === ThemeMode.LIGHT || colorScheme === ThemeMode.DARK
  );
  const resolvedTheme =
    colorScheme === ThemeMode.LIGHT || colorScheme === ThemeMode.DARK
      ? colorScheme
      : 'unresolved';

  const story = useWorkflowStory({
    syncComplete,
    interrupted: syncFailed,
    reducedMotion,
    durationScale: timingScale,
  });
  const displayStory = syncFailed ? story : resolveStoryForDisplay(story, storyOverride);
  const [filmSceneSettled, setFilmSceneSettled] = useState(false);

  useEffect(() => {
    setFilmSceneSettled(displayStory.sceneSettled);
  }, [displayStory.state, displayStory.sceneSettled]);

  const handleSceneSettled = useCallback(() => {
    setFilmSceneSettled(true);
  }, []);

  const sceneCanExit = displayStory.sceneCanExit || filmSceneSettled;
  const experience = useFirstRunSyncExperience({
    isFirstActivation: firstActivation,
    syncStatus: syncSnapshot.status,
    sceneSettled: sceneCanExit,
    timingScale,
    initialElapsedMs: experienceInitialElapsedMs,
  });

  const forceCompletion = storyOverride?.state === 'COMPLETION';

  // DISPLAY / EXPERIENCE projection only — never a lifecycle authority.
  const completionEligible = !syncFailed && (forceCompletion || experience.completionEligible);
  const displayProgress = useDisplayProgress({
    storyState: displayStory.state,
    isAmbient: displayStory.isAmbient,
    interrupted: syncFailed || displayStory.interrupted,
    completionEligible,
    reducedMotion,
  });

  const pageBackground = useMemo(
    () =>
      appTheme.isDark
        ? 'radial-gradient(ellipse 90% 70% at 64% 40%, var(--bg-2) 0%, var(--bg) 72%)'
        : 'linear-gradient(180deg, var(--bg) 0%, var(--bg-2) 100%)',
    [appTheme.isDark]
  );

  const diagnosticsNode = diagnostics?.({
    syncStatus: syncSnapshot.status,
    storyState: displayStory.state,
    firstActivation,
    dwellSatisfied: experience.dwellSatisfied,
    syncComplete: experience.syncComplete,
    postSyncResolveActive: experience.phase === 'POST_SYNC_RESOLVE',
    completionTransitionActive: forceCompletion || experience.phase === 'COMPLETION_TRANSITION',
    veryLongSync: experience.veryLongSync,
    reducedMotion,
    resolvedTheme,
  });

  return (
    <Box
      data-testid="sync-animation-experience"
      data-first-activation={firstActivation ? 'true' : 'false'}
      data-sync-complete={syncComplete ? 'true' : 'false'}
      data-sync-failed={syncFailed ? 'true' : 'false'}
      data-experience-phase={forceCompletion ? 'COMPLETION' : experience.phase}
      sx={{
        minHeight: 'calc(100vh - 60px)',
        bgcolor: 'var(--bg)',
        background: pageBackground,
        color: 'var(--ink)',
        fontFamily: 'var(--sans)',
        display: 'flex',
      }}
    >
      <Box
        data-layout-mode="activation-side-by-side-md"
        data-reviewer-laptop-layout="side-by-side"
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'stretch',
          minHeight: 0,
          width: '100%',
          maxWidth: 1440,
          mx: 'auto',
          flexDirection: {
            xs: 'column',
            md: 'row',
          },
        }}
      >
        <Box
          component="main"
          sx={{
            flex: {
              md: `0 0 ${ACTIVATION_LAYOUT.DESKTOP_LEFT_PERCENT}%`,
            },
            minWidth: {
              xs: 0,
              md: ACTIVATION_LAYOUT.LEFT_PANEL_MIN_WIDTH,
            },
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            px: { xs: 3, sm: 5, md: '4vw' },
            py: { xs: 4, md: 6 },
            order: 1,
          }}
        >
          <Box sx={{ width: '100%', maxWidth: 540 }}>
            <SyncProgressPanel
              status={syncSnapshot.status}
              counts={syncSnapshot.counts}
              progress={syncSnapshot.progress}
              lastError={syncSnapshot.lastError}
              veryLongSync={experience.veryLongSync}
              isFirstActivation={firstActivation}
              displayPercentOverride={syncFailed ? undefined : displayProgress}
              displayComplete={completionEligible}
              reducedMotion={reducedMotion}
            />
            {diagnosticsNode}
          </Box>
        </Box>

        <Box
          component="aside"
          sx={{
            flex: {
              md: `0 0 ${ACTIVATION_LAYOUT.DESKTOP_RIGHT_PERCENT}%`,
            },
            minWidth: {
              xs: 0,
              md: ACTIVATION_LAYOUT.RIGHT_FILM_MIN_WIDTH,
            },
            display: 'flex',
            alignItems: 'stretch',
            justifyContent: 'center',
            px: { xs: 3, sm: 5, md: '0.5vw' },
            pb: { xs: 4, md: 6 },
            pt: { xs: 0, md: 6 },
            order: { xs: 2, md: 2 },
          }}
        >
          <Box sx={{ width: '100%', maxWidth: { xs: 680, md: 'none' } }}>
            <WorkflowFilm
              scene={displayStory.scene?.id ?? (typeof displayStory.state === 'string' && displayStory.state.startsWith('SCENE_') ? displayStory.state as WorkflowSceneId : null)}
              isAmbient={displayStory.isAmbient}
              interrupted={syncFailed || displayStory.interrupted}
              reducedMotion={reducedMotion}
              themeResolved={themeResolved}
              onSceneSettled={handleSceneSettled}
            />
          </Box>
        </Box>
      </Box>

      <SyncCompletionChip
        visible={completionEligible}
        reducedMotion={reducedMotion}
        onEnterWorkspace={experience.enterWorkspaceNow}
      />
    </Box>
  );
};
