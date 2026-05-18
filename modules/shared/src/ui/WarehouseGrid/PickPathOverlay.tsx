import { useMemo } from 'react';
import type { GridVariant } from './WarehouseGrid.types.js';

/**
 * PickPathOverlay — SVG polyline connecting bins in pick order.
 *
 * Coordinates are computed mathematically from grid layout constants —
 * no DOM measurement needed. This is reliable across re-renders and
 * works in both full and mini variants.
 *
 * Layout model:
 *   - Aisles are columns, sorted alphabetically left→right
 *   - Bins within an aisle are sorted ASC top→bottom
 *   - Cell size, gap, and padding are fixed per variant
 *   - Aisle header = HEADER_H px above first bin
 *
 * The SVG is absolutely positioned over the grid container.
 */

const CELL_SIZE: Record<GridVariant, number> = { full: 64, mini: 44, inline: 32 };
const CELL_GAP:  Record<GridVariant, number> = { full: 6,  mini: 4,  inline: 3  };
const AISLE_GAP: Record<GridVariant, number> = { full: 12, mini: 8,  inline: 6  };
const HEADER_H:  Record<GridVariant, number> = { full: 32, mini: 26, inline: 20 };
const PADDING:   Record<GridVariant, number> = { full: 8,  mini: 0,  inline: 0  };
const PY:        Record<GridVariant, number> = { full: 4,  mini: 4,  inline: 4  }; // py:1 = 4px

export interface PickPathOverlayProps {
  pickPath: string[];
  /** All bin location codes in the grid, sorted as rendered */
  allBins: Map<string, string[]>; // aisleLabel → sorted bin codes
  variant?: GridVariant;
}

function getBinCenter(
  locationCode: string,
  aisleMap: Map<string, string[]>,
  variant: GridVariant
): { x: number; y: number } | null {
  const aisleLabel = locationCode.split('-')[0] ?? locationCode;
  const aisleKeys  = [...aisleMap.keys()];
  const aisleIndex = aisleKeys.indexOf(aisleLabel);
  if (aisleIndex === -1) return null;

  const bins     = aisleMap.get(aisleLabel) ?? [];
  const binIndex = bins.indexOf(locationCode);
  if (binIndex === -1) return null;

  const cell    = CELL_SIZE[variant];
  const cellGap = CELL_GAP[variant];
  const aisleG  = AISLE_GAP[variant];
  const headerH = HEADER_H[variant];
  const pad     = PADDING[variant];
  const py      = PY[variant];

  const x = pad + aisleIndex * (cell + aisleG) + cell / 2;
  const y = py + headerH + binIndex * (cell + cellGap) + cell / 2;

  return { x, y };
}

export function PickPathOverlay({ pickPath, allBins, variant = 'full' }: PickPathOverlayProps) {
  const points = useMemo(() => {
    return pickPath
      .map(code => getBinCenter(code, allBins, variant))
      .filter((p): p is { x: number; y: number } => p !== null);
  }, [pickPath, allBins, variant]);

  if (points.length < 2) return null;

  const polylinePoints = points.map(p => `${p.x},${p.y}`).join(' ');

  // SVG dimensions — enough to cover the grid
  const aisleCount = allBins.size;
  const maxBins    = Math.max(...[...allBins.values()].map(b => b.length));
  const cell       = CELL_SIZE[variant];
  const cellGap    = CELL_GAP[variant];
  const aisleG     = AISLE_GAP[variant];
  const headerH    = HEADER_H[variant];
  const pad        = PADDING[variant];
  const py         = PY[variant];

  const svgW = pad * 2 + aisleCount * cell + (aisleCount - 1) * aisleG;
  const svgH = py * 2 + headerH + maxBins * cell + (maxBins - 1) * cellGap;

  return (
    <svg
      width={svgW}
      height={svgH}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'none',
        zIndex: 5,
        overflow: 'visible',
      }}
    >
      {/* Path line */}
      <polyline
        points={polylinePoints}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2}
        strokeDasharray="6 4"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.7}
      />
      {/* Direction arrows + stop numbers */}
      {points.map((p, i) => (
        <g key={i}>
          <circle
            cx={p.x}
            cy={p.y}
            r={variant === 'full' ? 10 : 7}
            fill="var(--accent)"
            opacity={0.9}
          />
          <text
            x={p.x}
            y={p.y + 1}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#fff"
            fontSize={variant === 'full' ? 9 : 7}
            fontWeight="700"
            fontFamily="monospace"
          >
            {i + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}