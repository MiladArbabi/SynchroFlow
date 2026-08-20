// apps/frontend/src/components/ColumnPicker.tsx
//
// COLUMN PICKER — shared control for customizing export columns
// (GH #1014 Sprint 3 / EXP-PICKER-17). Renders inside ExportRow and
// QuickReportCard. Entitlement-gated on 'exports.column_selection'
// (Growth+) via usePlanEntitlement — never gate inline with raw tier
// strings.
//
// Collapsed by default and fetches GET /exports/columns only on first
// expansion, so a user who never opens it never pays for the request —
// and a module-level cache means the SAME request is never repeated
// across multiple picker instances on the same page (e.g. every row in
// the drawer).

import { useState } from 'react';
import { Box, Typography, Checkbox, Collapse } from '@mui/material';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { axiosInstance } from 'api/axiosConfig';
import { usePlanEntitlement } from '../hooks/usePlanEntitlement';

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
  onSelectionChange: (selection: ColumnPickerSelection) => void;
}

export function ColumnPicker({ endpoint, onSelectionChange }: ColumnPickerProps) {
  const { can, mustUpgradeTo } = usePlanEntitlement();
  const entitled = can('exports.column_selection');
  const upgradeTarget = mustUpgradeTo('exports.column_selection');

  const [expanded, setExpanded] = useState(false);
  const [columns, setColumns] = useState<ColumnMeta[] | null>(null);
  const [selected, setSelected] = useState<Set<string> | null>(null);

  const resource = resourceFromEndpoint(endpoint);

  const handleToggleExpand = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !expanded;
    setExpanded(next);
    if (next && !columns) {
      const data = await fetchColumns();
      const cols = data[resource] ?? [];
      setColumns(cols);
      setSelected(new Set(cols.map((c) => c.key)));
    }
  };

  const handleCheck = (e: React.ChangeEvent<HTMLInputElement>, key: string) => {
    e.stopPropagation();
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

  const selectedCount = selected ? selected.size : (columns?.length ?? 0);

  return (
    <Box sx={{ mt: '4px' }} onClick={(e) => e.stopPropagation()}>
      <Box
        onClick={handleToggleExpand}
        sx={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', userSelect: 'none', width: 'fit-content' }}
      >
        {expanded ? <ChevronDown size={11} color="var(--ink-3)" /> : <ChevronRight size={11} color="var(--ink-3)" />}
        <Typography sx={{ fontSize: 11, fontWeight: 400, color: 'var(--ink-3)' }}>
          Customize columns{columns ? ` (${selectedCount} selected)` : ''}
        </Typography>
      </Box>
      <Collapse in={expanded}>
        <Box sx={{ display: 'flex', flexDirection: 'column', mt: '4px', pl: '15px', gap: '2px' }}>
          {!entitled && upgradeTarget && (
            <Typography sx={{ fontSize: 11, fontWeight: 400, color: 'var(--ink-3)', mb: '2px' }}>
              Available on {upgradeTarget}+
            </Typography>
          )}
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
      </Collapse>
    </Box>
  );
}
