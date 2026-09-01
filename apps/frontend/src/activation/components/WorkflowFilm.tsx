import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import {
  ACTIVATION_COLORS,
  ACTIVATION_TIMING,
  WORKFLOW_CLOSING_LINES,
  WORKFLOW_TRACE_NODE_ORDER,
  getWorkflowSceneById,
  getWorkflowTraceNodesForScene,
} from '../activationMotionTokens';
import type { WorkflowSceneId } from '../activationMotionTokens';
import {
  INBOUND_PALLET,
  INBOUND_TRUCK,
  PICK_GRID,
  PLANE_TO_OVERLAY_X,
  PLANE_TO_OVERLAY_Y,
  SCENE1_PO_CARD,
  SCENE1_PO_CREATE_FRACTION,
  SCENE1_PO_DESK_ANCHOR,
  SCENE2_PO_CONTEXT_OPACITY,
  SCENE2_RECEIVE_PRODUCTS,
  SCENE3_PALLET_CARTONS,
  SCENE3_PHASE_THRESHOLDS,
  SCENE3_PHASES,
  SCENE3_PRODUCT_ROUTE,
  SCENE3_PRODUCTS,
  SCENE4_PHASES,
  SCENE4_PHASE_THRESHOLDS,
  SCENE4_PUTAWAY,
  SCENE5_ORDERS,
  SCENE5_PHASES,
  SCENE5_PHASE_THRESHOLDS,
  SCENE5_PICK_SEQUENCE,
  SCENE5_TROLLEY_PICK,
  SCENE6_PACK_LABEL,
  SCENE6_PHASES,
  SCENE6_PHASE_THRESHOLDS,
  SCENE7_PHASES,
  SCENE7_PHASE_THRESHOLDS,
  SCENE7_SHIP_DISPATCH,
  WAREHOUSE_CAMERA_TRANSITION,
  WAREHOUSE_FIT,
  WAREHOUSE_GATE,
  WAREHOUSE_NEUTRAL_CAMERA,
  WAREHOUSE_PLANE,
  WAREHOUSE_YARD_STRIP,
  WAREHOUSE_ZONES,
} from '../workflowWarehouseGeometry';

export interface WorkflowFilmProps {
  scene: WorkflowSceneId | null;
  isAmbient: boolean;
  interrupted: boolean;
  reducedMotion: boolean;
  themeResolved: boolean;
  onSceneSettled: () => void;
}

function sceneAtLeast(scene: WorkflowSceneId | null, threshold: WorkflowSceneId) {
  if (!scene) return true;
  const sceneNodes = getWorkflowSceneById(scene).traceNodes;
  const thresholdNodes = getWorkflowSceneById(threshold).traceNodes;
  const sceneLastNode = sceneNodes[sceneNodes.length - 1] ?? 'PO';
  const thresholdLastNode = thresholdNodes[thresholdNodes.length - 1] ?? 'PO';
  return WORKFLOW_TRACE_NODE_ORDER.indexOf(sceneLastNode) >=
    WORKFLOW_TRACE_NODE_ORDER.indexOf(thresholdLastNode);
}

/** Root data-* semantic markers (kept as machine-readable seams; no legacy visuals). */
function markerForScene(scene: WorkflowSceneId | null, isAmbient: boolean, marker: string) {
  if (isAmbient) return true;
  switch (marker) {
    case 'pack-verify':
      return sceneAtLeast(scene, 'SCENE_6');
    case 'full-trace':
      return sceneAtLeast(scene, 'SCENE_7');
    default:
      return false;
  }
}

function activeZoneFor(scene: WorkflowSceneId | null, isAmbient: boolean, interrupted: boolean) {
  if (interrupted) return 'none';
  if (isAmbient || !scene) return 'ambient-complete';
  return 'transplant';
}

const IsoBlock = ({
  x,
  y,
  w,
  d,
  h,
  className,
  marker,
}: {
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  className: string;
  marker?: string;
}) => (
  <g data-workflow-marker={marker}>
    <path d={`M${x},${y} L${x + w},${y - d} L${x + w + d},${y} L${x + d},${y + d} Z`} className={`${className} iso-top`} />
    <path d={`M${x},${y} L${x + d},${y + d} L${x + d},${y + d + h} L${x},${y + h} Z`} className={`${className} iso-left`} />
    <path d={`M${x + d},${y + d} L${x + w + d},${y} L${x + w + d},${y + h} L${x + d},${y + d + h} Z`} className={`${className} iso-right`} />
  </g>
);

const ProductToken = ({
  kind,
  x,
  y,
  scale = 1,
  muted = false,
  marker,
}: {
  kind: 'bottle' | 'pouch' | 'box' | 'carton' | 'jar';
  x: number;
  y: number;
  scale?: number;
  muted?: boolean;
  marker: string;
}) => (
  <g
    transform={`translate(${x} ${y}) scale(${scale})`}
    className={muted ? 'product-token product-muted' : 'product-token'}
    data-product-id={kind}
    data-workflow-marker={marker}
  >
    {kind === 'bottle' && (
      <>
        <ellipse cx="9" cy="4" rx="8" ry="4" className="product-top" />
        <rect x="1" y="4" width="16" height="24" rx="5" className="product-body" />
        <rect x="5" y="12" width="8" height="6" rx="1.5" className="product-detail" />
      </>
    )}
    {kind === 'pouch' && (
      <>
        <path d="M0 8 L22 2 L28 26 L6 32 Z" className="product-body" />
        <path d="M5 11 L23 6" className="product-detail-stroke" />
      </>
    )}
    {kind === 'box' && (
      <IsoBlock x={0} y={8} w={24} d={8} h={18} className="product-box" />
    )}
    {kind === 'carton' && (
      <>
        <rect x="2" y="7" width="18" height="17" rx="1.5" className="product-body" />
        <path d="M2 13 L20 13M11 7 L11 24" className="product-detail-stroke" />
      </>
    )}
    {kind === 'jar' && (
      <>
        <ellipse cx="9" cy="7" rx="7" ry="3" className="product-top" />
        <rect x="2" y="7" width="14" height="18" rx="4" className="product-body" />
        <rect x="5" y="13" width="8" height="5" rx="1" className="product-detail" />
      </>
    )}
  </g>
);

const ProductSet = ({
  x,
  y,
  scale = 1,
  muted = false,
  marker,
}: {
  x: number;
  y: number;
  scale?: number;
  muted?: boolean;
  marker: string;
}) => (
  <g data-workflow-marker={marker}>
    <ProductToken kind="bottle" x={x} y={y + 2} scale={scale} muted={muted} marker={`${marker}-bottle`} />
    <ProductToken kind="pouch" x={x + 28 * scale} y={y + 8 * scale} scale={scale} muted={muted} marker={`${marker}-pouch`} />
    <ProductToken kind="box" x={x + 64 * scale} y={y} scale={scale} muted={muted} marker={`${marker}-box`} />
  </g>
);

const Barcode = ({ x, y }: { x: number; y: number }) => (
  <g className="scene3-barcode" transform={`translate(${x} ${y})`}>
    <rect x="-3" y="-9" width="15" height="7" rx="1" className="barcode-plate" />
    {[-1.5, 0.6, 2.6, 5, 7, 9.6].map((bx, k) => (
      <rect key={k} x={bx} y="-8" width={k % 2 ? 0.9 : 1.7} height="5" className="barcode-line" />
    ))}
  </g>
);

/**
 * Static physical decor that lives inside a landing zone div (dock doors, PO desk
 * table, pack shelves, outbound kerb nub, inventory pick-map grid). Verbatim
 * geometry from packages/landing-page/index.html lines 847-945.
 */
const ZoneDecor: React.FC<{ id: string }> = ({ id }) => {
  switch (id) {
    case 'admin':
      return (
        <div style={{ position: 'absolute', left: 24, bottom: 22, width: 70, height: 30, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 3, background: 'rgba(255,255,255,0.04)' }} />
      );
    case 'dock':
      return (
        <>
          <div style={{ position: 'absolute', left: -1, top: 44, width: 8, height: 52, background: 'rgba(255,255,255,0.10)', borderRadius: 2 }} />
          <div style={{ position: 'absolute', left: -1, top: 120, width: 8, height: 52, background: 'rgba(255,255,255,0.10)', borderRadius: 2 }} />
        </>
      );
    case 'pack':
      return (
        <>
          {[40, 86, 132].map((top) => (
            <div key={top} style={{ position: 'absolute', left: 20, top, width: 80, height: 22, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 3, background: 'rgba(255,255,255,0.04)' }} />
          ))}
        </>
      );
    case 'outbound':
      return (
        <div style={{ position: 'absolute', left: 36, bottom: -1, width: 52, height: 8, background: 'rgba(255,255,255,0.10)', borderRadius: 2 }} />
      );
    case 'shelves':
      return (
        <>
          <div className="zone-sublabel">Pick map</div>
          <div className="pick-grid">
            {PICK_GRID.columns.map((column, columnIndex) => (
              <div className="pick-column" key={columnIndex}>
                {column.map((modifier, slotIndex) => (
                  <div key={slotIndex} className={modifier ? `pick-slot ${modifier}` : 'pick-slot'} />
                ))}
              </div>
            ))}
          </div>
        </>
      );
    default:
      return null;
  }
};

type Scene3Phase = (typeof SCENE3_PHASES)[number];
type Scene4Phase = (typeof SCENE4_PHASES)[number];
type Scene5Phase = (typeof SCENE5_PHASES)[number];
type Scene6Phase = (typeof SCENE6_PHASES)[number];
type Scene7Phase = (typeof SCENE7_PHASES)[number];

