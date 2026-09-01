import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  ButtonGroup,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
} from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import { useLocation } from 'react-router-dom';
import { RotateCcw, StepForward, CheckCircle2, AlertTriangle } from 'lucide-react';
import { ThemeMode } from 'config';
import {
  ACTIVATION_PREVIEW_FIXTURES,
  getActivationPreviewSnapshot,
} from './activationPreviewFixtures';
import type { ActivationPreviewScenarioId } from './activationPreviewFixtures';
import {
  WORKFLOW_SCENE_IDS,
} from './activationMotionTokens';
import type { WorkflowSceneId } from './activationMotionTokens';
import {
  SyncAnimationExperience,
} from './SyncAnimationExperience';
import type {
  StoryPreviewOverride,
  SyncAnimationDiagnostics,
} from './SyncAnimationExperience';

type StoryControl =
  | 'automatic'
  | WorkflowSceneId
  | 'AMBIENT'
  | 'INTERRUPTED'
  | 'COMPLETION';
type ThemeControl = 'dark' | 'light' | 'unresolved';
type ViewportControl = 'wide' | 'reviewer-laptop' | 'tablet' | 'mobile';

const SCENARIO_IDS = Object.keys(ACTIVATION_PREVIEW_FIXTURES) as ActivationPreviewScenarioId[];
const STORY_CONTROLS: StoryControl[] = [
  'automatic',
  ...WORKFLOW_SCENE_IDS,
  'AMBIENT',
  'INTERRUPTED',
  'COMPLETION',
];
const SPEEDS = [1, 2, 4] as const;

const VIEWPORTS: Record<ViewportControl, { label: string; width: number | string }> = {
  wide: { label: 'Wide', width: 1440 },
  'reviewer-laptop': { label: 'Reviewer laptop', width: 1024 },
  tablet: { label: 'Tablet', width: 760 },
  mobile: { label: 'Mobile', width: 390 },
};

function storyOverrideFromControl(story: StoryControl): StoryPreviewOverride | null {
  return story === 'automatic' ? null : { state: story };
}

function nextStoryControl(story: StoryControl): StoryControl {
  const index = STORY_CONTROLS.indexOf(story);
  const nextIndex = index < 0 ? 1 : Math.min(index + 1, STORY_CONTROLS.length - 1);
  return STORY_CONTROLS[nextIndex] === 'automatic' ? 'SCENE_1' : STORY_CONTROLS[nextIndex];
}

function readParam<T extends string>(params: URLSearchParams, name: string, fallback: T, allowed: readonly T[]): T {
  const value = params.get(name) as T | null;
  return value && allowed.includes(value) ? value : fallback;
}

/**
 * Non-visible, non-layout machine-readable seam. The merchant/post-OAuth
 * experience shows no diagnostics; this keeps the same runtime facts available
 * to a harness (or manual DOM inspection) as data-* attributes on a
 * display:none node, without consuming any vertical space during visual
 * certification.
 */
function DiagnosticsSeam({ diagnostics }: { diagnostics: SyncAnimationDiagnostics }) {
  return (
    <Box
      data-testid="activation-preview-diagnostics"
      aria-hidden="true"
      data-sync-status={diagnostics.syncStatus}
      data-story-state={diagnostics.storyState}
      data-first-activation={String(diagnostics.firstActivation)}
      data-dwell-satisfied={String(diagnostics.dwellSatisfied)}
      data-sync-complete={String(diagnostics.syncComplete)}
      data-post-sync-resolve-active={String(diagnostics.postSyncResolveActive)}
      data-completion-transition-active={String(diagnostics.completionTransitionActive)}
      data-very-long-sync={String(diagnostics.veryLongSync)}
      data-reduced-motion={String(diagnostics.reducedMotion)}
      data-resolved-theme={diagnostics.resolvedTheme}
      sx={{ display: 'none' }}
    />
  );
}

