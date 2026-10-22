// apps/frontend/src/components/ColumnPicker.tsx
//
// COLUMN PICKER — shared control for customizing export columns
// (GH #1014 Sprint 3 / EXP-PICKER-17, EXP-PICKERUX-18). Renders inside
// ExportRow and QuickReportCard. Entitlement-gated on the canonical
// 'exports.column_selection' capability (@lasyncro/commercial-policy,
// currently Growth+) via useCommercialAccess() — never gate inline with
// raw tier strings, never a private tier map (COMMERCIAL-ACCESS-ARCH-01
// P0-A3-1).
//
// Open/closed state is owned by the parent (open + onToggle props) so a
// surface with multiple reports can keep only one picker expanded at a
// time. Fetches GET /exports/columns only on first expansion (module-
// level cache so it's never repeated across picker instances on the same
// page) — but if a sibling picker already warmed the cache, this instance
// reads it on mount so its collapsed pill can show a real count instead
// of a generic placeholder.

import { useState } from 'react';
import { Box, Typography, Checkbox, Collapse } from '@mui/material';
import { SlidersHorizontal } from 'lucide-react';
import { axiosInstance } from 'api/axiosConfig';
import { useCommercialAccess } from '../runtime/commercialContext';

interface ColumnMeta {
  key: string;
  label: string;
}

type ColumnsResponse = Record<string, ColumnMeta[]>;

let columnsCache: ColumnsResponse | null = null;
let columnsPromise: Promise<ColumnsResponse> | null = null;

function fetchColumns(): Promise<ColumnsResponse> {
  if (columnsCache) return Promise.resolve(columnsCache);
  if (!columnsPromise) {
    columnsPromise = axiosInstance.get('/api/v1/exports/columns').then((res) => {
      columnsCache = res.data;
      return res.data as ColumnsResponse;
    });
  }
  return columnsPromise;
}

/** Derives the export resource key ('orders' | 'returns' | ...) from an endpoint like '/api/v1/exports/products'. */
function resourceFromEndpoint(endpoint: string): string {
  return endpoint.split('/').filter(Boolean).pop() ?? '';
}

export interface ColumnPickerSelection {
  /** Value to merge into the POST body as filters.columns. undefined when
   *  every column is selected (or the picker was never touched) — the
   *  default download must stay byte-identical, so "all selected" omits
   *  the key entirely rather than sending columns: [] (which the backend
   *  reads as "all columns" too, but is not the same as "not asked"). */
  columns: string[] | undefined;
  /** True when zero columns are checked — caller must disable download. */
  isEmpty: boolean;
}

const ALL_SELECTED: ColumnPickerSelection = { columns: undefined, isEmpty: false };

interface ColumnPickerProps {
  endpoint: string;
  open: boolean;
  onToggle: () => void;
  onSelectionChange: (selection: ColumnPickerSelection) => void;
}

export function ColumnPicker({ endpoint, open, onToggle, onSelectionChange }: ColumnPickerProps) {
  const { decide } = useCommercialAccess();
  const decision = decide('exports.column_selection');
  const entitled = decision.allowed;

  const resource = resourceFromEndpoint(endpoint);

  const [columns, setColumns] = useState<ColumnMeta[] | null>(() => columnsCache?.[resource] ?? null);
  const [selected, setSelected] = useState<Set<string> | null>(() => {
    const cached = columnsCache?.[resource];
    return cached ? new Set(cached.map((c) => c.key)) : null;
  });

  const handleToggle = () => {
    if (!open && !columns) {
      fetchColumns().then((data) => {
        const cols = data[resource] ?? [];
        setColumns(cols);
        setSelected(new Set(cols.map((c) => c.key)));
      });
    }
    onToggle();
  };

  const handleCheck = (e: React.ChangeEvent<HTMLInputElement>, key: string) => {
    if (!columns || !selected) return;
    const next = new Set(selected);
    if (e.target.checked) next.add(key); else next.delete(key);
    setSelected(next);

    if (next.size === columns.length) {
      onSelectionChange(ALL_SELECTED);
    } else {
      onSelectionChange({ columns: columns.filter((c) => next.has(c.key)).map((c) => c.key), isEmpty: next.size === 0 });
    }
  };

  const handleSelectAll = () => {
    if (!columns) return;
    setSelected(new Set(columns.map((c) => c.key)));
    onSelectionChange(ALL_SELECTED);
  };

  const handleClear = () => {
    if (!columns) return;
    setSelected(new Set());
    onSelectionChange({ columns: [], isEmpty: true });
  };

  const selectedCount = selected ? selected.size : (columns?.length ?? 0);
  const collapsedLabel = columns
    ? (selectedCount === columns.length ? `All ${columns.length} columns` : `${selectedCount} of ${columns.length} columns`)
    : 'Customize columns';

  return (
    <Box sx={{ position: 'relative', flexShrink: 0 }}>
      <Box
        onClick={handleToggle}
        sx={{
          display: 'inline-flex', alignItems: 'center', gap: '5px',
          px: '8px', py: '4px',
          fontSize: 11, fontWeight: 500,
          color: 'var(--ink-3)',
          border: '0.5px solid var(--rule)',
          borderRadius: '6px',
          cursor: 'pointer', userSelect: 'none',
          '&:hover': { borderColor: 'var(--accent-border)' },
        }}
      >
        <SlidersHorizontal size={11} strokeWidth={1.8} />
        <span>{collapsedLabel}</span>
      </Box>

      <Collapse in={open} sx={{ position: 'absolute', top: '100%', right: 0, mt: '4px', zIndex: 10, width: 220 }}>
        <Box sx={{
          bgcolor: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '8px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.14)', p: '10px',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: '6px' }}>
            <Typography sx={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
              Columns
            </Typography>
            {entitled && (
              <Box sx={{ display: 'flex', gap: '10px' }}>
                <Box component="button" type="button" onClick={handleSelectAll} sx={{
                  fontSize: 11, fontWeight: 500, color: 'var(--accent-text)',
                  background: 'none', border: 'none', p: 0, cursor: 'pointer',
                }}>
                  Select all
                </Box>
                <Box component="button" type="button" onClick={handleClear} sx={{
                  fontSize: 11, fontWeight: 500, color: 'var(--accent-text)',
                  background: 'none', border: 'none', p: 0, cursor: 'pointer',
                }}>
                  Clear
                </Box>
              </Box>
            )}
          </Box>
          {!entitled && (
            <Typography sx={{ fontSize: 11, fontWeight: 400, color: 'var(--ink-3)', mb: '6px' }}>
              {/* Never fabricate a tier — only the decision's own requiredTier, or neutral guidance. */}
              {decision.requiredTier ? `Available on ${decision.requiredTier}+` : 'Not included on your current plan'}
            </Typography>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
            {columns?.map((col) => (
              <Box key={col.key} sx={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                <Checkbox
                  size="small"
                  checked={!entitled ? true : (selected?.has(col.key) ?? true)}
                  disabled={!entitled}
                  onChange={(e) => handleCheck(e, col.key)}
                  sx={{ p: '3px' }}
                />
                <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink)' }}>
                  {col.label}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      </Collapse>
    </Box>
  );
}