export const WorkflowFilm: React.FC<WorkflowFilmProps> = ({
  scene,
  isAmbient,
  interrupted,
  reducedMotion,
  themeResolved,
  onSceneSettled,
}) => {
  const sceneDefinition = scene ? getWorkflowSceneById(scene) : null;
  const visualScene = interrupted ? null : scene;
  const traceNodes = useMemo(
    () => interrupted ? [] : getWorkflowTraceNodesForScene(isAmbient ? null : visualScene),
    [interrupted, isAmbient, visualScene]
  );
  const activeZone = activeZoneFor(visualScene, isAmbient, interrupted);
  const activeZoneCount = visualScene && !isAmbient && !interrupted ? 1 : 0;
  const isScene1 = !isAmbient && !interrupted && visualScene === 'SCENE_1';
  const isScene2 = !isAmbient && !interrupted && visualScene === 'SCENE_2';
  const isScene3 = !isAmbient && !interrupted && visualScene === 'SCENE_3';
  const isScene4 = !isAmbient && !interrupted && visualScene === 'SCENE_4';
  const isScene5 = !isAmbient && !interrupted && visualScene === 'SCENE_5';
  const isScene6 = !isAmbient && !interrupted && visualScene === 'SCENE_6';
  const isScene7 = !isAmbient && !interrupted && visualScene === 'SCENE_7';
  // Single per-scene choreography timelines (display-only, not backend sync).
  const scene1DurationMs = getWorkflowSceneById('SCENE_1').durationMs;
  const scene2DurationMs = getWorkflowSceneById('SCENE_2').durationMs;
  const scene3DurationMs = getWorkflowSceneById('SCENE_3').durationMs;
  const scene4DurationMs = getWorkflowSceneById('SCENE_4').durationMs;
  const scene5DurationMs = getWorkflowSceneById('SCENE_5').durationMs;
  const scene6DurationMs = getWorkflowSceneById('SCENE_6').durationMs;
  const scene7DurationMs = getWorkflowSceneById('SCENE_7').durationMs;
  const truckArriveMs = Math.round(scene1DurationMs * (1 - SCENE1_PO_CREATE_FRACTION));

  type Scene2Phase = 'offloading' | 'dock' | 'moving-to-receive' | 'receiving' | 'received';

  const rootRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState<number>(WAREHOUSE_FIT.INITIAL);
  const [scene1Phase, setScene1Phase] = useState<'creating' | 'truck' | 'settled'>('creating');
  const [scene2Phase, setScene2Phase] = useState<Scene2Phase>('offloading');
  const [scene3Phase, setScene3Phase] = useState<Scene3Phase>('p1-move');
  const [scene4Phase, setScene4Phase] = useState<Scene4Phase>('lead-in');
  const [scene5Phase, setScene5Phase] = useState<Scene5Phase>('pool-establish');
  const [scene6Phase, setScene6Phase] = useState<Scene6Phase>('establish');
  const [scene7Phase, setScene7Phase] = useState<Scene7Phase>('establish');

  const truckParked = reducedMotion || scene1Phase === 'settled';
  const poCreated = reducedMotion || scene1Phase !== 'creating';
  const showTruck = isScene2 || isScene3 || isScene4 || (isScene1 && (reducedMotion || scene1Phase !== 'creating'));
  const truckIsParked = isScene2 || isScene3 || isScene4 || truckParked;
  const palletReceived = reducedMotion || scene2Phase === 'received';
  const showPallet = isScene2 || isScene3 || isScene4;
  const scene3PhaseIndex = SCENE3_PHASES.indexOf(scene3Phase);
  const scene3Settled = reducedMotion || scene3Phase === 'settled';
  const scene4PhaseIndex = SCENE4_PHASES.indexOf(scene4Phase);
  const scene4Settled = reducedMotion || scene4Phase === 'settled';
  const scene5PhaseIndex = SCENE5_PHASES.indexOf(scene5Phase);
  const scene5Settled = reducedMotion || scene5Phase === 'settled';
  const scene6PhaseIndex = SCENE6_PHASES.indexOf(scene6Phase);
  const scene7PhaseIndex = SCENE7_PHASES.indexOf(scene7Phase);
  const scene7Settled = reducedMotion || scene7Phase === 'settled';
  const gateConfirming = isScene3 && !reducedMotion && scene3Phase.endsWith('-gate');
  const poContextual = isScene2 || isScene3 || isScene4;

  useEffect(() => {
    if (!isScene1) {
      setScene1Phase('creating');
      return;
    }
    if (reducedMotion || typeof requestAnimationFrame === 'undefined') {
      setScene1Phase('settled');
      return;
    }
    setScene1Phase('creating');
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const progress = (performance.now() - start) / scene1DurationMs;
      const next = progress >= 1 ? 'settled' : progress >= SCENE1_PO_CREATE_FRACTION ? 'truck' : 'creating';
      setScene1Phase((prev) => (prev === next ? prev : next));
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isScene1, reducedMotion, scene1DurationMs]);

  useEffect(() => {
    if (!isScene2) {
      setScene2Phase('offloading');
      return;
    }
    if (reducedMotion || typeof requestAnimationFrame === 'undefined') {
      setScene2Phase('received');
      return;
    }
    setScene2Phase('offloading');
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const p = (performance.now() - start) / scene2DurationMs;
      const next: Scene2Phase =
        p >= 0.97 ? 'received'
          : p >= 0.75 ? 'receiving'
            : p >= 0.4 ? 'moving-to-receive'
              : p >= 0.25 ? 'dock'
                : 'offloading';
      setScene2Phase((prev) => (prev === next ? prev : next));
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isScene2, reducedMotion, scene2DurationMs]);

  useEffect(() => {
    if (!isScene3) {
      setScene3Phase('p1-move');
      return;
    }
    if (reducedMotion || typeof requestAnimationFrame === 'undefined') {
      setScene3Phase('settled');
      return;
    }
    setScene3Phase('p1-move');
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const p = (performance.now() - start) / scene3DurationMs;
      let idx = 0;
      for (let i = 0; i < SCENE3_PHASE_THRESHOLDS.length; i += 1) {
        if (p >= SCENE3_PHASE_THRESHOLDS[i]) idx = i;
      }
      const next = SCENE3_PHASES[idx];
      setScene3Phase((prev) => (prev === next ? prev : next));
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isScene3, reducedMotion, scene3DurationMs]);

  useEffect(() => {
    if (!isScene4) {
      setScene4Phase('lead-in');
      return;
    }
    if (reducedMotion || typeof requestAnimationFrame === 'undefined') {
      setScene4Phase('settled');
      return;
    }
    setScene4Phase('lead-in');
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const p = (performance.now() - start) / scene4DurationMs;
      let idx = 0;
      for (let i = 0; i < SCENE4_PHASE_THRESHOLDS.length; i += 1) {
        if (p >= SCENE4_PHASE_THRESHOLDS[i]) idx = i;
      }
      const next = SCENE4_PHASES[idx];
      setScene4Phase((prev) => (prev === next ? prev : next));
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isScene4, reducedMotion, scene4DurationMs]);

  useEffect(() => {
    if (!isScene5) {
      setScene5Phase('pool-establish');
      return;
    }
    if (reducedMotion || typeof requestAnimationFrame === 'undefined') {
      setScene5Phase('settled');
      return;
    }
    setScene5Phase('pool-establish');
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const p = (performance.now() - start) / scene5DurationMs;
      let idx = 0;
      for (let i = 0; i < SCENE5_PHASE_THRESHOLDS.length; i += 1) {
        if (p >= SCENE5_PHASE_THRESHOLDS[i]) idx = i;
      }
      const next = SCENE5_PHASES[idx];
      setScene5Phase((prev) => (prev === next ? prev : next));
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isScene5, reducedMotion, scene5DurationMs]);

  useEffect(() => {
    if (!isScene6) {
      setScene6Phase('establish');
      return;
    }
    if (reducedMotion || typeof requestAnimationFrame === 'undefined') {
      setScene6Phase('settled');
      return;
    }
    setScene6Phase('establish');
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const p = (performance.now() - start) / scene6DurationMs;
      let idx = 0;
      for (let i = 0; i < SCENE6_PHASE_THRESHOLDS.length; i += 1) {
        if (p >= SCENE6_PHASE_THRESHOLDS[i]) idx = i;
      }
      const next = SCENE6_PHASES[idx];
      setScene6Phase((prev) => (prev === next ? prev : next));
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isScene6, reducedMotion, scene6DurationMs]);

  useEffect(() => {
    if (!isScene7) {
      setScene7Phase('establish');
      return;
    }
    if (reducedMotion || typeof requestAnimationFrame === 'undefined') {
      setScene7Phase('settled');
      return;
    }
    setScene7Phase('establish');
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const p = (performance.now() - start) / scene7DurationMs;
      let idx = 0;
      for (let i = 0; i < SCENE7_PHASE_THRESHOLDS.length; i += 1) {
        if (p >= SCENE7_PHASE_THRESHOLDS[i]) idx = i;
      }
      const next = SCENE7_PHASES[idx];
      setScene7Phase((prev) => (prev === next ? prev : next));
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isScene7, reducedMotion, scene7DurationMs]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const compute = () => {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      setFitScale(
        Math.min(
          rect.width / WAREHOUSE_FIT.WIDTH_DIVISOR,
          rect.height / WAREHOUSE_FIT.HEIGHT_DIVISOR,
          WAREHOUSE_FIT.MAX
        )
      );
    };
    compute();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(compute);
    observer.observe(el);
    return () => observer.disconnect();
  }, [themeResolved]);

  useEffect(() => {
    if (interrupted) return;
    if (reducedMotion || isAmbient) {
      onSceneSettled();
      return;
    }

    const timer = setTimeout(onSceneSettled, ACTIVATION_TIMING.SCENE_NATURAL_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [interrupted, isAmbient, onSceneSettled, reducedMotion, sceneDefinition?.id]);

  if (!themeResolved) {
    return (
      <Box
        data-testid="workflow-film-theme-pending"
        sx={{
          minHeight: { xs: 220, md: 420 },
          border: '1px solid',
          borderColor: ACTIVATION_COLORS.rule,
          bgcolor: ACTIVATION_COLORS.neutralBg2,
          borderRadius: 1,
        }}
      />
    );
  }

  // All merchant-facing scene copy is sourced from the canonical WORKFLOW_SCENES
  // tokens (activationMotionTokens.ts); this component holds no local overrides.
  const lines = interrupted
    ? ['Sync interrupted.']
    : isAmbient || !sceneDefinition
      ? WORKFLOW_CLOSING_LINES
      : sceneDefinition.displayLines;
  const semanticLabel = interrupted
    ? 'Sync interrupted. The warehouse story is paused while the real sync error is primary.'
    : sceneDefinition
      ? `${sceneDefinition.label}. ${sceneDefinition.fullSemanticCopy}`
      : WORKFLOW_CLOSING_LINES.join(' ');
  const sceneLabelText = interrupted
    ? 'Paused'
    : sceneDefinition?.label ?? 'Traceability';
  const dataScene = interrupted ? 'INTERRUPTED' : scene ?? 'AMBIENT';
  const gateState = gateConfirming ? 'confirming' : 'neutral';

  const poContextGroup = (
    <g
      data-workflow-marker="po-expected-inbound"
      data-po-state="created"
      transform={`translate(${SCENE1_PO_DESK_ANCHOR.x * PLANE_TO_OVERLAY_X} ${SCENE1_PO_DESK_ANCHOR.y * PLANE_TO_OVERLAY_Y})`}
      opacity={SCENE2_PO_CONTEXT_OPACITY}
    >
      <rect x="0" y="0" width={SCENE1_PO_CARD.width} height={SCENE1_PO_CARD.height} rx="10" className="order-card-bg" />
      <text x="14" y="23" className="zone-label">PO-1048</text>
      <line x1="14" y1="37" x2="76" y2="37" className="order-line" />
      <line x1="14" y1="50" x2="58" y2="50" className="order-line" />
    </g>
  );

  const scene3Geom = (i: number) => {
    const startY = SCENE3_PRODUCT_ROUTE.start.y + i * SCENE3_PRODUCT_ROUTE.startStagger;
    return {
      startX: SCENE3_PRODUCT_ROUTE.start.x,
      startY,
      gDx: SCENE3_PRODUCT_ROUTE.gate.x - SCENE3_PRODUCT_ROUTE.start.x,
      gDy: SCENE3_PRODUCT_ROUTE.gate.y - startY,
      sDx: SCENE3_PRODUCT_ROUTE.stowSlots[i].x - SCENE3_PRODUCT_ROUTE.start.x,
      sDy: SCENE3_PRODUCT_ROUTE.stowSlots[i].y - startY,
      moveAt: SCENE3_PHASE_THRESHOLDS[i * 3],
      gateAt: SCENE3_PHASE_THRESHOLDS[i * 3 + 1],
      gateHold: SCENE3_PHASE_THRESHOLDS[i * 3 + 2],
    };
  };
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

  const scene3Products = SCENE3_PRODUCTS.map((kind, i) => {
    const n = i + 1;
    const { startX, startY } = scene3Geom(i);
    const gateIdx = i * 3 + 1;
    const stowIdx = i * 3 + 2;
    const barcodeState = scene3PhaseIndex > gateIdx ? 'barcoded' : scene3PhaseIndex === gateIdx ? 'scanning' : 'unscanned';
    const stowState = scene3PhaseIndex >= stowIdx ? 'queued' : 'waiting';
    return (
      <g
        key={kind}
        className={`scene3-product scene3-product-${n}${scene3Settled ? ' is-settled' : ''}`}
        data-workflow-marker="scene3-product"
        data-product-id={kind}
        data-barcode-state={barcodeState}
        data-stow-state={stowState}
      >
        <ProductToken kind={kind} x={startX} y={startY} scale={SCENE3_PRODUCT_ROUTE.productScale} muted={false} marker={`scene3-product-${kind}`} />
        <Barcode x={startX} y={startY} />
      </g>
    );
  });

  // Generated SCENE_3 CSS (5 products × move/gate/stow) — one shared scene timeline.
  const scene3Sx: Record<string, unknown> = {};
  SCENE3_PRODUCTS.forEach((_, i) => {
    const n = i + 1;
    const g = scene3Geom(i);
    scene3Sx[`& .scene3-product-${n}`] = {
      animation: reducedMotion ? 'none' : `scene3Product${n} ${scene3DurationMs}ms ease-in-out both`,
    };
    scene3Sx[`& .scene3-product-${n}.is-settled`] = {
      transform: `translate(${g.sDx}px, ${g.sDy}px)`,
    };
    scene3Sx[`& .scene3-product-${n} .scene3-barcode`] = {
      animation: reducedMotion ? 'none' : `scene3Barcode${n} ${scene3DurationMs}ms linear both`,
    };
    scene3Sx[`& .scene3-pallet-carton-${n}`] = {
      animation: reducedMotion ? 'none' : `scene3PalletEmpty${n} ${scene3DurationMs}ms ease-out both`,
    };
    scene3Sx[`@keyframes scene3Product${n}`] = {
      [`0%, ${pct(g.moveAt)}`]: { transform: 'translate(0px, 0px)' },
      [pct(g.gateAt)]: { transform: `translate(${g.gDx}px, ${g.gDy}px)` },
      [pct(g.gateHold)]: { transform: `translate(${g.gDx}px, ${g.gDy}px)` },
      [`${pct(g.gateHold + 0.045)}, 100%`]: { transform: `translate(${g.sDx}px, ${g.sDy}px)` },
    };
    scene3Sx[`@keyframes scene3Barcode${n}`] = {
      [`0%, ${pct(g.gateAt)}`]: { opacity: 0 },
      [`${pct(g.gateHold)}, 100%`]: { opacity: 1 },
    };
    scene3Sx[`@keyframes scene3PalletEmpty${n}`] = {
      [`0%, ${pct(g.moveAt)}`]: { opacity: 1 },
      [`${pct(g.gateAt)}, 100%`]: { opacity: 0 },
    };
  });

  // SCENE_4 put-away: the same five products leave the Stow queue one at a time
  // for their assigned Inventory bin; each bin gives one restrained green confirm.
  const scene4DepartAt = (i: number) => SCENE4_PHASE_THRESHOLDS[1 + i * 3];
  const scene4ConfirmAt = (i: number) => SCENE4_PHASE_THRESHOLDS[2 + i * 3];
  const scene4Delta = (i: number) => ({
    dx: SCENE4_PUTAWAY.bins[i].x - SCENE4_PUTAWAY.origin[i].x,
    dy: SCENE4_PUTAWAY.bins[i].y - SCENE4_PUTAWAY.origin[i].y,
  });
  const scene4PutawayState = (i: number): 'queued' | 'moving' | 'placing' | 'stored' => {
    const moveIdx = 1 + i * 3;
    if (scene4PhaseIndex < moveIdx) return 'queued';
    if (scene4PhaseIndex === moveIdx) return 'moving';
    if (scene4PhaseIndex === moveIdx + 1) return 'placing';
    return 'stored';
  };
  const scene4BinStateFor = (i: number): 'empty' | 'confirming' | 'occupied' => {
    const confirmIdx = 2 + i * 3;
    if (scene4PhaseIndex < confirmIdx) return 'empty';
    if (scene4PhaseIndex === confirmIdx) return 'confirming';
    return 'occupied';
  };

  const scene4Bins = SCENE4_PUTAWAY.bins.map((bin, i) => {
    const n = i + 1;
    return (
      <g
        key={bin.binId}
        className={`scene4-bin scene4-bin-${n}`}
        data-workflow-marker="inventory-bin"
        data-bin-id={bin.binId}
        data-bin-state={scene4BinStateFor(i)}
      >
        <rect x={bin.x - 16} y={bin.y - 11} width={32} height={22} rx={3} className="scene4-bin-plate" />
        <circle cx={bin.x + 13} cy={bin.y - 8} r={3} className="scene4-bin-dot" />
      </g>
    );
  });

  const scene4Products = SCENE4_PUTAWAY.bins.map((bin, i) => {
    const n = i + 1;
    const origin = SCENE4_PUTAWAY.origin[i];
    return (
      <g
        key={bin.productId}
        className={`scene4-product scene4-product-${n}${scene4Settled ? ' is-settled' : ''}`}
        data-workflow-marker="scene4-product"
        data-product-id={bin.productId}
        data-barcode-state="barcoded"
        data-putaway-state={scene4PutawayState(i)}
      >
        <ProductToken
          kind={bin.productId}
          x={origin.x}
          y={origin.y}
          scale={SCENE4_PUTAWAY.productScale}
          muted={false}
          marker={`scene4-product-${bin.productId}`}
        />
        <Barcode x={origin.x} y={origin.y} />
      </g>
    );
  });

  // Generated SCENE_4 CSS (5 products leaving Stow one at a time) — one shared scene timeline.
  const scene4Sx: Record<string, unknown> = {};
  SCENE4_PUTAWAY.bins.forEach((_, i) => {
    const n = i + 1;
    const { dx, dy } = scene4Delta(i);
    scene4Sx[`& .scene4-product-${n}`] = {
      animation: reducedMotion ? 'none' : `scene4Product${n} ${scene4DurationMs}ms ease-in-out both`,
    };
    scene4Sx[`& .scene4-product-${n}.is-settled`] = {
      transform: `translate(${dx}px, ${dy}px)`,
    };
    scene4Sx[`@keyframes scene4Product${n}`] = {
      [`0%, ${pct(scene4DepartAt(i))}`]: { transform: 'translate(0px, 0px)' },
      [`${pct(scene4ConfirmAt(i))}, 100%`]: { transform: `translate(${dx}px, ${dy}px)` },
    };
  });

  // SCENE_5 trolley pick route: three orders are released in the Order Pool;
  // ONE trolley zig-zags the five SCENE_4 Inventory bins, picking every barcoded
  // product one at a time (accumulating on board), then parks beside Pack. The
  // order placeholders migrate Order Pool -> Pack; each product then moves a
  // short local distance from the parked trolley into its order. No packing.
  const S5 = SCENE5_TROLLEY_PICK;
  const s5PhaseThr = SCENE5_PHASE_THRESHOLDS;
  const s5pct = (f: number) => `${(f * 100).toFixed(2)}%`;
  // Trolley route waypoint the trolley occupies during phase j (index into SCENE5_PHASES).
  const s5RouteAt = (j: number) => {
    if (j <= 3) return S5.route.stop1;
    if (j === 4) return S5.route.stop2;
    if (j === 5) return S5.route.stop3;
    if (j === 6) return S5.route.stop4;
    if (j === 7 || j === 8) return S5.route.stop5;
    return S5.route.park;
  };

  const scene5TrolleyState = (): 'waiting' | 'picking' | 'to-pack' | 'parked' | 'empty' => {
    if (scene5PhaseIndex < 2) return 'waiting';
    if (scene5PhaseIndex <= 7) return 'picking';
    if (scene5PhaseIndex === 8) return 'to-pack';
    if (scene5PhaseIndex < 16) return 'parked';
    return 'empty';
  };
  const scene5OrderStateFor = (o: number): 'waiting' | 'released' | 'to-pack' | 'at-pack' | 'staged' => {
    const lastTransferIdx = Math.max(
      ...SCENE5_PICK_SEQUENCE.filter((p) => p.orderId === SCENE5_ORDERS[o].orderId).map((p) => p.transferIdx)
    );
    if (scene5PhaseIndex < 1) return 'waiting';
    if (scene5PhaseIndex < 8) return 'released';
    if (scene5PhaseIndex < 10) return 'to-pack';
    if (scene5PhaseIndex < lastTransferIdx) return 'at-pack';
    return 'staged';
  };
  const scene5PickStateFor = (i: number): 'stored' | 'picking' | 'in-trolley' | 'to-order' | 'staged' => {
    const { pickIdx, transferIdx } = SCENE5_PICK_SEQUENCE[i];
    if (scene5PhaseIndex < pickIdx) return 'stored';
    if (scene5PhaseIndex === pickIdx) return 'picking';
    if (scene5PhaseIndex < transferIdx) return 'in-trolley';
    if (scene5PhaseIndex === transferIdx) return 'to-order';
    return 'staged';
  };
  const scene5BinStateFor = (i: number): 'occupied' | 'picking' | 'empty' => {
    const { pickIdx } = SCENE5_PICK_SEQUENCE[i];
    if (scene5PhaseIndex < pickIdx) return 'occupied';
    if (scene5PhaseIndex === pickIdx) return 'picking';
    return 'empty';
  };

  // ---- SCENE_5 actor markup ----
  const scene5Bins = S5.bins.map((bin, i) => (
    <g
      key={bin.binId}
      className={`scene5-bin scene5-bin-${i + 1}`}
      data-workflow-marker="inventory-bin"
      data-bin-id={bin.binId}
      data-bin-state={scene5BinStateFor(i)}
    >
      <rect x={bin.x - 16} y={bin.y - 11} width={32} height={22} rx={3} className="scene5-bin-plate" />
      <circle cx={bin.x + 13} cy={bin.y - 8} r={3} className="scene5-bin-dot" />
    </g>
  ));

  const scene5OrderCards = SCENE5_ORDERS.map((order, o) => {
    const card = S5.orderCards[o];
    return (
      <g
        key={order.orderId}
        className={`scene5-order-card scene5-order-card-${o + 1}${scene5Settled ? ' is-staged' : ''}`}
        data-workflow-marker="order-pool-order"
        data-order-id={order.orderId}
        data-order-state={scene5OrderStateFor(o)}
      >
        <rect x={card.x} y={card.y} width={card.w} height={card.h} rx={6} className="order-card-bg scene5-order-plate" />
        <text x={card.x + 8} y={card.y + 12} className="scene5-order-text">{order.label}</text>
        <circle cx={card.x + card.w - 8} cy={card.y + 8} r={2.5} className="scene5-order-cue" />
      </g>
    );
  });

  // NB: no `transform` attribute here — the CSS keyframe animation drives the
  // group's transform with absolute overlay coordinates, so local child coords
  // are drawn around (0,0).
  const scene5Trolley = (
    <g
      className={`scene5-trolley${scene5Settled ? ' is-parked-empty' : ''}`}
      data-workflow-marker="pick-trolley"
      data-trolley-state={scene5TrolleyState()}
    >
      <rect x={S5.trolley.rail.x} y={S5.trolley.rail.y} width={S5.trolley.rail.w} height={S5.trolley.rail.h} rx={1} className="trolley-rail" />
      <rect x={S5.trolley.basket.x} y={S5.trolley.basket.y} width={S5.trolley.basket.w} height={S5.trolley.basket.h} rx={2} className="trolley-basket" />
      {S5.trolley.wheels.map((w, k) => (
        <circle key={k} cx={w.x} cy={w.y} r={3} className="trolley-wheel" />
      ))}
    </g>
  );

  const scene5Products = SCENE5_PICK_SEQUENCE.map((entry, i) => {
    const bin = S5.bins[i];
    return (
      <g
        key={entry.productId}
        className={`scene5-product scene5-product-${i + 1}${scene5Settled ? ' is-settled' : ''}`}
        data-workflow-marker="scene5-product"
        data-product-id={entry.productId}
        data-order-id={entry.orderId}
        data-barcode-state="barcoded"
        data-pick-state={scene5PickStateFor(i)}
      >
        <ProductToken
          kind={entry.productId}
          x={bin.x}
          y={bin.y}
          scale={S5.productScale}
          muted={false}
          marker={`scene5-product-${entry.productId}`}
        />
        <Barcode x={bin.x} y={bin.y} />
      </g>
    );
  });

  // Generated SCENE_5 CSS — ONE shared scene timeline. Trolley motion is the
  // primary movement language; picked products ride the trolley, then transfer
  // locally into their order at Pack. Order cards migrate Order Pool -> Pack.
  const scene5Sx: Record<string, unknown> = {};
  {
    const R = S5.route;
    const abs = (p: { x: number; y: number }) => `translate(${p.x}px, ${p.y}px)`;
    const enterMid = (s5PhaseThr[2] + s5PhaseThr[3]) / 2;
    const toPackMid = (s5PhaseThr[8] + s5PhaseThr[9]) / 2;

    scene5Sx['& .scene5-trolley'] = {
      animation: reducedMotion ? 'none' : `scene5Trolley ${scene5DurationMs}ms ease-in-out both`,
    };
    scene5Sx['& .scene5-trolley.is-parked-empty'] = { transform: abs(R.park) };
    scene5Sx['@keyframes scene5Trolley'] = {
      [`0%, ${s5pct(s5PhaseThr[2])}`]: { transform: abs(S5.trolley.entry) },
      [s5pct(enterMid)]: { transform: abs(R.enter) },
      [s5pct(s5PhaseThr[3])]: { transform: abs(R.stop1) },
      [s5pct(s5PhaseThr[4])]: { transform: abs(R.stop2) },
      [s5pct(s5PhaseThr[5])]: { transform: abs(R.stop3) },
      [s5pct(s5PhaseThr[6])]: { transform: abs(R.stop4) },
      [`${s5pct(s5PhaseThr[7])}, ${s5pct(s5PhaseThr[8])}`]: { transform: abs(R.stop5) },
      [s5pct(toPackMid)]: { transform: abs(R.toPack) },
      [`${s5pct(s5PhaseThr[9])}, 100%`]: { transform: abs(R.park) },
    };

    // Order cards: hold in the Order Pool, then migrate straight down to Pack staging.
    SCENE5_ORDERS.forEach((_, o) => {
      const card = S5.orderCards[o];
      const slot = S5.orderPackSlots[o];
      const dx = slot.x - card.x;
      const dy = slot.y - card.y;
      scene5Sx[`& .scene5-order-card-${o + 1}`] = {
        animation: reducedMotion ? 'none' : `scene5Order${o + 1} ${scene5DurationMs}ms ease-in-out both`,
      };
      scene5Sx[`& .scene5-order-card-${o + 1}.is-staged`] = { transform: `translate(${dx}px, ${dy}px)` };
      scene5Sx[`@keyframes scene5Order${o + 1}`] = {
        [`0%, ${s5pct(s5PhaseThr[8])}`]: { transform: 'translate(0px, 0px)' },
        [`${s5pct(s5PhaseThr[10])}, 100%`]: { transform: `translate(${dx}px, ${dy}px)` },
      };
    });

    // Products: in bin until picked, then ride the trolley through the route,
    // then transfer locally from the parked trolley into their order at Pack.
    SCENE5_PICK_SEQUENCE.forEach((entry, i) => {
      const n = i + 1;
      const bin = S5.bins[i];
      const slot = S5.trolley.slots[i];
      const pack = S5.packCollection[entry.productId];
      const { pickIdx, transferIdx } = entry;
      // product translate to ride the trolley at phase j
      const ride = (j: number) => ({
        x: s5RouteAt(j).x + slot.x - bin.x,
        y: s5RouteAt(j).y + slot.y - bin.y,
      });
      const packDelta = { x: pack.x - bin.x, y: pack.y - bin.y };
      const kf: Record<string, unknown> = {};
      kf[`0%, ${s5pct(s5PhaseThr[pickIdx])}`] = { transform: 'translate(0px, 0px)' };
      kf[s5pct(s5PhaseThr[pickIdx] + 0.015)] = { transform: `translate(${ride(pickIdx).x}px, ${ride(pickIdx).y}px)` };
      for (let j = pickIdx + 1; j <= 8; j += 1) {
        kf[s5pct(s5PhaseThr[j])] = { transform: `translate(${ride(j).x}px, ${ride(j).y}px)` };
      }
      kf[s5pct(toPackMid)] = {
        transform: `translate(${R.toPack.x + slot.x - bin.x}px, ${R.toPack.y + slot.y - bin.y}px)`,
      };
      kf[`${s5pct(s5PhaseThr[9])}, ${s5pct(s5PhaseThr[transferIdx] - 0.01)}`] = {
        transform: `translate(${ride(9).x}px, ${ride(9).y}px)`,
      };
      kf[`${s5pct(s5PhaseThr[transferIdx])}, 100%`] = {
        transform: `translate(${packDelta.x}px, ${packDelta.y}px)`,
      };
      scene5Sx[`& .scene5-product-${n}`] = {
        animation: reducedMotion ? 'none' : `scene5Product${n} ${scene5DurationMs}ms ease-in-out both`,
      };
      scene5Sx[`& .scene5-product-${n}.is-settled`] = { transform: `translate(${packDelta.x}px, ${packDelta.y}px)` };
      scene5Sx[`@keyframes scene5Product${n}`] = kf;
    });
  }

  // SCENE_6 verify -> pack -> label: each order at its Pack station is verified
  // in turn (restrained green confirm), its barcoded products move into one
  // shipping carton, the carton closes, and a small shipping label appears.
  // Nothing moves to Outbound.
  const S6 = SCENE6_PACK_LABEL;
  // Per order o (0..2): verify at phase 1+3o, pack at 2+3o, label at 3+3o.
  const scene6PackStateFor = (o: number): 'waiting' | 'verifying' | 'packing' | 'packed' | 'labelled' => {
    const verifyIdx = 1 + o * 3;
    if (scene6PhaseIndex < verifyIdx) return 'waiting';
    if (scene6PhaseIndex === verifyIdx) return 'verifying';
    if (scene6PhaseIndex === verifyIdx + 1) return 'packing';
    if (scene6PhaseIndex === verifyIdx + 2) return 'packed';
    return 'labelled';
  };
  const scene6ParcelStateFor = (o: number): 'open' | 'closing' | 'closed' | 'labelled' => {
    const packIdx = 2 + o * 3;
    if (scene6PhaseIndex < packIdx) return 'open';
    if (scene6PhaseIndex === packIdx) return 'closing';
    if (scene6PhaseIndex === packIdx + 1) return 'closed';
    return 'labelled';
  };
  const scene6ProductStateFor = (o: number): 'staged' | 'packing' | 'in-parcel' => {
    const packIdx = 2 + o * 3;
    if (scene6PhaseIndex < packIdx) return 'staged';
    if (scene6PhaseIndex === packIdx) return 'packing';
    return 'in-parcel';
  };

  // Position via a transform on an inner <g> (so it is unaffected by any CSS
  // `transform` on `.scene6-trolley`); parked at the SCENE_5 park point.
  const scene6Trolley = (
    <g className="scene6-trolley" data-workflow-marker="pick-trolley" data-trolley-state="empty">
      <g transform={`translate(${S6.trolleyPark.x} ${S6.trolleyPark.y})`}>
        <rect x={S6.trolley.rail.x} y={S6.trolley.rail.y} width={S6.trolley.rail.w} height={S6.trolley.rail.h} rx={1} className="trolley-rail" />
        <rect x={S6.trolley.basket.x} y={S6.trolley.basket.y} width={S6.trolley.basket.w} height={S6.trolley.basket.h} rx={2} className="trolley-basket" />
        {S6.trolley.wheels.map((w, k) => (
          <circle key={k} cx={w.x} cy={w.y} r={3} className="trolley-wheel" />
        ))}
      </g>
    </g>
  );

  const scene6Stations = S6.stations.map((st, o) => {
    const cb = S6.cartonBox;
    const lp = st.labelPlate;
    return (
      <g key={st.stationId} data-workflow-marker="scene6-pack-station" data-station-id={st.stationId}>
        <g
          className={`scene6-pack-order scene6-pack-order-${o + 1}`}
          data-workflow-marker="scene6-pack-order"
          data-order-id={st.orderId}
          data-pack-state={scene6PackStateFor(o)}
        >
          <rect x={st.card.x} y={st.card.y} width={st.card.w} height={st.card.h} rx={6} className="order-card-bg scene6-order-plate" />
          <text x={st.card.x + 8} y={st.card.y + 12} className="scene6-order-text">{st.label}</text>
          <circle cx={st.card.x + st.card.w - 8} cy={st.card.y + 8} r={2.5} className="scene6-order-cue" />
        </g>
        <g
          className={`scene6-parcel scene6-parcel-${o + 1}`}
          data-workflow-marker="shipping-parcel"
          data-order-id={st.orderId}
          data-parcel-state={scene6ParcelStateFor(o)}
        >
          {/* position on the outer <g> (attribute); the CSS scaleY "close" lives
              on the inner .scene6-carton-body so it does not clobber position. */}
          <g transform={`translate(${st.carton.x} ${st.carton.y})`}>
            <g className="scene6-carton-body">
              <IsoBlock x={cb.x} y={cb.y} w={cb.w} d={cb.d} h={cb.h} className="scene6-carton" />
            </g>
          </g>
          <g className="scene6-label" data-workflow-marker="shipping-label" data-order-id={st.orderId}>
            <rect x={lp.x} y={lp.y} width={S6.labelSize.w} height={S6.labelSize.h} rx={1} className="scene6-label-plate" />
            <rect x={lp.x + 2} y={lp.y + 2} width={10} height={1} className="scene6-label-line" />
            <g className="scene6-label-barcode" data-workflow-marker="shipping-label-barcode">
              {[0, 1.5, 2.6, 4.1, 5.2, 6.7, 7.8, 9.3].map((bx, k) => (
                <rect
                  key={k}
                  x={lp.x + 2 + bx}
                  y={lp.y + 4.2}
                  width={k % 2 ? 0.7 : 1.2}
                  height={5}
                  className="scene6-label-bar"
                />
              ))}
            </g>
            <rect x={lp.x + 2} y={lp.y + 9.6} width={6} height={1} className="scene6-label-line" />
          </g>
        </g>
      </g>
    );
  });

  const scene6ProductEntries = S6.stations.flatMap((st, o) =>
    st.products.map((p) => ({ ...p, orderId: st.orderId, o, carton: st.carton }))
  );
  const scene6Products = scene6ProductEntries.map((p, gi) => (
    <g
      key={p.productId}
      className={`scene6-product scene6-product-${gi + 1}`}
      data-workflow-marker="scene6-product"
      data-product-id={p.productId}
      data-order-id={p.orderId}
      data-barcode-state="barcoded"
      data-pack-state={scene6ProductStateFor(p.o)}
    >
      <ProductToken kind={p.productId} x={p.x} y={p.y} scale={S6.productScale} muted={false} marker={`scene6-product-${p.productId}`} />
      <Barcode x={p.x} y={p.y} />
    </g>
  ));

  // Generated SCENE_6 CSS — per-product converge-into-carton transforms. All the
  // rest is phase -> data-attribute -> CSS transition (no keyframes).
  const scene6Sx: Record<string, unknown> = {};
  scene6ProductEntries.forEach((p, gi) => {
    const n = gi + 1;
    const dx = p.carton.x - p.x;
    const dy = p.carton.y - p.y;
    scene6Sx[`& .scene6-product-${n}`] = {
      transition: reducedMotion ? 'none' : 'transform 0.42s ease, opacity 0.3s ease',
    };
    scene6Sx[`& .scene6-product-${n}[data-pack-state="packing"]`] = {
      transform: `translate(${dx}px, ${dy}px)`,
    };
    scene6Sx[`& .scene6-product-${n}[data-pack-state="in-parcel"]`] = {
      transform: `translate(${dx}px, ${dy}px)`,
      opacity: 0,
    };
  });

  // SCENE_7 ship / dispatch: the three SCENE_6 labelled parcels leave Pack, stack
  // onto ONE outbound pallet at the Shipping Dock, an outbound truck arrives and
  // parks parallel to the right wall, the whole pallet loads as one unit, and
  // the truck departs carrying every order. Physical movement only; no trace.
  const S7 = SCENE7_SHIP_DISPATCH;
  const s7thr = SCENE7_PHASE_THRESHOLDS;
  const s7pct = (f: number) => `${(f * 100).toFixed(2)}%`;
  const scene7ShipState = (): 'at-pack' | 'to-dock' | 'on-pallet' | 'loaded' | 'shipped' => {
    if (scene7PhaseIndex <= 0) return 'at-pack';
    if (scene7PhaseIndex === 1) return 'to-dock';
    if (scene7PhaseIndex <= 4) return 'on-pallet';
    if (scene7PhaseIndex <= 7) return 'loaded';
    return 'shipped';
  };
  const scene7PalletState = (): 'empty' | 'loading' | 'ready' | 'to-truck' | 'loaded' | 'departed' => {
    if (scene7PhaseIndex < 2) return 'empty';
    if (scene7PhaseIndex === 2) return 'loading';
    if (scene7PhaseIndex <= 4) return 'ready';
    if (scene7PhaseIndex === 5) return 'to-truck';
    if (scene7PhaseIndex <= 7) return 'loaded';
    return 'departed';
  };
  const scene7TruckState = (): 'absent' | 'arriving' | 'parked' | 'loading' | 'loaded' | 'departing' | 'departed' => {
    if (scene7PhaseIndex < 3) return 'absent';
    if (scene7PhaseIndex === 3) return 'arriving';
    if (scene7PhaseIndex === 4) return 'parked';
    if (scene7PhaseIndex === 5) return 'loading';
    if (scene7PhaseIndex === 6) return 'loaded';
    if (scene7PhaseIndex === 7) return 'departing';
    return 'departed';
  };

  const scene7Trolley = (
    <g className="scene7-trolley" data-workflow-marker="pick-trolley" data-trolley-state="empty">
      <g transform={`translate(${S7.trolleyPark.x} ${S7.trolleyPark.y})`}>
        <rect x={S7.trolley.rail.x} y={S7.trolley.rail.y} width={S7.trolley.rail.w} height={S7.trolley.rail.h} rx={1} className="trolley-rail" />
        <rect x={S7.trolley.basket.x} y={S7.trolley.basket.y} width={S7.trolley.basket.w} height={S7.trolley.basket.h} rx={2} className="trolley-basket" />
        {S7.trolley.wheels.map((w, k) => (
          <circle key={k} cx={w.x} cy={w.y} r={3} className="trolley-wheel" />
        ))}
      </g>
    </g>
  );

  const scene7Pallet = (
    <g
      className={`scene7-pallet${scene7Settled ? ' is-settled' : ''}`}
      data-workflow-marker="outbound-pallet"
      data-pallet-state={scene7PalletState()}
    >
      <g transform={`translate(${S7.pallet.dock.x} ${S7.pallet.dock.y})`}>
        <rect
          x={S7.pallet.base.x}
          y={S7.pallet.base.y}
          width={S7.pallet.base.w}
          height={S7.pallet.base.h}
          rx={2}
          className="scene7-pallet-base"
        />
      </g>
    </g>
  );

  const tr = S7.truck;
  const scene7Truck = (
    <g
      className={`scene7-truck${scene7Settled ? ' is-settled' : ''}`}
      data-workflow-marker="outbound-truck"
      data-truck-state={scene7TruckState()}
    >
      <g className="scene7-truck-body" transform={`translate(${tr.parked.x} ${tr.parked.y})`}>
        <rect className="scene7-truck-trailer" x={tr.trailer.x} y={tr.trailer.y} width={tr.trailer.w} height={tr.trailer.h} rx={7} />
        {tr.detailBars.map((d, i) => (
          <rect key={i} className="scene7-truck-detail" x={d.x} y={d.y} width={d.w} height={d.h} rx={3} />
        ))}
        <rect className="scene7-truck-cab" x={tr.cab.x} y={tr.cab.y} width={tr.cab.w} height={tr.cab.h} rx={5} />
        {tr.wheels.map((w, i) => (
          <circle key={i} className="scene7-truck-wheel" cx={w.x} cy={w.y} r={3.4} />
        ))}
        <circle className="scene7-load-cue" cx={tr.trailer.x + tr.trailer.w / 2} cy={tr.trailer.y + 8} r={3.4} />
      </g>
    </g>
  );

  const scene7Parcels = S7.parcels.map((p, o) => {
    const n = o + 1;
    const cb = S7.cartonBox;
    return (
      <g
        key={p.orderId}
        className={`scene7-parcel scene7-parcel-${n}${scene7Settled ? ' is-settled' : ''}`}
        data-workflow-marker="scene7-parcel"
        data-order-id={p.orderId}
        data-ship-state={scene7ShipState()}
      >
        <g transform={`translate(${p.packPos.x} ${p.packPos.y})`}>
          <IsoBlock x={cb.x} y={cb.y} w={cb.w} d={cb.d} h={cb.h} className="scene7-carton" />
          <rect x={-8} y={-14} width={S7.labelSize.w} height={S7.labelSize.h} rx={1} className="scene7-label-plate" />
          <rect x={-6} y={-12} width={10} height={1} className="scene7-label-line" />
          <g className="scene7-label-barcode" data-workflow-marker="shipping-label-barcode">
            {[0, 1.5, 2.6, 4.1, 5.2, 6.7, 7.8, 9.3].map((bx, k) => (
              <rect
                key={k}
                x={-6 + bx}
                y={-9.8}
                width={k % 2 ? 0.7 : 1.2}
                height={5}
                className="scene7-label-bar"
              />
            ))}
          </g>
          <rect x={-6} y={-4.4} width={6} height={1} className="scene7-label-line" />
        </g>
        {p.products.map((pid) => (
          <g
            key={pid}
            data-workflow-marker="scene7-product"
            data-product-id={pid}
            data-order-id={p.orderId}
            data-barcode-state="barcoded"
          />
        ))}
      </g>
    );
  });

  // Generated SCENE_7 CSS — one shared scene timeline; parcels ride the pallet,
  // the pallet rides into the truck, the truck departs with everything.
  const scene7Sx: Record<string, unknown> = {};
  {
    const D = S7.pallet.dock;
    const TC = S7.pallet.truckCargo;
    const DEP = S7.pallet.departed;
    S7.parcels.forEach((p, o) => {
      const n = o + 1;
      const sl = S7.pallet.slots[o];
      const onPallet = { x: D.x + sl.x - p.packPos.x, y: D.y + sl.y - p.packPos.y };
      const inTruck = { x: TC.x + sl.x - p.packPos.x, y: TC.y + sl.y - p.packPos.y };
      const departed = { x: DEP.x + sl.x - p.packPos.x, y: DEP.y + sl.y - p.packPos.y };
      const departAt = s7thr[1] + o * 0.04;
      const arriveAt = 0.22 + o * 0.05;
      scene7Sx[`& .scene7-parcel-${n}`] = {
        animation: reducedMotion ? 'none' : `scene7Parcel${n} ${scene7DurationMs}ms ease-in-out both`,
      };
      scene7Sx[`& .scene7-parcel-${n}.is-settled`] = {
        transform: `translate(${departed.x}px, ${departed.y}px)`,
        opacity: 0,
      };
      scene7Sx[`@keyframes scene7Parcel${n}`] = {
        [`0%, ${s7pct(departAt)}`]: { transform: 'translate(0px, 0px)' },
        [s7pct(arriveAt)]: { transform: `translate(${onPallet.x}px, ${onPallet.y}px)` },
        [s7pct(s7thr[5])]: { transform: `translate(${onPallet.x}px, ${onPallet.y}px)` },
        [s7pct(s7thr[6])]: { transform: `translate(${inTruck.x}px, ${inTruck.y}px)` },
        [s7pct(s7thr[7])]: { transform: `translate(${inTruck.x}px, ${inTruck.y}px)` },
        [`${s7pct(s7thr[8])}, 100%`]: { transform: `translate(${departed.x}px, ${departed.y}px)` },
      };
    });
    scene7Sx['& .scene7-pallet'] = {
      animation: reducedMotion ? 'none' : `scene7Pallet ${scene7DurationMs}ms ease-in-out both`,
    };
    scene7Sx['& .scene7-pallet.is-settled'] = { transform: `translate(${DEP.x - D.x}px, ${DEP.y - D.y}px)` };
    scene7Sx['@keyframes scene7Pallet'] = {
      [`0%, ${s7pct(s7thr[5])}`]: { transform: 'translate(0px, 0px)' },
      [s7pct(s7thr[6])]: { transform: `translate(${TC.x - D.x}px, ${TC.y - D.y}px)` },
      [s7pct(s7thr[7])]: { transform: `translate(${TC.x - D.x}px, ${TC.y - D.y}px)` },
      [`${s7pct(s7thr[8])}, 100%`]: { transform: `translate(${DEP.x - D.x}px, ${DEP.y - D.y}px)` },
    };
    scene7Sx['& .scene7-truck'] = {
      animation: reducedMotion ? 'none' : `scene7Truck ${scene7DurationMs}ms ease-in-out both`,
    };
    scene7Sx['& .scene7-truck.is-settled'] = { transform: `translate(0px, ${tr.departOffsetY}px)` };
    scene7Sx['@keyframes scene7Truck'] = {
      [`0%, ${s7pct(s7thr[3])}`]: { transform: `translate(0px, ${tr.entryOffsetY}px)` },
      [s7pct(s7thr[4])]: { transform: 'translate(0px, 0px)' },
      [s7pct(s7thr[7])]: { transform: 'translate(0px, 0px)' },
      [`${s7pct(s7thr[8])}, 100%`]: { transform: `translate(0px, ${tr.departOffsetY}px)` },
    };
  }

  return (
    <Box
      ref={rootRef}
      data-testid="workflow-film"
      data-scene={dataScene}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-trace-nodes={traceNodes.join('>')}
      data-active-action={interrupted ? 'none' : 'spatial-workflow'}
      data-active-zone={activeZone}
      data-active-zone-count={String(activeZoneCount)}
      data-active-zone-highlight="dimension-only"
      data-orange-directional-routes="none"
      data-orange-zone-highlight="none"
      data-movement-language="none"
      data-brand-pulse-active="false"
      data-warehouse-world-id="activation-isometric-warehouse"
      data-product-continuity="bottle>pouch>box"
      data-sync-authority="none"
      data-has-pack-verify={markerForScene(visualScene, isAmbient, 'pack-verify') ? 'true' : 'false'}
      data-has-full-trace={markerForScene(visualScene, isAmbient, 'full-trace') ? 'true' : 'false'}
      role="img"
      aria-live="polite"
      aria-label={semanticLabel}
      sx={{
        position: 'relative',
        minHeight: { xs: 360, md: 560 },
        height: { md: '100%' },
        overflow: 'hidden',
        border: '1px solid',
        borderColor: ACTIVATION_COLORS.rule,
        borderRadius: 1,
        background: WAREHOUSE_PLANE.STAGE_BACKGROUND,
        '--film-space-2': 'color-mix(in srgb, var(--bg-2) 82%, var(--surface))',
        '--film-space-3': 'color-mix(in srgb, var(--bg-3) 74%, var(--surface))',
        '--film-space-4': 'color-mix(in srgb, var(--ink-3) 18%, var(--bg-3))',
        '--film-ink': 'var(--ink)',
        '--film-ink-2': 'var(--ink-2)',
        '--film-ink-3': 'var(--ink-3)',
        '--film-rule': 'color-mix(in srgb, var(--ink) 12%, transparent)',
        '--film-rule-2': 'color-mix(in srgb, var(--ink) 20%, transparent)',
        '--film-orange': ACTIVATION_COLORS.workflowAction,
        '--film-green': ACTIVATION_COLORS.completion,
        '--film-blue': '#1FA6FF',

        // ---- Landing-page 2.5D warehouse world (transplanted, LOCKED) ----
        '& .warehouse-fit-wrapper': {
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 0,
          height: 0,
          transformOrigin: '50% 50%',
        },
        '& .warehouse-cam': {
          position: 'absolute',
          left: 0,
          top: 0,
          transform: WAREHOUSE_NEUTRAL_CAMERA,
          transition: reducedMotion ? 'none' : WAREHOUSE_CAMERA_TRANSITION,
        },
        '& .warehouse-perspective': {
          perspective: `${WAREHOUSE_PLANE.PERSPECTIVE}px`,
        },
        '& .warehouse-plane': {
          position: 'relative',
          width: `${WAREHOUSE_PLANE.WIDTH}px`,
          height: `${WAREHOUSE_PLANE.HEIGHT}px`,
          marginLeft: `${WAREHOUSE_PLANE.MARGIN_LEFT}px`,
          marginTop: `${WAREHOUSE_PLANE.MARGIN_TOP}px`,
          transform: WAREHOUSE_PLANE.TRANSFORM,
          transformStyle: 'preserve-3d',
          border: WAREHOUSE_PLANE.BORDER,
          borderRadius: `${WAREHOUSE_PLANE.BORDER_RADIUS}px`,
          boxShadow: WAREHOUSE_PLANE.BOX_SHADOW,
          backgroundColor: WAREHOUSE_PLANE.BACKGROUND_COLOR,
          backgroundImage: WAREHOUSE_PLANE.GRID_IMAGE,
        },
        '& .warehouse-yard-strip': {
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${WAREHOUSE_YARD_STRIP.width}px`,
          background: WAREHOUSE_YARD_STRIP.background,
          borderRight: WAREHOUSE_YARD_STRIP.borderRight,
        },
        '& .warehouse-zone': {
          position: 'absolute',
          border: '1px solid rgba(255,255,255,0.10)',
          transition: reducedMotion ? 'none' : 'border-color 0.6s, background 0.6s, box-shadow 0.6s',
        },
        '& .warehouse-zone .zone-label': {
          position: 'absolute',
          left: '10px',
          top: '8px',
          margin: 0,
          fontFamily: 'var(--sans)',
          fontSize: '10px',
          lineHeight: 1.3,
          fontWeight: 500,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'rgba(240,238,232,0.42)',
        },
        '& .warehouse-zone[data-warehouse-zone="shelves"] .zone-label': {
          left: '12px',
          top: '10px',
          fontWeight: 600,
          letterSpacing: '0.10em',
          color: 'rgba(240,238,232,0.48)',
          zIndex: 3,
        },
        '& .warehouse-zone .zone-sublabel': {
          position: 'absolute',
          right: '13px',
          top: '10px',
          fontFamily: 'var(--sans)',
          fontSize: '9px',
          lineHeight: 1.3,
          fontWeight: 600,
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
          color: 'rgba(31,168,255,0.74)',
          zIndex: 3,
        },
        '& .warehouse-gate': {
          position: 'absolute',
          pointerEvents: 'none',
        },
        '& .warehouse-gate .gate-bar': {
          position: 'absolute',
          top: 0,
          bottom: 0,
          transition: reducedMotion ? 'none' : 'background-color 0.32s ease',
        },
        '& .warehouse-gate[data-gate-state="confirming"] .gate-bar': {
          backgroundColor: 'var(--film-green) !important',
        },
        '& .warehouse-gate .gate-glow': {
          position: 'absolute',
          inset: '-6px',
          borderRadius: '3px',
          background: 'radial-gradient(ellipse at center, color-mix(in srgb, var(--film-green) 42%, transparent), transparent 72%)',
          opacity: 0,
          transition: reducedMotion ? 'none' : 'opacity 0.34s ease',
          pointerEvents: 'none',
        },
        '& .warehouse-gate[data-gate-state="confirming"] .gate-glow': {
          opacity: 0.68,
        },
        // ---- SCENE_1 inbound truck (DOM actor on the plane) ----
        '& .inbound-truck': {
          position: 'absolute',
          width: `${INBOUND_TRUCK.width}px`,
          height: `${INBOUND_TRUCK.height}px`,
          zIndex: 2,
        },
        '& .inbound-truck.is-parked': {
          transform: 'none',
        },
        '& .inbound-truck.is-arriving': {
          animation: reducedMotion
            ? 'none'
            : `truckArrive ${truckArriveMs}ms cubic-bezier(0.22, 1, 0.36, 1) both`,
        },
        '& .truck-trailer': {
          position: 'absolute',
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: '8px',
          background: 'linear-gradient(180deg, rgba(36,48,80,0.98), rgba(20,30,52,0.98))',
          boxShadow: '0 10px 24px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.08)',
        },
        '& .truck-detail': {
          position: 'absolute',
          borderRadius: '4px',
          background: 'rgba(255,255,255,0.04)',
        },
        '& .truck-cab': {
          position: 'absolute',
          border: '1px solid rgba(255,255,255,0.14)',
          borderRadius: '6px',
          background: 'linear-gradient(180deg, rgba(28,39,64,0.98), rgba(17,25,44,0.98))',
        },
        '& .truck-wheel': {
          position: 'absolute',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: 'rgba(11,17,28,0.96)',
          border: '1px solid rgba(255,255,255,0.12)',
        },
        '@keyframes truckArrive': {
          '0%': { transform: `translateY(${INBOUND_TRUCK.entryOffsetY}px)`, opacity: 0.35 },
          '14%': { opacity: 1 },
          '100%': { transform: 'translateY(0)', opacity: 1 },
        },
        // ---- SCENE_1 PO creation (staged reveal over the first ~75% of the scene) ----
        '& .po-card-frame': {
          animation: reducedMotion ? 'none' : `poFrameIn ${scene1DurationMs}ms ease-out both`,
        },
        '& .po-card-id': {
          animation: reducedMotion ? 'none' : `poIdIn ${scene1DurationMs}ms ease-out both`,
        },
        '& .po-card-line-1': {
          animation: reducedMotion ? 'none' : `poLine1In ${scene1DurationMs}ms ease-out both`,
        },
        '& .po-card-line-2': {
          animation: reducedMotion ? 'none' : `poLine2In ${scene1DurationMs}ms ease-out both`,
        },
        '@keyframes poFrameIn': {
          '0%': { opacity: 0 },
          '12%': { opacity: 1 },
          '100%': { opacity: 1 },
        },
        '@keyframes poIdIn': {
          '0%, 16%': { opacity: 0 },
          '38%, 100%': { opacity: 1 },
        },
        '@keyframes poLine1In': {
          '0%, 34%': { opacity: 0 },
          '56%, 100%': { opacity: 1 },
        },
        '@keyframes poLine2In': {
          '0%, 52%': { opacity: 0 },
          '74%, 100%': { opacity: 1 },
        },
        // ---- SCENE_2 inbound pallet (truck -> dock -> Receive); SCENE_3 keeps it in Receive ----
        '& .inbound-pallet': {
          position: 'absolute',
          zIndex: 3,
        },
        '& .inbound-pallet.is-journey': {
          animation: reducedMotion ? 'none' : `palletJourney ${scene2DurationMs}ms ease-in-out both`,
        },
        '& .inbound-pallet.is-received': {
          transform: `translate(${INBOUND_PALLET.atReceive.x}px, ${INBOUND_PALLET.atReceive.y}px)`,
        },
        '& .pallet-base': {
          position: 'absolute',
          inset: 0,
          borderRadius: '3px',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 8px 18px rgba(0,0,0,0.22)',
        },
        '& .pallet-carton': {
          position: 'absolute',
          borderRadius: '2px',
        },
        '& .inbound-pallet.is-journey .pallet-carton-top': {
          animation: reducedMotion ? 'none' : `palletCartonLift ${scene2DurationMs}ms ease-out both`,
        },
        '& .inbound-pallet.is-received .pallet-carton-top': {
          transform: 'translateY(-5px)',
        },
        '& .inbound-pallet.is-scene3-empty .pallet-carton': {
          opacity: 0,
        },
        '& .scene2-receive-reveal': {
          animation: reducedMotion ? 'none' : `scene2ReceiveReveal ${scene2DurationMs}ms ease-out both`,
        },
        '@keyframes palletJourney': {
          '0%': { transform: 'translate(0px, 0px)' },
          '25%': { transform: `translate(${INBOUND_PALLET.atDock.x}px, ${INBOUND_PALLET.atDock.y}px)` },
          '40%': { transform: `translate(${INBOUND_PALLET.atDock.x}px, ${INBOUND_PALLET.atDock.y}px)` },
          '75%': { transform: `translate(${INBOUND_PALLET.atReceive.x}px, ${INBOUND_PALLET.atReceive.y}px)` },
          '100%': { transform: `translate(${INBOUND_PALLET.atReceive.x}px, ${INBOUND_PALLET.atReceive.y}px)` },
        },
        '@keyframes palletCartonLift': {
          '0%, 80%': { transform: 'translateY(0)' },
          '92%, 100%': { transform: 'translateY(-5px)' },
        },
        '@keyframes scene2ReceiveReveal': {
          '0%, 80%': { opacity: 0 },
          '94%, 100%': { opacity: 1 },
        },
        // ---- SCENE_3 individual products: Receive -> barcode gate -> Stow queue ----
        '& .scene3-barcode': {
          opacity: 1,
        },
        '& .barcode-plate': {
          fill: 'var(--film-space-2)',
          stroke: 'var(--film-rule-2)',
          strokeWidth: 0.6,
        },
        '& .barcode-line': {
          fill: 'var(--film-ink)',
        },
        ...scene3Sx,
        ...scene4Sx,
        // SCENE_4 Inventory bins — subdued slots that give one restrained green
        // confirmation as each product lands, then return to neutral.
        '& .scene4-bin-plate': {
          fill: 'var(--film-space-3)',
          stroke: 'var(--film-rule-2)',
          strokeWidth: 1,
          opacity: 0.5,
          transition: reducedMotion ? 'none' : 'stroke 0.22s ease, opacity 0.22s ease',
        },
        '& .scene4-bin[data-bin-state="confirming"] .scene4-bin-plate': {
          stroke: 'var(--film-green)',
          opacity: 0.92,
        },
        '& .scene4-bin[data-bin-state="occupied"] .scene4-bin-plate': {
          opacity: 0.64,
        },
        '& .scene4-bin-dot': {
          fill: 'var(--film-green)',
          opacity: 0,
          transition: reducedMotion ? 'none' : 'opacity 0.22s ease',
        },
        '& .scene4-bin[data-bin-state="confirming"] .scene4-bin-dot': {
          opacity: 0.9,
        },
        ...scene5Sx,
        // SCENE_5 picking trolley — the primary movement actor. A shallow tote
        // on a wheeled base; restrained blue accent while actively picking.
        '& .trolley-basket': {
          fill: 'var(--film-space-3)',
          stroke: 'var(--film-rule-2)',
          strokeWidth: 1.3,
          opacity: 0.92,
          transition: reducedMotion ? 'none' : 'stroke 0.3s ease',
        },
        '& .trolley-rail': {
          fill: 'var(--film-rule-2)',
          opacity: 0.7,
        },
        '& .trolley-wheel': {
          fill: 'var(--film-space-4)',
          stroke: 'var(--film-rule-2)',
          strokeWidth: 0.8,
        },
        '& .scene5-trolley[data-trolley-state="picking"] .trolley-basket': {
          stroke: 'var(--film-blue)',
        },
        // SCENE_5 order placeholders — subdued while waiting, restrained blue
        // emphasis once released / migrating, neutral-with-green-cue when staged
        // at Pack. Distinct cards throughout; never merged into a batch.
        '& .scene5-order-plate': {
          opacity: 0.42,
          transition: reducedMotion ? 'none' : 'opacity 0.3s ease, stroke 0.3s ease',
        },
        '& .scene5-order-text': {
          fill: 'var(--film-ink-2)',
          fontFamily: 'var(--sans)',
          fontSize: 8,
          fontWeight: 700,
          letterSpacing: '0.06em',
          opacity: 0.55,
          transition: reducedMotion ? 'none' : 'opacity 0.3s ease',
        },
        '& .scene5-order-cue': {
          fill: 'var(--film-blue)',
          opacity: 0,
          transition: reducedMotion ? 'none' : 'opacity 0.3s ease, fill 0.3s ease',
        },
        '& .scene5-order-card[data-order-state="released"] .scene5-order-plate, & .scene5-order-card[data-order-state="to-pack"] .scene5-order-plate, & .scene5-order-card[data-order-state="at-pack"] .scene5-order-plate': {
          opacity: 0.9,
          stroke: 'var(--film-blue)',
        },
        '& .scene5-order-card[data-order-state="released"] .scene5-order-text, & .scene5-order-card[data-order-state="to-pack"] .scene5-order-text, & .scene5-order-card[data-order-state="at-pack"] .scene5-order-text': {
          opacity: 0.95,
        },
        '& .scene5-order-card[data-order-state="released"] .scene5-order-cue, & .scene5-order-card[data-order-state="to-pack"] .scene5-order-cue, & .scene5-order-card[data-order-state="at-pack"] .scene5-order-cue': {
          opacity: 0.85,
        },
        '& .scene5-order-card[data-order-state="staged"] .scene5-order-plate': {
          opacity: 0.66,
          stroke: 'var(--film-green)',
        },
        '& .scene5-order-card[data-order-state="staged"] .scene5-order-text': {
          opacity: 0.8,
        },
        '& .scene5-order-card[data-order-state="staged"] .scene5-order-cue': {
          opacity: 0.7,
          fill: 'var(--film-green)',
        },
        // SCENE_5 Inventory bins — occupied → brief picking cue → empty.
        '& .scene5-bin-plate': {
          fill: 'var(--film-space-3)',
          stroke: 'var(--film-rule-2)',
          strokeWidth: 1,
          opacity: 0.6,
          transition: reducedMotion ? 'none' : 'opacity 0.28s ease, stroke 0.28s ease',
        },
        '& .scene5-bin[data-bin-state="picking"] .scene5-bin-plate': {
          stroke: 'var(--film-blue)',
          opacity: 0.9,
        },
        '& .scene5-bin[data-bin-state="empty"] .scene5-bin-plate': {
          opacity: 0.14,
        },
        '& .scene5-bin-dot': {
          fill: 'var(--film-blue)',
          opacity: 0,
          transition: reducedMotion ? 'none' : 'opacity 0.28s ease',
        },
        '& .scene5-bin[data-bin-state="picking"] .scene5-bin-dot': {
          opacity: 0.85,
        },
        ...scene6Sx,
        // SCENE_6 trolley — the SCENE_5 trolley, parked beside Pack, empty and
        // subdued (present for continuity; not part of the Pack workflow).
        '& .scene6-trolley': {
          opacity: 0.3,
        },
        // SCENE_6 pack-order cards — subdued while waiting, restrained green
        // verification confirm, faint verified-green while packing, subdued once
        // the parcel is labelled. No flood, no giant check, no neon.
        '& .scene6-order-plate': {
          opacity: 0.42,
          transition: reducedMotion ? 'none' : 'opacity 0.3s ease, stroke 0.3s ease',
        },
        '& .scene6-order-text': {
          fill: 'var(--film-ink-2)',
          fontFamily: 'var(--sans)',
          fontSize: 8,
          fontWeight: 700,
          letterSpacing: '0.06em',
          opacity: 0.55,
          transition: reducedMotion ? 'none' : 'opacity 0.3s ease',
        },
        '& .scene6-order-cue': {
          fill: 'var(--film-green)',
          opacity: 0,
          transition: reducedMotion ? 'none' : 'opacity 0.3s ease',
        },
        '& .scene6-pack-order[data-pack-state="verifying"] .scene6-order-plate': {
          opacity: 0.92,
          stroke: 'var(--film-green)',
        },
        '& .scene6-pack-order[data-pack-state="verifying"] .scene6-order-text': {
          opacity: 0.95,
        },
        '& .scene6-pack-order[data-pack-state="verifying"] .scene6-order-cue': {
          opacity: 0.9,
        },
        '& .scene6-pack-order[data-pack-state="packing"] .scene6-order-plate, & .scene6-pack-order[data-pack-state="packed"] .scene6-order-plate': {
          opacity: 0.78,
          stroke: 'color-mix(in srgb, var(--film-green) 60%, var(--film-rule-2))',
        },
        '& .scene6-pack-order[data-pack-state="packing"] .scene6-order-cue, & .scene6-pack-order[data-pack-state="packed"] .scene6-order-cue': {
          opacity: 0.5,
        },
        '& .scene6-pack-order[data-pack-state="labelled"] .scene6-order-plate': {
          opacity: 0.6,
          stroke: 'color-mix(in srgb, var(--film-green) 40%, var(--film-rule-2))',
        },
        '& .scene6-pack-order[data-pack-state="labelled"] .scene6-order-text': {
          opacity: 0.72,
        },
        '& .scene6-pack-order[data-pack-state="labelled"] .scene6-order-cue': {
          opacity: 0.4,
        },
        // SCENE_6 shipping carton — one minimal 2.5D box per order; scaleY
        // "closes" it as products enter.
        '& .scene6-carton-body': {
          transformBox: 'fill-box',
          transformOrigin: 'bottom',
          transform: 'scaleY(0.34)',
          opacity: 0.6,
          transition: reducedMotion ? 'none' : 'transform 0.4s ease, opacity 0.4s ease',
        },
        '& .scene6-parcel[data-parcel-state="closing"] .scene6-carton-body': {
          transform: 'scaleY(0.72)',
          opacity: 0.9,
        },
        '& .scene6-parcel[data-parcel-state="closed"] .scene6-carton-body, & .scene6-parcel[data-parcel-state="labelled"] .scene6-carton-body': {
          transform: 'scaleY(1)',
          opacity: 1,
        },
        '& .scene6-carton.iso-top': {
          fill: 'color-mix(in srgb, var(--film-orange) 8%, var(--film-space-4))',
          stroke: 'var(--film-rule-2)',
        },
        '& .scene6-carton.iso-left': {
          fill: 'color-mix(in srgb, var(--film-space-3) 84%, black)',
        },
        '& .scene6-carton.iso-right': {
          fill: 'color-mix(in srgb, var(--film-orange) 6%, var(--film-space-3))',
        },
        // SCENE_6 shipping label — small near-white plate carrying a clearly
        // visible dark barcode and one or two restrained address-like lines;
        // appears only after the carton is closed. No readable text.
        '& .scene6-label': {
          opacity: 0,
          transition: reducedMotion ? 'none' : 'opacity 0.32s ease',
        },
        '& .scene6-parcel[data-parcel-state="closed"] .scene6-label, & .scene6-parcel[data-parcel-state="labelled"] .scene6-label': {
          opacity: 1,
        },
        '& .scene6-label-plate': {
          fill: 'color-mix(in srgb, white 90%, var(--film-space-2))',
          stroke: 'var(--film-rule-2)',
          strokeWidth: 0.5,
        },
        '& .scene6-label-line': {
          fill: '#161b26',
          opacity: 0.42,
        },
        '& .scene6-label-bar': {
          fill: '#161b26',
        },
        ...scene7Sx,
        // SCENE_7 trolley — carried over from SCENE_5/6, parked beside Pack,
        // empty and subdued (no longer emphasized).
        '& .scene7-trolley': {
          opacity: 0.28,
        },
        // SCENE_7 shipping parcels — the SCENE_6 labelled parcels (closed
        // carton + shipping label), carried forward. Ride the pallet, then the
        // truck.
        '& .scene7-carton.iso-top': {
          fill: 'color-mix(in srgb, var(--film-orange) 8%, var(--film-space-4))',
          stroke: 'var(--film-rule-2)',
        },
        '& .scene7-carton.iso-left': {
          fill: 'color-mix(in srgb, var(--film-space-3) 84%, black)',
        },
        '& .scene7-carton.iso-right': {
          fill: 'color-mix(in srgb, var(--film-orange) 6%, var(--film-space-3))',
        },
        '& .scene7-label-plate': {
          fill: 'color-mix(in srgb, white 90%, var(--film-space-2))',
          stroke: 'var(--film-rule-2)',
          strokeWidth: 0.5,
        },
        '& .scene7-label-line': {
          fill: '#161b26',
          opacity: 0.42,
        },
        '& .scene7-label-bar': {
          fill: '#161b26',
        },
        // SCENE_7 outbound pallet — one pallet carrying the three parcels
        // (inbound-pallet base language). Fades in as parcels arrive; hidden
        // once departed.
        '& .scene7-pallet-base': {
          fill: 'rgba(255,255,255,0.06)',
          stroke: 'var(--film-rule-2)',
          strokeWidth: 1,
          transition: reducedMotion ? 'none' : 'opacity 0.4s ease',
        },
        '& .scene7-pallet[data-pallet-state="empty"] .scene7-pallet-base, & .scene7-pallet[data-pallet-state="departed"] .scene7-pallet-base': {
          opacity: 0,
        },
        // SCENE_7 outbound truck — same visual vocabulary as the inbound truck,
        // a new instance parked in the far-right exterior lane.
        '& .scene7-truck-body': {
          transition: reducedMotion ? 'none' : 'opacity 0.4s ease',
        },
        '& .scene7-truck[data-truck-state="departed"] .scene7-truck-body': {
          opacity: 0,
        },
        '& .scene7-truck-trailer, & .scene7-truck-cab': {
          fill: 'color-mix(in srgb, var(--film-space-3) 66%, #1c2740)',
          stroke: 'var(--film-rule-2)',
          strokeWidth: 1,
        },
        '& .scene7-truck-detail': {
          fill: 'var(--film-rule)',
          opacity: 0.5,
        },
        '& .scene7-truck-wheel': {
          fill: 'rgba(11,17,28,0.96)',
          stroke: 'var(--film-rule-2)',
          strokeWidth: 0.8,
        },
        // SCENE_7 load-confirmation cue — a small green dot, only during 'loaded'.
        '& .scene7-load-cue': {
          fill: 'var(--film-green)',
          opacity: 0,
          transition: reducedMotion ? 'none' : 'opacity 0.3s ease',
        },
        '& .scene7-truck[data-truck-state="loaded"] .scene7-load-cue': {
          opacity: 0.85,
        },
        // inventory pick-map slot grid (landing .ls-pick-grid)
        '& .pick-grid': {
          position: 'absolute',
          left: `${PICK_GRID.left}px`,
          top: `${PICK_GRID.top}px`,
          width: `${PICK_GRID.width}px`,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '18px 16px',
        },
        '& .pick-column': {
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        },
        '& .pick-slot': {
          height: '22px',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '4px',
          background: 'rgba(255,255,255,0.04)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
        },
        '& .pick-slot.is-warm': {
          borderColor: 'rgba(255,107,43,0.22)',
          background: 'rgba(255,107,43,0.08)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 0 12px rgba(255,107,43,0.08)',
        },
        '& .pick-slot.is-cool': {
          borderColor: 'rgba(31,168,255,0.18)',
          background: 'rgba(31,168,255,0.06)',
        },

        // ---- Overlay actor layer ----
        '& .workflow-actor-overlay': {
          position: 'absolute',
          left: 0,
          top: 0,
          width: `${WAREHOUSE_PLANE.WIDTH}px`,
          height: `${WAREHOUSE_PLANE.HEIGHT}px`,
          overflow: 'visible',
          pointerEvents: 'none',
        },
        '& .zone-label': {
          fill: 'var(--film-ink-3)',
          fontSize: 11,
          fontFamily: 'var(--sans)',
          fontWeight: 700,
        },
        '& .iso-top': {
          fill: 'var(--film-space-4)',
          stroke: 'var(--film-rule-2)',
          strokeWidth: 1,
        },
        '& .iso-left': {
          fill: 'color-mix(in srgb, var(--film-space-3) 88%, black)',
          stroke: 'var(--film-rule)',
          strokeWidth: 1,
        },
        '& .iso-right': {
          fill: 'color-mix(in srgb, var(--film-space-3) 88%, white)',
          stroke: 'var(--film-rule)',
          strokeWidth: 1,
        },
        '& .order-line, & .product-detail-stroke': {
          fill: 'none',
          stroke: 'var(--film-rule-2)',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
        },
        '& .product-token': {
          opacity: 1,
        },
        '& .product-muted': {
          opacity: 0.42,
        },
        '& .product-body, & .product-top, & .product-box.iso-top': {
          fill: 'color-mix(in srgb, var(--film-ink-2) 22%, var(--film-space-4))',
          stroke: 'var(--film-rule-2)',
          strokeWidth: 1,
        },
        '& .product-detail': {
          fill: 'var(--film-orange)',
          opacity: 0.72,
        },
        '& .product-box.iso-left': {
          fill: 'color-mix(in srgb, var(--film-ink-3) 16%, var(--film-space-3))',
        },
        '& .product-box.iso-right': {
          fill: 'color-mix(in srgb, var(--film-orange) 10%, var(--film-space-4))',
        },
        '& .green-confirm': {
          fill: 'var(--film-green)',
        },
        '& .order-card-bg': {
          fill: 'var(--film-space-3)',
          stroke: 'var(--film-rule-2)',
          strokeWidth: 1,
        },
      }}
    >
      <div className="warehouse-fit-wrapper" style={{ transform: `scale(${fitScale})` }}>
        <div className="warehouse-cam">
          <div className="warehouse-perspective">
            <div
              className="warehouse-plane"
              data-workflow-marker="persistent-warehouse"
              data-warehouse-world-id="activation-isometric-warehouse"
            >
              <div className="warehouse-yard-strip" />

              {WAREHOUSE_ZONES.map((zone) => (
                <div
                  key={zone.id}
                  data-warehouse-zone={zone.id}
                  data-zone-state="inactive"
                  data-active-depth="flat"
                  className="warehouse-zone"
                  style={{
                    left: zone.left,
                    top: zone.top,
                    width: zone.width,
                    height: zone.height,
                    borderRadius: zone.borderRadius,
                    background: zone.background,
                  }}
                >
                  <span className="zone-label">{zone.label}</span>
                  <ZoneDecor id={zone.id} />
                </div>
              ))}

              <div
                className="warehouse-gate"
                data-gate=""
                data-workflow-marker="barcode-gate"
                data-gate-state={gateState}
                style={{
                  left: WAREHOUSE_GATE.left,
                  top: WAREHOUSE_GATE.top,
                  width: WAREHOUSE_GATE.width,
                  height: WAREHOUSE_GATE.height,
                  opacity: WAREHOUSE_GATE.opacity,
                }}
              >
                {WAREHOUSE_GATE.bars.map((bar, index) => (
                  <div
                    key={index}
                    className="gate-bar"
                    style={{
                      left: bar.left,
                      width: bar.width,
                      background: bar.background,
                      borderRadius: bar.radius,
                    }}
                  />
                ))}
                <div className="gate-glow" />
              </div>

              {showTruck && (
                <div
                  className={`inbound-truck ${truckIsParked ? 'is-parked' : 'is-arriving'}`}
                  data-workflow-marker="inbound-truck"
                  data-truck-state={truckIsParked ? 'parked' : 'arriving'}
                  style={{ left: INBOUND_TRUCK.parked.left, top: INBOUND_TRUCK.parked.top }}
                >
                  <div
                    className="truck-trailer"
                    style={{
                      left: INBOUND_TRUCK.trailer.left,
                      top: INBOUND_TRUCK.trailer.top,
                      width: INBOUND_TRUCK.trailer.width,
                      height: INBOUND_TRUCK.trailer.height,
                    }}
                  />
                  {INBOUND_TRUCK.detailBars.map((bar, index) => (
                    <div
                      key={index}
                      className="truck-detail"
                      style={{ left: bar.left, top: bar.top, width: bar.width, height: bar.height }}
                    />
                  ))}
                  <div
                    className="truck-cab"
                    style={{
                      left: INBOUND_TRUCK.cab.left,
                      top: INBOUND_TRUCK.cab.top,
                      width: INBOUND_TRUCK.cab.width,
                      height: INBOUND_TRUCK.cab.height,
                    }}
                  />
                  {INBOUND_TRUCK.wheels.map((wheel, index) => (
                    <div key={index} className="truck-wheel" style={{ left: wheel.left, top: wheel.top }} />
                  ))}
                </div>
              )}

              {showPallet && (
                <div
                  className={[
                    'inbound-pallet',
                    isScene3 || isScene4 || palletReceived ? 'is-received' : 'is-journey',
                    (isScene3 && reducedMotion) || isScene4 ? 'is-scene3-empty' : '',
                  ].filter(Boolean).join(' ')}
                  data-workflow-marker="inbound-pallet"
                  data-pallet-state={isScene3 ? (scene3Settled ? 'empty' : 'emptying') : isScene4 ? 'empty' : scene2Phase}
                  style={{
                    left: INBOUND_PALLET.start.left,
                    top: INBOUND_PALLET.start.top,
                    width: INBOUND_PALLET.width,
                    height: INBOUND_PALLET.height,
                  }}
                >
                  <div className="pallet-base" />
                  {(isScene3 || isScene4 ? SCENE3_PALLET_CARTONS : INBOUND_PALLET.cartons).map((carton, index, arr) => (
                    <div
                      key={index}
                      className={[
                        'pallet-carton',
                        !isScene3 && !isScene4 && index === arr.length - 1 ? 'pallet-carton-top' : '',
                        isScene3 ? `scene3-pallet-carton-${index + 1}` : '',
                      ].filter(Boolean).join(' ')}
                      style={{
                        left: carton.left,
                        top: carton.top,
                        width: carton.size,
                        height: carton.size,
                        background: carton.background,
                        border: `1px solid ${carton.border}`,
                      }}
                    />
                  ))}
                </div>
              )}

              <svg
                className="workflow-actor-overlay"
                viewBox="0 0 960 648"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {isScene1 && (
                  <g
                    data-workflow-marker="po-expected-inbound"
                    data-po-state={poCreated ? 'created' : 'creating'}
                    transform={`translate(${SCENE1_PO_DESK_ANCHOR.x * PLANE_TO_OVERLAY_X} ${SCENE1_PO_DESK_ANCHOR.y * PLANE_TO_OVERLAY_Y})`}
                  >
                    <rect x="0" y="0" width={SCENE1_PO_CARD.width} height={SCENE1_PO_CARD.height} rx="10" className="order-card-bg po-card-frame" />
                    <text x="14" y="23" className="zone-label po-card-id">PO-1048</text>
                    <line x1="14" y1="37" x2="76" y2="37" className="order-line po-card-line-1" />
                    <line x1="14" y1="50" x2="58" y2="50" className="order-line po-card-line-2" />
                  </g>
                )}

                {poContextual && poContextGroup}

                {isScene2 && (
                  <g data-workflow-marker="received-goods" className="scene2-receive-reveal">
                    <ProductSet
                      x={SCENE2_RECEIVE_PRODUCTS.x}
                      y={SCENE2_RECEIVE_PRODUCTS.y}
                      scale={SCENE2_RECEIVE_PRODUCTS.scale}
                      muted={false}
                      marker="received-products"
                    />
                    <circle cx={SCENE2_RECEIVE_PRODUCTS.x + 4} cy={SCENE2_RECEIVE_PRODUCTS.y - 6} r="4.5" className="green-confirm" />
                  </g>
                )}

                {isScene3 && <g data-workflow-marker="scene3-barcode">{scene3Products}</g>}

                {isScene4 && (
                  <g data-workflow-marker="scene4-put-away">
                    {scene4Bins}
                    {scene4Products}
                  </g>
                )}

                {isScene5 && (
                  <g data-workflow-marker="scene5-trolley-pick">
                    {scene5Bins}
                    {scene5OrderCards}
                    {scene5Trolley}
                    {scene5Products}
                  </g>
                )}

                {isScene6 && (
                  <g data-workflow-marker="scene6-pack">
                    {scene6Trolley}
                    {scene6Stations}
                    {scene6Products}
                  </g>
                )}

                {isScene7 && (
                  <g data-workflow-marker="scene7-ship">
                    {scene7Trolley}
                    {scene7Pallet}
                    {scene7Parcels}
                    {scene7Truck}
                  </g>
                )}
              </svg>
            </div>
          </div>
        </div>
      </div>

      <Box
        sx={{
          position: 'absolute',
          left: { xs: 20, md: 32 },
          right: { xs: 20, md: 32 },
          top: { xs: 18, md: 26 },
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 2,
          pointerEvents: 'none',
        }}
      >
        <Typography
          sx={{
            color: ACTIVATION_COLORS.textMuted,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {sceneDefinition ? `${sceneDefinition.stepNumber} / 7` : 'Ambient'}
        </Typography>
        <Typography
          sx={{
            color: interrupted ? 'error.main' : ACTIVATION_COLORS.workflowAction,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {sceneLabelText}
        </Typography>
      </Box>

      <Stack
        spacing={0.5}
        sx={{
          position: 'absolute',
          left: { xs: 20, md: 32 },
          top: { xs: 42, md: 52 },
          maxWidth: { xs: 280, md: 380 },
          alignItems: 'flex-start',
          justifyContent: 'flex-start',
          pointerEvents: 'none',
        }}
      >
        {lines.map((line) => (
          <Typography
            key={line}
            sx={{
              color: ACTIVATION_COLORS.textPrimary,
              fontFamily: 'var(--serif)',
              fontSize: { xs: 20, md: 28 },
              lineHeight: 1.12,
            }}
          >
            {line}
          </Typography>
        ))}
      </Stack>
    </Box>
  );
};
