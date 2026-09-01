import React from 'react';
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { ACTIVATION_TIMING, WORKFLOW_SCENE_IDS } from 'activation/activationMotionTokens';
import { getActivationPreviewSnapshot } from 'activation/activationPreviewFixtures';
import { SyncAnimationExperience } from 'activation/SyncAnimationExperience';
import {
  deriveSyncExperienceSnapshot,
  useFirstRunSyncExperience,
} from 'activation/hooks/useFirstRunSyncExperience';
import {
  DISPLAY_PROGRESS_CEILING,
  DISPLAY_PROGRESS_COMPLETE,
  DISPLAY_PROGRESS_INITIAL,
  computeDisplayProgressTarget,
  resolveMonotonicDisplayProgress,
} from 'activation/hooks/useDisplayProgress';

// ---------------------------------------------------------------------------
// SHOP-REVIEW-SYNC-ANIMATION-THEME-07 — post-OAuth progress smoothing +
// non-blocking sync-complete handoff. Permanent regression contracts P1–P6
// (displayed progress) and C1–C10 (completion chip / CTA / no blocking overlay).
//
// Authority contract: displayed progress is a DISPLAY projection derived from
// the story/completion clocks. It is never a fourth authority and never drives
// backend/lifecycle completion.
// ---------------------------------------------------------------------------

const SCENES = WORKFLOW_SCENE_IDS as unknown as string[];

const notEligible = (storyState: string) =>
  computeDisplayProgressTarget({
    storyState,
    isAmbient: storyState === 'AMBIENT',
    interrupted: false,
    completionEligible: false,
  });

describe('SHOP-REVIEW-SYNC-ANIMATION-THEME-07 displayed progress (P1–P6)', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('P1 does not show 100% immediately when the backend already reports completed at mount', () => {
    render(
      <SyncAnimationExperience
        syncSnapshot={getActivationPreviewSnapshot('completed', 0)}
        firstActivation
        reducedMotion={false}
        themeResolvedOverride
      />
    );

    const panel = screen.getByTestId('sync-progress-panel');
    expect(panel).not.toHaveTextContent('100%');
    expect(panel).toHaveTextContent(`${DISPLAY_PROGRESS_INITIAL}%`);
  });

  it('P2 advances monotonically through the seven-scene progression', () => {
    const expectedTargets = [30, 60, 82, 88, 91, 93, 95];
    let previous = DISPLAY_PROGRESS_INITIAL;
    const observed: number[] = [];

    for (const scene of SCENES) {
      const target = notEligible(scene);
      const next = resolveMonotonicDisplayProgress(previous, target, false);
      expect(next).toBeGreaterThanOrEqual(previous);
      observed.push(next);
      previous = next;
    }

    expect(observed).toEqual(expectedTargets);
  });

  it('P3 stays at or below 95 for every pre-completion story state', () => {
    for (const state of [...SCENES, 'AMBIENT']) {
      expect(notEligible(state)).toBeLessThanOrEqual(DISPLAY_PROGRESS_CEILING);
      expect(resolveMonotonicDisplayProgress(DISPLAY_PROGRESS_CEILING, notEligible(state), false)).toBeLessThanOrEqual(
        DISPLAY_PROGRESS_CEILING
      );
    }
  });

  it('P4 keeps display progress below 100 at Scene 7 / ambient during a long sync', () => {
    expect(notEligible('SCENE_7')).toBeLessThan(DISPLAY_PROGRESS_COMPLETE);
    expect(notEligible('AMBIENT')).toBeLessThan(DISPLAY_PROGRESS_COMPLETE);
    expect(
      resolveMonotonicDisplayProgress(DISPLAY_PROGRESS_CEILING, notEligible('AMBIENT'), false)
    ).toBeLessThan(DISPLAY_PROGRESS_COMPLETE);
  });

  it('P5 makes the display target 100 only once completion is eligible', () => {
    expect(
      computeDisplayProgressTarget({
        storyState: 'SCENE_3',
        isAmbient: false,
        interrupted: false,
        completionEligible: true,
      })
    ).toBe(DISPLAY_PROGRESS_COMPLETE);
    expect(resolveMonotonicDisplayProgress(DISPLAY_PROGRESS_CEILING, DISPLAY_PROGRESS_COMPLETE, true)).toBe(
      DISPLAY_PROGRESS_COMPLETE
    );
  });

  it('P6 display projection never drives backend/lifecycle authority', () => {
    render(
      <SyncAnimationExperience
        syncSnapshot={getActivationPreviewSnapshot('normal', 1000)}
        firstActivation
        reducedMotion={false}
        storyOverride={{ state: 'SCENE_7' }}
        themeResolvedOverride
      />
    );

    const experience = screen.getByTestId('sync-animation-experience');
    // Display target for Scene 7 is 95, but the backend sync is still running:
    expect(notEligible('SCENE_7')).toBe(95);
    expect(experience).toHaveAttribute('data-sync-complete', 'false');
    expect(experience).toHaveAttribute('data-experience-phase', 'SYNCING');
    expect(screen.getByTestId('workflow-film')).toHaveAttribute('data-sync-authority', 'none');
    expect(screen.queryByTestId('sync-completion-chip')).toBeNull();
  });
});