export default function ActivationExperiencePreview() {
  const { setMode } = useColorScheme();
  const location = useLocation();
  const initialParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [scenario, setScenario] = useState<ActivationPreviewScenarioId>(() =>
    readParam(initialParams, 'scenario', 'tiny', SCENARIO_IDS)
  );
  const [story, setStory] = useState<StoryControl>(() =>
    readParam(initialParams, 'story', 'automatic', STORY_CONTROLS)
  );
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(() => {
    const parsed = Number(initialParams.get('speed'));
    return SPEEDS.includes(parsed as (typeof SPEEDS)[number])
      ? parsed as (typeof SPEEDS)[number]
      : 1;
  });
  const [themeControl, setThemeControl] = useState<ThemeControl>(() =>
    readParam(initialParams, 'theme', 'dark', ['dark', 'light', 'unresolved'] as const)
  );
  const [reducedMotion, setReducedMotion] = useState(() => initialParams.get('motion') === 'reduced');
  const [viewport, setViewport] = useState<ViewportControl>(() =>
    readParam(initialParams, 'viewport', 'reviewer-laptop', ['wide', 'reviewer-laptop', 'tablet', 'mobile'] as const)
  );
  const [restartKey, setRestartKey] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [forcedStatus, setForcedStatus] = useState<'COMPLETED' | 'FAILED' | null>(null);

  const fixture = ACTIVATION_PREVIEW_FIXTURES[scenario];

  useEffect(() => {
    setMode(
      themeControl === 'light'
        ? ThemeMode.LIGHT
        : themeControl === 'dark'
          ? ThemeMode.DARK
          : ThemeMode.SYSTEM
    );
  }, [setMode, themeControl]);

  useEffect(() => {
    const startedAt = Date.now();
    const baseElapsed = fixture.initialElapsedMs;
    setElapsedMs(baseElapsed);
    const timer = setInterval(() => {
      setElapsedMs(baseElapsed + Math.round((Date.now() - startedAt) * speed));
    }, 100);
    return () => clearInterval(timer);
  }, [fixture.initialElapsedMs, restartKey, speed]);

  const snapshot = useMemo(
    () => getActivationPreviewSnapshot(scenario, elapsedMs, forcedStatus),
    [elapsedMs, forcedStatus, scenario]
  );
  const previewWidth = VIEWPORTS[viewport].width;
  const storyOverride = storyOverrideFromControl(story);

  return (
    <Box
      data-testid="activation-preview"
      sx={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        bgcolor: 'var(--bg)',
        color: 'var(--ink)',
      }}
    >
      <Box
        sx={{
          flexShrink: 0,
          zIndex: 1500,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 0.75,
          px: 1.5,
          py: 1,
          borderBottom: '1px solid var(--rule)',
          bgcolor: 'var(--surface)',
        }}
      >
        <FormControl size="small" sx={{ minWidth: 146 }}>
          <InputLabel id="activation-preview-scenario">Scenario</InputLabel>
          <Select
            labelId="activation-preview-scenario"
            label="Scenario"
            value={scenario}
            onChange={(event) => {
              setScenario(event.target.value as ActivationPreviewScenarioId);
              setForcedStatus(null);
              setRestartKey((key) => key + 1);
            }}
          >
            {SCENARIO_IDS.map((id) => (
              <MenuItem key={id} value={id}>{ACTIVATION_PREVIEW_FIXTURES[id].label}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 142 }}>
          <InputLabel id="activation-preview-story">Story</InputLabel>
          <Select
            labelId="activation-preview-story"
            label="Story"
            value={story}
            onChange={(event) => setStory(event.target.value as StoryControl)}
          >
            {STORY_CONTROLS.map((id) => (
              <MenuItem key={id} value={id}>{id === 'automatic' ? 'Automatic' : id.replace('_', ' ')}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <ButtonGroup size="small" aria-label="Timing speed">
          {SPEEDS.map((value) => (
            <Button
              key={value}
              variant={speed === value ? 'contained' : 'outlined'}
              onClick={() => setSpeed(value)}
            >
              {value}x
            </Button>
          ))}
        </ButtonGroup>

        <ButtonGroup size="small" aria-label="Theme mode">
          {(['dark', 'light', 'unresolved'] as const).map((value) => (
            <Button
              key={value}
              variant={themeControl === value ? 'contained' : 'outlined'}
              onClick={() => setThemeControl(value)}
            >
              {value}
            </Button>
          ))}
        </ButtonGroup>

        <Button
          size="small"
          variant={reducedMotion ? 'contained' : 'outlined'}
          onClick={() => setReducedMotion((value) => !value)}
        >
          Reduced motion
        </Button>

        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel id="activation-preview-viewport">Viewport</InputLabel>
          <Select
            labelId="activation-preview-viewport"
            label="Viewport"
            value={viewport}
            onChange={(event) => setViewport(event.target.value as ViewportControl)}
          >
            {(Object.keys(VIEWPORTS) as ViewportControl[]).map((id) => (
              <MenuItem key={id} value={id}>{VIEWPORTS[id].label}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <Button size="small" startIcon={<RotateCcw size={15} />} onClick={() => {
          setForcedStatus(null);
          setRestartKey((key) => key + 1);
        }}>
          Restart
        </Button>
        <Button size="small" startIcon={<StepForward size={15} />} onClick={() => setStory(nextStoryControl(story))}>
          Next scene
        </Button>
        <Button size="small" startIcon={<CheckCircle2 size={15} />} onClick={() => setForcedStatus('COMPLETED')}>
          Complete
        </Button>
        <Button size="small" color="error" startIcon={<AlertTriangle size={15} />} onClick={() => setForcedStatus('FAILED')}>
          Fail
        </Button>
      </Box>

      <Box
        sx={{
          flex: '1 1 auto',
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          width: previewWidth,
          maxWidth: '100%',
          mx: 'auto',
          borderLeft: '1px dashed var(--rule)',
          borderRight: '1px dashed var(--rule)',
        }}
      >
        <SyncAnimationExperience
          key={`${scenario}:${restartKey}`}
          syncSnapshot={snapshot}
          firstActivation={fixture.firstActivation}
          reducedMotion={reducedMotion}
          timingScale={speed}
          experienceInitialElapsedMs={fixture.initialElapsedMs}
          storyOverride={storyOverride}
          themeResolvedOverride={themeControl === 'unresolved' ? false : undefined}
          diagnostics={(diagnostics) => <DiagnosticsSeam diagnostics={diagnostics} />}
        />
      </Box>
      <Box sx={{ flexShrink: 0, px: 2, py: 0.75, color: 'var(--ink-3)', fontSize: 11, borderTop: '1px solid var(--rule)' }}>
        Certification ladder: L1 visual harness · L2 deterministic fixture · L3 QA/dev OAuth milestone · L4 production reviewer path
      </Box>
    </Box>
  );
}
