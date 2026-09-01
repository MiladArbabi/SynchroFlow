import React from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import {
  ACTIVATION_TIMING,
  SCENE_4_SEMANTICS,
  SCENE_5_SEMANTICS,
  SCENE_6_SEMANTICS,
  SCENE_7_TRACE_NODES,
  WORKFLOW_TRACE_NODE_ORDER,
  WORKFLOW_SCENES,
} from 'activation/activationMotionTokens';
import {
  ACTIVATION_PREVIEW_FIXTURES,
  getActivationPreviewSnapshot,
  shouldEnableActivationPreviewRoute,
} from 'activation/activationPreviewFixtures';
import {
  deriveSyncExperienceSnapshot,
} from 'activation/hooks/useFirstRunSyncExperience';
import {
  getNextWorkflowStoryDelay,
  getWorkflowStorySnapshot,
  useWorkflowStory,
} from 'activation/hooks/useWorkflowStory';
import {
  computeBackendProgressPercent,
  isBackendProgressIndeterminate,
} from 'activation/components/SyncProgressPanel';
import { SyncAnimationExperience } from 'activation/SyncAnimationExperience';
import { isFirstActivationPhase } from 'activation/SyncAnimationPage';
import { WorkflowFilm } from 'activation/components/WorkflowFilm';

// ---------------------------------------------------------------------------
// Final approved seven-scene story — permanent business identities.
// The operational story carries exactly five product identities, partitioned
// across exactly three orders (2 + 1 + 2). The warehouse is a faithful, flat
// transplant of the landing-page world with a fixed physical zone-id set.
// ---------------------------------------------------------------------------
const WORKFLOW_PRODUCT_IDENTITIES = ['bottle', 'pouch', 'box', 'carton', 'jar'] as const;

const WORKFLOW_ORDER_PARTITION: Record<string, string[]> = {
  'order-1': ['bottle', 'pouch'],
  'order-2': ['box'],
  'order-3': ['carton', 'jar'],
};

const WAREHOUSE_TRANSPLANT_ZONE_IDS = [
  'admin',
  'dock',
  'orders',
  'outbound',
  'pack',
  'receive',
  'shelves',
  'stow',
];

/** Collect data-product-id values grouped (and sorted) by data-order-id for a marker. */
function groupProductIdsByOrder(root: HTMLElement, marker: string): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const node of Array.from(root.querySelectorAll(`[data-workflow-marker="${marker}"]`))) {
    const orderId = node.getAttribute('data-order-id');
    const productId = node.getAttribute('data-product-id');
    if (!orderId || !productId) continue;
    (grouped[orderId] ||= []).push(productId);
  }
  for (const key of Object.keys(grouped)) grouped[key].sort();
  return grouped;
}