describe('SHOP-REVIEW-SYNC-ANIMATION-THEME-07 completion handoff (C1–C10)', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const renderEligible = (extra?: Partial<React.ComponentProps<typeof SyncAnimationExperience>>) =>
    render(
      <SyncAnimationExperience
        syncSnapshot={getActivationPreviewSnapshot('completed', 0)}
        firstActivation
        reducedMotion={false}
        storyOverride={{ state: 'COMPLETION' }}
        themeResolvedOverride
        {...extra}
      />
    );

  it('C1 does not render the old centred blocking Sync Complete overlay', () => {
    renderEligible();
    expect(screen.queryByTestId('sync-completion-transition')).toBeNull();
    expect(document.body.innerHTML).not.toContain('activationCompletionFade');
  });

  it('C2 presents no completion backdrop / dimming layer', () => {
    renderEligible();
    const root = screen.getByTestId('sync-animation-experience');
    const chip = screen.getByTestId('sync-completion-chip');
    // The chip is a direct child of the experience root — not wrapped in a
    // full-bleed overlay — and marks itself non-blocking.
    expect(chip.parentElement).toBe(root);
    expect(chip).toHaveAttribute('data-blocking', 'false');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.innerHTML).not.toContain('rgba(0,0,0,0.38)');
  });

  it('C3 shows the non-blocking "Sync complete" chip once completion is eligible', () => {
    renderEligible();
    const chip = screen.getByTestId('sync-completion-chip');
    expect(within(chip).getByText('Sync complete')).toBeInTheDocument();
    // World stays visible beneath it.
    expect(screen.getByTestId('workflow-film')).toBeInTheDocument();
  });

  it('C4 exposes an "Enter workspace" CTA on the chip', () => {
    renderEligible();
    const chip = screen.getByTestId('sync-completion-chip');
    expect(within(chip).getByRole('button', { name: /enter workspace/i })).toBeEnabled();
  });

  it('C5 clicking "Enter workspace" enters the completion transition without waiting for the resolve timer', () => {
    render(
      <SyncAnimationExperience
        syncSnapshot={getActivationPreviewSnapshot('reconnect', 6000)}
        firstActivation={false}
        reducedMotion={false}
        themeResolvedOverride
      />
    );

    const experience = screen.getByTestId('sync-animation-experience');
    // Auto path is still mid post-sync resolve (scene not settled yet).
    expect(experience).toHaveAttribute('data-experience-phase', 'POST_SYNC_RESOLVE');

    fireEvent.click(screen.getByRole('button', { name: /enter workspace/i }));

    expect(experience.getAttribute('data-experience-phase')).toMatch(
      /COMPLETION_TRANSITION|READY_TO_ENTER/
    );
  });

  it('C5b enterWorkspaceNow is a no-op until completion is eligible, and cannot fabricate completion', () => {
    jest.useFakeTimers();
    let now = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);

    const { result } = renderHook(() =>
      useFirstRunSyncExperience({
        isFirstActivation: true,
        syncStatus: 'SYNCING',
        sceneSettled: false,
      })
    );

    act(() => {
      result.current.enterWorkspaceNow();
    });

    expect(result.current.phase).toBe('SYNCING');
    expect(result.current.completionEligible).toBe(false);
    expect(result.current.syncComplete).toBe(false);
  });

  it('C6 automatic completion stays bounded by MAX_POST_SYNC_RESOLVE_MS', () => {
    const beforeBound = deriveSyncExperienceSnapshot({
      isFirstActivation: false,
      syncStatus: 'COMPLETED',
      sceneSettled: false,
      mountedAtMs: 0,
      nowMs: ACTIVATION_TIMING.MAX_POST_SYNC_RESOLVE_MS - 1,
      syncCompletedAtMs: 0,
      resolveStartedAtMs: 0,
    });
    const atBound = deriveSyncExperienceSnapshot({
      isFirstActivation: false,
      syncStatus: 'COMPLETED',
      sceneSettled: false,
      mountedAtMs: 0,
      nowMs: ACTIVATION_TIMING.MAX_POST_SYNC_RESOLVE_MS,
      syncCompletedAtMs: 0,
      resolveStartedAtMs: 0,
    });

    expect(beforeBound.canExitSync).toBe(false);
    expect(atBound.resolveTimeoutExpired).toBe(true);
    expect(atBound.canExitSync).toBe(true);
  });

  it('C7 completion transition still honours COMPLETION_TRANSITION_MS', () => {
    const midTransition = deriveSyncExperienceSnapshot({
      isFirstActivation: false,
      syncStatus: 'COMPLETED',
      sceneSettled: true,
      mountedAtMs: 0,
      nowMs: ACTIVATION_TIMING.COMPLETION_TRANSITION_MS - 1,
      syncCompletedAtMs: 0,
      resolveStartedAtMs: 0,
      transitionStartedAtMs: 0,
    });
    const doneTransition = deriveSyncExperienceSnapshot({
      isFirstActivation: false,
      syncStatus: 'COMPLETED',
      sceneSettled: true,
      mountedAtMs: 0,
      nowMs: ACTIVATION_TIMING.COMPLETION_TRANSITION_MS,
      syncCompletedAtMs: 0,
      resolveStartedAtMs: 0,
      transitionStartedAtMs: 0,
    });

    expect(midTransition.phase).toBe('COMPLETION_TRANSITION');
    expect(midTransition.completionTransitionDone).toBe(false);
    expect(doneTransition.completionTransitionDone).toBe(true);
    expect(doneTransition.phase).toBe('READY_TO_ENTER');
  });

  it('C8 the chip is a corner child of the experience root, out of the scene/copy columns', () => {
    renderEligible();
    const root = screen.getByTestId('sync-animation-experience');
    const chip = screen.getByTestId('sync-completion-chip');
    expect(chip.parentElement).toBe(root);
    expect(root.querySelector('main')?.contains(chip)).toBe(false);
    expect(root.querySelector('aside')?.contains(chip)).toBe(false);
    // Pixel-level 1024x820 no-overflow / no-overlap is covered by matrix M19.
  });

  it('C9 reduced motion keeps the chip non-blocking and never shows 100 before eligibility', () => {
    const eligible = renderEligible({ reducedMotion: true });
    const chip = screen.getByTestId('sync-completion-chip');
    expect(chip).toHaveAttribute('data-reduced-motion', 'true');
    expect(within(chip).getByRole('button', { name: /enter workspace/i })).toBeEnabled();
    eligible.unmount();

    render(
      <SyncAnimationExperience
        syncSnapshot={getActivationPreviewSnapshot('normal', 1000)}
        firstActivation
        reducedMotion
        storyOverride={{ state: 'SCENE_5' }}
        themeResolvedOverride
      />
    );
    const panel = screen.getByTestId('sync-progress-panel');
    expect(panel).not.toHaveTextContent('100%');
    expect(panel).toHaveTextContent('91%');
  });

  it('C10 the failure state never exposes a misleading Sync Complete CTA', () => {
    render(
      <SyncAnimationExperience
        syncSnapshot={getActivationPreviewSnapshot('failed', 0)}
        firstActivation
        reducedMotion={false}
        storyOverride={{ state: 'SCENE_4' }}
        themeResolvedOverride
      />
    );

    expect(screen.queryByTestId('sync-completion-chip')).toBeNull();
    expect(screen.queryByRole('button', { name: /enter workspace/i })).toBeNull();
    expect(screen.getByTestId('sync-progress-panel')).toHaveTextContent('Sync interrupted.');
  });
});