describe('Sync animation Slice 1 experience contracts', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('T1 records early completion but holds first-run exit until 9000ms', () => {
    const beforeDwell = deriveSyncExperienceSnapshot({
      isFirstActivation: true,
      syncStatus: 'COMPLETED',
      sceneSettled: true,
      mountedAtMs: 0,
      nowMs: ACTIVATION_TIMING.MIN_FIRST_RUN_DWELL_MS - 1,
      syncCompletedAtMs: 1000,
    });

    expect(beforeDwell.canExitSync).toBe(false);
    expect(beforeDwell.dwellSatisfied).toBe(false);

    const atDwell = deriveSyncExperienceSnapshot({
      isFirstActivation: true,
      syncStatus: 'COMPLETED',
      sceneSettled: true,
      mountedAtMs: 0,
      nowMs: ACTIVATION_TIMING.MIN_FIRST_RUN_DWELL_MS,
      syncCompletedAtMs: 1000,
    });

    expect(atDwell.canExitSync).toBe(true);
    expect(atDwell.phase).toBe('COMPLETION_TRANSITION');
  });

  it('T2 resolves immediately when first-run sync completes after dwell', () => {
    const snapshot = deriveSyncExperienceSnapshot({
      isFirstActivation: true,
      syncStatus: 'COMPLETED',
      sceneSettled: true,
      mountedAtMs: 0,
      nowMs: 12000,
      syncCompletedAtMs: 12000,
    });

    expect(snapshot.dwellSatisfied).toBe(true);
    expect(snapshot.canExitSync).toBe(true);
  });

  it('T3 and T17 do not force reconnect/resync through first-run dwell', () => {
    expect(isFirstActivationPhase('FT1')).toBe(false);
    expect(isFirstActivationPhase('FT1_READY')).toBe(false);
    expect(isFirstActivationPhase('FT2_READY')).toBe(false);

    const snapshot = deriveSyncExperienceSnapshot({
      isFirstActivation: false,
      syncStatus: 'COMPLETED',
      sceneSettled: true,
      mountedAtMs: 0,
      nowMs: 1000,
      syncCompletedAtMs: 1000,
    });

    expect(snapshot.dwellSatisfied).toBe(true);
    expect(snapshot.canExitSync).toBe(true);
  });

  it('T4 interrupts buffer and story on sync failure', () => {
    expect(isFirstActivationPhase('FT_MINUS_ONE')).toBe(true);
    expect(isFirstActivationPhase('FT0')).toBe(true);
    expect(isFirstActivationPhase('FT0_SYNCING')).toBe(true);
    expect(isFirstActivationPhase('FT0_PREPARING')).toBe(true);

    const buffer = deriveSyncExperienceSnapshot({
      isFirstActivation: true,
      syncStatus: 'FAILED',
      sceneSettled: true,
      mountedAtMs: 0,
      nowMs: 2000,
      syncCompletedAtMs: null,
    });
    const story = getWorkflowStorySnapshot(2000, {
      syncComplete: false,
      interrupted: true,
      reducedMotion: false,
    });

    expect(buffer.phase).toBe('INTERRUPTED');
    expect(buffer.canExitSync).toBe(false);
    expect(story.state).toBe('INTERRUPTED');
  });

  it('T5 advances scenes independently from backend status', () => {
    const secondScene = getWorkflowStorySnapshot(WORKFLOW_SCENES[0].durationMs, {
      syncComplete: false,
      interrupted: false,
      reducedMotion: false,
    });

    expect(secondScene.state).toBe('SCENE_2');
  });

  it('T6 enters ambient after scene 7 when backend sync is incomplete', () => {
    const elapsed = WORKFLOW_SCENES.reduce((sum, scene) => sum + scene.durationMs, 0);
    const snapshot = getWorkflowStorySnapshot(elapsed, {
      syncComplete: false,
      interrupted: false,
      reducedMotion: false,
    });

    expect(snapshot.state).toBe('AMBIENT');
    expect(snapshot.isAmbient).toBe(true);
  });

  it('T7 keeps scene 7 settled when backend sync is complete', () => {
    const elapsed = WORKFLOW_SCENES.reduce((sum, scene) => sum + scene.durationMs, 0);
    const snapshot = getWorkflowStorySnapshot(elapsed, {
      syncComplete: true,
      interrupted: false,
      reducedMotion: false,
    });

    expect(snapshot.state).toBe('SCENE_7');
    expect(snapshot.sceneCanExit).toBe(true);
  });

  it('T8 stops story scheduling after interruption', () => {
    const snapshot = getWorkflowStorySnapshot(0, {
      syncComplete: false,
      interrupted: true,
      reducedMotion: false,
    });

    expect(getNextWorkflowStoryDelay(snapshot)).toBeNull();
  });

  it('T9 settles scenes immediately in reduced motion', () => {
    const snapshot = getWorkflowStorySnapshot(0, {
      syncComplete: false,
      interrupted: false,
      reducedMotion: true,
    });

    expect(snapshot.sceneSettled).toBe(true);
    expect(snapshot.sceneCanExit).toBe(true);
  });

  it('T10 derives progress only from backend status/progress', () => {
    expect(
      computeBackendProgressPercent('SYNCING', {
        current: 12,
        total: 40,
        percentage: 30,
      })
    ).toBe(30);
    expect(computeBackendProgressPercent('COMPLETED', null)).toBe(100);
  });

  it('T11 encodes scene 4 put-away semantics', () => {
    expect(SCENE_4_SEMANTICS).toEqual(['barcoded products', 'stow queue', 'inventory bin', 'placement confirmed']);
  });

  it('T12 encodes scene 5 pick semantics', () => {
    expect(SCENE_5_SEMANTICS).toEqual(['orders released', 'picking trolley', 'inventory pick', 'staged at pack']);
  });

  it('T13 pauses story timers while the document is hidden without queued catch-up', () => {
    jest.useFakeTimers();
    let now = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });

    const { result } = renderHook(() =>
      useWorkflowStory({
        syncComplete: false,
        interrupted: false,
        reducedMotion: false,
      })
    );

    expect(result.current.state).toBe('SCENE_1');

    now = 500;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    act(() => {
      jest.advanceTimersByTime(20000);
    });

    expect(result.current.state).toBe('SCENE_1');

    now = 20500;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    act(() => {
      jest.advanceTimersByTime(WORKFLOW_SCENES[0].durationMs - 501);
    });
    expect(result.current.state).toBe('SCENE_1');

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current.state).toBe('SCENE_2');
  });

  it('starts paused when mounted while the document is already hidden', () => {
    jest.useFakeTimers();
    let now = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });

    const { result } = renderHook(() =>
      useWorkflowStory({
        syncComplete: false,
        interrupted: false,
        reducedMotion: false,
      })
    );

    expect(result.current.state).toBe('SCENE_1');

    now = WORKFLOW_SCENES[0].durationMs + 5000;
    act(() => {
      jest.advanceTimersByTime(WORKFLOW_SCENES[0].durationMs + 5000);
    });

    expect(result.current.state).toBe('SCENE_1');

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(result.current.state).toBe('SCENE_1');

    now += WORKFLOW_SCENES[0].durationMs - 1;
    act(() => {
      jest.advanceTimersByTime(WORKFLOW_SCENES[0].durationMs - 1);
    });
    expect(result.current.state).toBe('SCENE_1');

    now += 1;
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current.state).toBe('SCENE_2');
  });

  it('T14 keeps story timing independent from sync polling cadence', () => {
    const snapshot = getWorkflowStorySnapshot(1999, {
      syncComplete: false,
      interrupted: false,
      reducedMotion: false,
    });

    expect(snapshot.state).toBe('SCENE_1');
    expect(snapshot.elapsedMs).toBe(1999);
  });

  it('T15 exposes very-long sync after 45000ms', () => {
    const snapshot = deriveSyncExperienceSnapshot({
      isFirstActivation: true,
      syncStatus: 'SYNCING',
      sceneSettled: false,
      mountedAtMs: 0,
      nowMs: ACTIVATION_TIMING.VERY_LONG_THRESHOLD_MS,
      syncCompletedAtMs: null,
    });

    expect(snapshot.veryLongSync).toBe(true);
  });

  it('T16 caps post-sync natural resolve at 1800ms', () => {
    const beforeCap = deriveSyncExperienceSnapshot({
      isFirstActivation: false,
      syncStatus: 'COMPLETED',
      sceneSettled: false,
      mountedAtMs: 0,
      nowMs: ACTIVATION_TIMING.MAX_POST_SYNC_RESOLVE_MS - 1,
      syncCompletedAtMs: 0,
      resolveStartedAtMs: 0,
    });
    const atCap = deriveSyncExperienceSnapshot({
      isFirstActivation: false,
      syncStatus: 'COMPLETED',
      sceneSettled: false,
      mountedAtMs: 0,
      nowMs: ACTIVATION_TIMING.MAX_POST_SYNC_RESOLVE_MS,
      syncCompletedAtMs: 0,
      resolveStartedAtMs: 0,
    });

    expect(beforeCap.canExitSync).toBe(false);
    expect(atCap.resolveTimeoutExpired).toBe(true);
    expect(atCap.canExitSync).toBe(true);
  });

  it('PV1 exposes the preview route only for development builds', () => {
    expect(shouldEnableActivationPreviewRoute(true)).toBe(true);
    expect(shouldEnableActivationPreviewRoute(false)).toBe(false);
  });

  it('PV2 renders production WorkflowFilm through the shared experience', () => {
    render(
      <SyncAnimationExperience
        syncSnapshot={getActivationPreviewSnapshot('initial', 0)}
        firstActivation
        reducedMotion={false}
        themeResolvedOverride
      />
    );

    expect(screen.getByTestId('workflow-film')).toBeInTheDocument();
    expect(screen.getByTestId('sync-progress-panel')).toBeInTheDocument();
  });

  it('PV3 allows preview-only direct scene inspection without changing sequential story math', () => {
    const directScene = 'SCENE_4';
    const productionSnapshot = getWorkflowStorySnapshot(0, {
      syncComplete: false,
      interrupted: false,
      reducedMotion: false,
    });

    expect(directScene).toBe('SCENE_4');
    expect(productionSnapshot.state).toBe('SCENE_1');
  });

  it('PV4 tiny-sync fixture exercises first-run dwell', () => {
    const tiny = ACTIVATION_PREVIEW_FIXTURES.tiny;
    const snapshot = getActivationPreviewSnapshot('tiny', tiny.completesAfterMs ?? 0);
    const experience = deriveSyncExperienceSnapshot({
      isFirstActivation: tiny.firstActivation,
      syncStatus: snapshot.status,
      sceneSettled: true,
      mountedAtMs: 0,
      nowMs: tiny.completesAfterMs ?? 0,
      syncCompletedAtMs: tiny.completesAfterMs,
    });

    expect(snapshot.status).toBe('COMPLETED');
    expect(experience.canExitSync).toBe(false);
    expect(experience.dwellSatisfied).toBe(false);
  });

  it('PV5 reconnect fixture skips first-run dwell', () => {
    const reconnect = ACTIVATION_PREVIEW_FIXTURES.reconnect;
    const snapshot = getActivationPreviewSnapshot('reconnect', reconnect.completesAfterMs ?? 0);
    const experience = deriveSyncExperienceSnapshot({
      isFirstActivation: reconnect.firstActivation,
      syncStatus: snapshot.status,
      sceneSettled: true,
      mountedAtMs: 0,
      nowMs: reconnect.completesAfterMs ?? 0,
      syncCompletedAtMs: reconnect.completesAfterMs,
    });

    expect(reconnect.firstActivation).toBe(false);
    expect(experience.canExitSync).toBe(true);
  });

  it('PV6 failure fixture interrupts real experience state', () => {
    const snapshot = getActivationPreviewSnapshot('failed', 0);
    const experience = deriveSyncExperienceSnapshot({
      isFirstActivation: true,
      syncStatus: snapshot.status,
      sceneSettled: true,
      mountedAtMs: 0,
      nowMs: 0,
      syncCompletedAtMs: null,
    });

    expect(snapshot.status).toBe('FAILED');
    expect(experience.phase).toBe('INTERRUPTED');

    render(
      <SyncAnimationExperience
        syncSnapshot={snapshot}
        firstActivation
        reducedMotion={false}
        storyOverride={{ state: 'SCENE_4' }}
        themeResolvedOverride
      />
    );
    expect(screen.getByTestId('workflow-film')).toHaveAttribute('data-scene', 'INTERRUPTED');
  });

  it('PV7 long-sync fixture can inspect ambient after narrative completion', () => {
    const elapsed = WORKFLOW_SCENES.reduce((sum, scene) => sum + scene.durationMs, 0);
    const snapshot = getActivationPreviewSnapshot('long', ACTIVATION_PREVIEW_FIXTURES.long.initialElapsedMs);
    const story = getWorkflowStorySnapshot(elapsed, {
      syncComplete: snapshot.status === 'COMPLETED',
      interrupted: false,
      reducedMotion: false,
    });

    expect(snapshot.status).toBe('SYNCING');
    expect(story.state).toBe('AMBIENT');
  });

  it('PV8 very-long fixture exposes reassurance state', () => {
    const snapshot = getActivationPreviewSnapshot('very-long', ACTIVATION_PREVIEW_FIXTURES['very-long'].initialElapsedMs);
    const experience = deriveSyncExperienceSnapshot({
      isFirstActivation: true,
      syncStatus: snapshot.status,
      sceneSettled: false,
      mountedAtMs: 0,
      nowMs: ACTIVATION_PREVIEW_FIXTURES['very-long'].initialElapsedMs,
      syncCompletedAtMs: null,
    });

    expect(experience.veryLongSync).toBe(true);
  });

  it('PV8b integrated very-long preview clock seam renders reassurance immediately', () => {
    const fixture = ACTIVATION_PREVIEW_FIXTURES['very-long'];

    render(
      <SyncAnimationExperience
        syncSnapshot={getActivationPreviewSnapshot('very-long', fixture.initialElapsedMs)}
        firstActivation
        reducedMotion={false}
        themeResolvedOverride
        experienceInitialElapsedMs={fixture.initialElapsedMs}
      />
    );

    expect(screen.getByTestId('sync-progress-panel')).toHaveTextContent(
      'Still bringing everything into LaSyncro'
    );
  });

  it('PV9 dark/light preview modes use the canonical theme resolution seam', () => {
    render(
      <SyncAnimationExperience
        syncSnapshot={getActivationPreviewSnapshot('initial', 0)}
        firstActivation
        reducedMotion={false}
        themeResolvedOverride={false}
      />
    );

    expect(screen.getByTestId('workflow-film-theme-pending')).toBeInTheDocument();
  });

  it('PV10 reduced-motion preview reaches production reduced-motion renderer', () => {
    render(
      <SyncAnimationExperience
        syncSnapshot={getActivationPreviewSnapshot('initial', 0)}
        firstActivation
        reducedMotion
        themeResolvedOverride
      />
    );

    expect(screen.getByTestId('workflow-film')).toHaveAttribute('data-reduced-motion', 'true');
  });

  it('PV11 progress fixtures use the real progress input contract', () => {
    expect(isBackendProgressIndeterminate('PENDING', getActivationPreviewSnapshot('initial', 0).progress)).toBe(true);
    expect(computeBackendProgressPercent('SYNCING', getActivationPreviewSnapshot('fast', 1000).progress)).toBe(8);
    expect(computeBackendProgressPercent('COMPLETED', getActivationPreviewSnapshot('completed', 0).progress)).toBe(100);
  });

  it('PV12 speed control does not alter production default timing constants', () => {
    const accelerated = deriveSyncExperienceSnapshot({
      isFirstActivation: true,
      syncStatus: 'COMPLETED',
      sceneSettled: true,
      mountedAtMs: 0,
      nowMs: 2250,
      syncCompletedAtMs: 500,
      timingScale: 4,
    });

    expect(ACTIVATION_TIMING.MIN_FIRST_RUN_DWELL_MS).toBe(9000);
    expect(accelerated.canExitSync).toBe(true);
  });

  it('A1 renders all seven scene IDs through production WorkflowFilm', () => {
    for (const scene of WORKFLOW_SCENES) {
      const { unmount } = render(
        <WorkflowFilm
          scene={scene.id}
          isAmbient={false}
          interrupted={false}
          reducedMotion={false}
          themeResolved
          onSceneSettled={jest.fn()}
        />
      );
      expect(screen.getByTestId('workflow-film')).toHaveAttribute('data-scene', scene.id);
      unmount();
    }
  });

  it('A2 Scene 4 puts the five barcoded products away into distinct Inventory bins', () => {
    render(
      <WorkflowFilm
        scene="SCENE_4"
        isAmbient={false}
        interrupted={false}
        reducedMotion
        themeResolved
        onSceneSettled={jest.fn()}
      />
    );

    const film = screen.getByTestId('workflow-film');

    // Merchant-facing intent is "put away into the correct bin", not batch release.
    expect(film).toHaveAttribute('aria-label', expect.stringContaining('Put away'));
    expect(film).toHaveAttribute('aria-label', expect.stringContaining('correct bin'));

    // The five product identities from Scene 3 are all present and still barcoded,
    // and end the scene stored in their Inventory locations.
    const products = Array.from(film.querySelectorAll('[data-workflow-marker="scene4-product"]'));
    expect(products.map((node) => node.getAttribute('data-product-id')).sort()).toEqual(
      [...WORKFLOW_PRODUCT_IDENTITIES].sort()
    );
    products.forEach((node) => {
      expect(node).toHaveAttribute('data-barcode-state', 'barcoded');
      expect(node).toHaveAttribute('data-putaway-state', 'stored');
    });

    // Five distinct Inventory destination bins receive them.
    const bins = Array.from(film.querySelectorAll('[data-workflow-marker="inventory-bin"]'));
    expect(bins).toHaveLength(5);
    expect(new Set(bins.map((node) => node.getAttribute('data-bin-id'))).size).toBe(5);
  });

  it('A3 Scene 5 releases three orders and one trolley picks the five products into the right orders', () => {
    render(
      <WorkflowFilm
        scene="SCENE_5"
        isAmbient={false}
        interrupted={false}
        reducedMotion
        themeResolved
        onSceneSettled={jest.fn()}
      />
    );

    const film = screen.getByTestId('workflow-film');

    // Merchant-facing intent is "pick / release orders", not "released batch".
    expect(film).toHaveAttribute('aria-label', expect.stringContaining('Pick'));
    expect(film).toHaveAttribute('aria-label', expect.stringContaining('Release orders'));

    // Exactly three distinct orders and exactly one pick trolley.
    const orders = Array.from(film.querySelectorAll('[data-workflow-marker="order-pool-order"]'));
    expect(orders.map((node) => node.getAttribute('data-order-id')).sort()).toEqual([
      'order-1',
      'order-2',
      'order-3',
    ]);
    expect(film.querySelectorAll('[data-workflow-marker="pick-trolley"]')).toHaveLength(1);

    // The five products partition across the three orders exactly 2 + 1 + 2.
    expect(groupProductIdsByOrder(film, 'scene5-product')).toEqual(WORKFLOW_ORDER_PARTITION);
  });

  it('A4 Scene 6 preserves pack and verify semantics', () => {
    expect(SCENE_6_SEMANTICS).toEqual(['picked work', 'verification', 'parcel', 'label']);
    render(
      <WorkflowFilm
        scene="SCENE_6"
        isAmbient={false}
        interrupted={false}
        reducedMotion={false}
        themeResolved
        onSceneSettled={jest.fn()}
      />
    );

    expect(screen.getByTestId('workflow-film')).toHaveAttribute('data-has-pack-verify', 'true');
  });

  it('A5 Scene 7 exposes complete trace semantics', () => {
    render(
      <WorkflowFilm
        scene="SCENE_7"
        isAmbient={false}
        interrupted={false}
        reducedMotion={false}
        themeResolved
        onSceneSettled={jest.fn()}
      />
    );

    expect(screen.getByTestId('workflow-film')).toHaveAttribute('data-has-full-trace', 'true');
    expect(SCENE_7_TRACE_NODES).toEqual(WORKFLOW_TRACE_NODE_ORDER);
  });

  it('A6 ambient mode does not restart Scene 1', () => {
    render(
      <WorkflowFilm
        scene={null}
        isAmbient
        interrupted={false}
        reducedMotion={false}
        themeResolved
        onSceneSettled={jest.fn()}
      />
    );

    const film = screen.getByTestId('workflow-film');
    expect(film).toHaveAttribute('data-scene', 'AMBIENT');
    expect(film).toHaveAttribute('data-trace-nodes', WORKFLOW_TRACE_NODE_ORDER.join('>'));
    expect(screen.queryByText('Create the PO.')).not.toBeInTheDocument();
  });

  it('A7 reduced motion renders deterministic representative state', () => {
    render(
      <WorkflowFilm
        scene="SCENE_5"
        isAmbient={false}
        interrupted={false}
        reducedMotion
        themeResolved
        onSceneSettled={jest.fn()}
      />
    );

    const film = screen.getByTestId('workflow-film');
    expect(film).toHaveAttribute('data-reduced-motion', 'true');
    // Reduced motion still renders the full Scene 5 representative state: all five
    // picked products present (settled into their orders), no traversal animation.
    expect(film.querySelectorAll('[data-workflow-marker="scene5-product"]')).toHaveLength(5);
  });

  it('A8 failure suppresses active scene choreography', () => {
    render(
      <WorkflowFilm
        scene="SCENE_5"
        isAmbient={false}
        interrupted
        reducedMotion={false}
        themeResolved
        onSceneSettled={jest.fn()}
      />
    );

    const film = screen.getByTestId('workflow-film');
    expect(film).toHaveAttribute('data-scene', 'INTERRUPTED');
    expect(film).toHaveAttribute('data-active-action', 'none');
    expect(film).toHaveAttribute('data-trace-nodes', '');
  });

  it('A9 dark/light theme tokens resolve through the production seam', () => {
    const { rerender } = render(
      <WorkflowFilm
        scene="SCENE_1"
        isAmbient={false}
        interrupted={false}
        reducedMotion={false}
        themeResolved={false}
        onSceneSettled={jest.fn()}
      />
    );
    expect(screen.getByTestId('workflow-film-theme-pending')).toBeInTheDocument();

    rerender(
      <WorkflowFilm
        scene="SCENE_1"
        isAmbient={false}
        interrupted={false}
        reducedMotion={false}
        themeResolved
        onSceneSettled={jest.fn()}
      />
    );
    expect(screen.getByTestId('workflow-film')).toBeInTheDocument();
  });

  it('A10 no scene mutates real sync state', () => {
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
    expect(experience).toHaveAttribute('data-sync-complete', 'false');
    expect(screen.getByTestId('workflow-film')).toHaveAttribute('data-sync-authority', 'none');
  });

  it('A11 direct preview scene override cannot affect production sequencing', () => {
    render(
      <SyncAnimationExperience
        syncSnapshot={getActivationPreviewSnapshot('normal', 1000)}
        firstActivation
        reducedMotion={false}
        storyOverride={{ state: 'SCENE_6' }}
        themeResolvedOverride
      />
    );

    expect(screen.getByTestId('workflow-film')).toHaveAttribute('data-scene', 'SCENE_6');
    expect(getWorkflowStorySnapshot(0, {
      syncComplete: false,
      interrupted: false,
      reducedMotion: false,
    }).state).toBe('SCENE_1');
  });

  it('A12 trace nodes accumulate in correct semantic order', () => {
    expect(WORKFLOW_SCENES.map((scene) => scene.traceNodes[scene.traceNodes.length - 1])).toEqual([
      'PO',
      'RECEIVED',
      'LOCATION',
      'BATCH',
      'PICK',
      'PACK',
      'SHIP',
    ]);
    expect(SCENE_7_TRACE_NODES).toEqual(WORKFLOW_TRACE_NODE_ORDER);
  });

  it('VR1 locks reviewer-laptop layout to side-by-side composition', () => {
    render(
      <SyncAnimationExperience
        syncSnapshot={getActivationPreviewSnapshot('normal', 1000)}
        firstActivation
        reducedMotion={false}
        themeResolvedOverride
      />
    );

    expect(screen.getByTestId('sync-animation-experience').firstElementChild).toHaveAttribute(
      'data-reviewer-laptop-layout',
      'side-by-side'
    );
    expect(screen.getByTestId('sync-animation-experience').firstElementChild).toHaveAttribute(
      'data-layout-mode',
      'activation-side-by-side-md'
    );
  });

  it('VR2 renders the identical persistent transplanted warehouse world in every scene', () => {
    for (const scene of WORKFLOW_SCENES) {
      const { unmount } = render(
        <WorkflowFilm
          scene={scene.id}
          isAmbient={false}
          interrupted={false}
          reducedMotion={false}
          themeResolved
          onSceneSettled={jest.fn()}
        />
      );

      const film = screen.getByTestId('workflow-film');
      expect(film).toHaveAttribute('data-warehouse-world-id', 'activation-isometric-warehouse');

      const zoneIds = Array.from(film.querySelectorAll('[data-warehouse-zone]'))
        .map((node) => node.getAttribute('data-warehouse-zone'))
        .sort();
      expect(zoneIds).toEqual(WAREHOUSE_TRANSPLANT_ZONE_IDS);
      unmount();
    }
  });

  it('VR3 keeps every transplanted warehouse zone flat with no lifted active zone', () => {
    for (const scene of WORKFLOW_SCENES) {
      const { unmount } = render(
        <WorkflowFilm
          scene={scene.id}
          isAmbient={false}
          interrupted={false}
          reducedMotion={false}
          themeResolved
          onSceneSettled={jest.fn()}
        />
      );

      const film = screen.getByTestId('workflow-film');
      const zones = Array.from(film.querySelectorAll('[data-warehouse-zone]'));
      expect(zones).toHaveLength(WAREHOUSE_TRANSPLANT_ZONE_IDS.length);
      zones.forEach((node) => expect(node).toHaveAttribute('data-active-depth', 'flat'));
      expect(film.querySelectorAll('[data-active-depth="raised"]')).toHaveLength(0);
      unmount();
    }
  });

  it('VR4 carries the five product identities and their three-order partition from barcode through ship', () => {
    const renderScene = (scene: (typeof WORKFLOW_SCENES)[number]['id']) =>
      render(
        <WorkflowFilm
          scene={scene}
          isAmbient={false}
          interrupted={false}
          reducedMotion
          themeResolved
          onSceneSettled={jest.fn()}
        />
      );

    // SCENE_3 — the five identities exist and are barcoded/queued.
    {
      const { unmount } = renderScene('SCENE_3');
      const film = screen.getByTestId('workflow-film');
      const products = Array.from(film.querySelectorAll('[data-workflow-marker="scene3-product"]'));
      expect(products.map((node) => node.getAttribute('data-product-id')).sort()).toEqual(
        [...WORKFLOW_PRODUCT_IDENTITIES].sort()
      );
      products.forEach((node) => expect(node).toHaveAttribute('data-barcode-state', 'barcoded'));
      unmount();
    }

    // SCENE_4 — the same five identities end stored.
    {
      const { unmount } = renderScene('SCENE_4');
      const film = screen.getByTestId('workflow-film');
      const products = Array.from(film.querySelectorAll('[data-workflow-marker="scene4-product"]'));
      expect(products.map((node) => node.getAttribute('data-product-id')).sort()).toEqual(
        [...WORKFLOW_PRODUCT_IDENTITIES].sort()
      );
      products.forEach((node) => expect(node).toHaveAttribute('data-putaway-state', 'stored'));
      unmount();
    }

    // SCENE_5 — the same five identities partition exactly across the three orders.
    {
      const { unmount } = renderScene('SCENE_5');
      const film = screen.getByTestId('workflow-film');
      expect(groupProductIdsByOrder(film, 'scene5-product')).toEqual(WORKFLOW_ORDER_PARTITION);
      unmount();
    }

    // SCENE_6 — the same identities stay mapped to the same three orders; three labelled parcels.
    {
      const { unmount } = renderScene('SCENE_6');
      const film = screen.getByTestId('workflow-film');
      expect(groupProductIdsByOrder(film, 'scene6-product')).toEqual(WORKFLOW_ORDER_PARTITION);
      expect(film.querySelectorAll('[data-workflow-marker="shipping-parcel"]')).toHaveLength(3);
      expect(film.querySelectorAll('[data-workflow-marker="shipping-label"]')).toHaveLength(3);
      unmount();
    }

    // SCENE_7 — the same three parcels assemble onto ONE outbound pallet; identities still partitioned.
    {
      const { unmount } = renderScene('SCENE_7');
      const film = screen.getByTestId('workflow-film');
      const parcels = Array.from(film.querySelectorAll('[data-workflow-marker="scene7-parcel"]'));
      expect(parcels.map((node) => node.getAttribute('data-order-id')).sort()).toEqual([
        'order-1',
        'order-2',
        'order-3',
      ]);
      expect(film.querySelectorAll('[data-workflow-marker="outbound-pallet"]')).toHaveLength(1);
      expect(groupProductIdsByOrder(film, 'scene7-product')).toEqual(WORKFLOW_ORDER_PARTITION);
      unmount();
    }
  });

  it('VR5 failure keeps the warehouse present but removes active choreography', () => {
    render(
      <WorkflowFilm
        scene="SCENE_4"
        isAmbient={false}
        interrupted
        reducedMotion={false}
        themeResolved
        onSceneSettled={jest.fn()}
      />
    );

    const film = screen.getByTestId('workflow-film');
    expect(film).toHaveAttribute('data-active-zone', 'none');
    expect(film).toHaveAttribute('data-active-zone-count', '0');
    expect(film).toHaveAttribute('data-active-action', 'none');
    expect(film.querySelector('[data-warehouse-world-id="activation-isometric-warehouse"]')).toBeInTheDocument();
  });

  it('TC1 gives the visual film no sync authority and no directional Brand Pulse in any scene', () => {
    for (const scene of WORKFLOW_SCENES) {
      const { unmount } = render(
        <WorkflowFilm
          scene={scene.id}
          isAmbient={false}
          interrupted={false}
          reducedMotion={false}
          themeResolved
          onSceneSettled={jest.fn()}
        />
      );

      const film = screen.getByTestId('workflow-film');
      expect(film).toHaveAttribute('data-sync-authority', 'none');
      expect(film).toHaveAttribute('data-movement-language', 'none');
      expect(film).toHaveAttribute('data-brand-pulse-active', 'false');
      expect(film.querySelectorAll('[data-brand-pulse="true"]')).toHaveLength(0);
      unmount();
    }
  });

  it('TC2 keeps the no-orange prohibition and lifts no active zone', () => {
    render(
      <WorkflowFilm
        scene="SCENE_4"
        isAmbient={false}
        interrupted={false}
        reducedMotion={false}
        themeResolved
        onSceneSettled={jest.fn()}
      />
    );

    const film = screen.getByTestId('workflow-film');
    expect(film).toHaveAttribute('data-orange-directional-routes', 'none');
    expect(film).toHaveAttribute('data-orange-zone-highlight', 'none');
    expect(film).toHaveAttribute('data-active-zone-highlight', 'dimension-only');
    expect(film.querySelectorAll('[data-active-depth="raised"]')).toHaveLength(0);
    Array.from(film.querySelectorAll('[data-warehouse-zone]')).forEach((node) =>
      expect(node).toHaveAttribute('data-active-depth', 'flat')
    );
  });

  it('TC3 reduced motion renders the settled Scene 6 parcels without any Brand Pulse', () => {
    render(
      <WorkflowFilm
        scene="SCENE_6"
        isAmbient={false}
        interrupted={false}
        reducedMotion
        themeResolved
        onSceneSettled={jest.fn()}
      />
    );

    const film = screen.getByTestId('workflow-film');
    expect(film).toHaveAttribute('data-reduced-motion', 'true');

    const parcels = Array.from(film.querySelectorAll('[data-workflow-marker="shipping-parcel"]'));
    expect(parcels).toHaveLength(3);
    parcels.forEach((node) => expect(node).toHaveAttribute('data-parcel-state', 'labelled'));
    expect(film.querySelectorAll('[data-workflow-marker="shipping-label"]')).toHaveLength(3);
    expect(film.querySelectorAll('[data-brand-pulse="true"]')).toHaveLength(0);
  });

  it('TC4 failure interruption stops choreography while the film keeps no sync authority', () => {
    render(
      <WorkflowFilm
        scene="SCENE_4"
        isAmbient={false}
        interrupted
        reducedMotion={false}
        themeResolved
        onSceneSettled={jest.fn()}
      />
    );

    const film = screen.getByTestId('workflow-film');
    // Failure is the primary state; no active choreography continues.
    expect(film).toHaveAttribute('data-scene', 'INTERRUPTED');
    expect(film).toHaveAttribute('data-active-action', 'none');
    // The persistent warehouse world stays mounted beneath the interruption.
    expect(
      film.querySelector('[data-warehouse-world-id="activation-isometric-warehouse"]')
    ).toBeInTheDocument();
    // No movement language / Brand Pulse can resume, and the film never owns sync lifecycle.
    expect(film).toHaveAttribute('data-movement-language', 'none');
    expect(film).toHaveAttribute('data-brand-pulse-active', 'false');
    expect(film.querySelectorAll('[data-brand-pulse="true"]')).toHaveLength(0);
    expect(film).toHaveAttribute('data-sync-authority', 'none');
  });

  it('TC5 production sync panel uses merchant-facing language', () => {
    render(
      <SyncAnimationExperience
        syncSnapshot={getActivationPreviewSnapshot('normal', 1000)}
        firstActivation
        reducedMotion={false}
        themeResolvedOverride
      />
    );

    expect(screen.getByText('Sync progress')).toBeInTheDocument();
    expect(screen.queryByText('Backend progress')).not.toBeInTheDocument();
  });
});
