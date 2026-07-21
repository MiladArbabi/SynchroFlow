/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/ft2-pages/ShopSettingsWarehousePage.tsx
//
// Settings → Warehouse tab
// ------------------------
// Floor Display
// Future: batch size, auto-release, idle threshold, problem bin (WM-35)

import { useState, useEffect } from 'react';
import { Box, Typography, TextField, Button, Skeleton, Tooltip, Select, MenuItem, FormControl, InputLabel, Chip } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Monitor, Copy, RotateCcw, Trash2, Plus, Tag, Printer, Wifi, Bluetooth, Usb, CheckCircle } from 'lucide-react';
import { axiosInstance } from 'api/axiosConfig';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
import { useAppTheme } from '../../hooks/useAppTheme';
import { SettingsCard, SettingsPageWrapper } from './ShopSettingsShared';

type DisplayToken = {
  id: string;
  label: string | null;
  created_at: string;
  rotated_at: string | null;
  last_seen_at: string | null;
  active: boolean;
};

function useDisplayTokens() {
  return useQuery<{ tokens: DisplayToken[] }>({
    queryKey: ['display-tokens'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/wms/analytics/display-tokens');
      return data;
    },
    refetchInterval: 30_000,
  });
}

function useCreateDisplayToken() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  return useMutation<{ id: string; raw_token: string; label: string | null }, Error, { label: string }>({
    mutationFn: async (body) => {
      const { data } = await axiosInstance.post('/api/v1/wms/analytics/display-tokens', body);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['display-tokens'] }),
    onError: () => show('Failed to create token', 'error'),
  });
}

function usePatchDisplayToken() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  return useMutation<void, Error, { id: string; label: string }>({
    mutationFn: async ({ id, label }) => {
      await axiosInstance.patch(`/api/v1/wms/analytics/display-tokens/${id}`, { label });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['display-tokens'] }),
    onError: () => show('Failed to rename token', 'error'),
  });
}

function useRotateDisplayToken() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  return useMutation<{ raw_token: string }, Error, string>({
    mutationFn: async (id) => {
      const { data } = await axiosInstance.post(`/api/v1/wms/analytics/display-tokens/${id}/rotate`);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['display-tokens'] }),
    onError: () => show('Failed to rotate token', 'error'),
  });
}

function useRevokeDisplayToken() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await axiosInstance.delete(`/api/v1/wms/analytics/display-tokens/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['display-tokens'] }),
    onError: () => show('Failed to revoke token', 'error'),
  });
}

function FloorDisplaySection() {
  const pal = useAppTheme();
  const theme = useTheme();
  const { show } = useToast();
  const { data, isLoading } = useDisplayTokens();
  const { mutate: createToken, isPending: isCreating } = useCreateDisplayToken();
  const { mutate: patchToken } = usePatchDisplayToken();
  const { mutate: rotateToken } = useRotateDisplayToken();
  const { mutate: revokeToken } = useRevokeDisplayToken();

  const [newLabel,      setNewLabel]      = useState('');
  const [showCreate,    setShowCreate]    = useState(false);
  const [editingId,     setEditingId]     = useState<string | null>(null);
  const [editingLabel,  setEditingLabel]  = useState('');
  const [revealedToken, setRevealedToken] = useState<{ id: string; raw: string } | null>(null);

  const tokens      = data?.tokens ?? [];
  const activeCount = tokens.filter(t => t.active).length;

  const copyToClipboard = (text: string) =>
    navigator.clipboard.writeText(text).then(() => show('Copied to clipboard', 'success'));

  const buildDisplayUrl = (raw: string) =>
    `${window.location.origin}/wms/analytics/display?token=${encodeURIComponent(raw)}`;

  const handleCreate = () => {
    createToken({ label: newLabel || 'Display TV' }, {
      onSuccess: (d) => {
        setRevealedToken({ id: d.id, raw: d.raw_token });
        setNewLabel('');
        setShowCreate(false);
      },
    });
  };

  const handleRotate = (id: string) => {
    if (!window.confirm('Rotating will immediately invalidate the current URL on all displays using this token. Continue?')) return;
    rotateToken(id, {
      onSuccess: (d) => setRevealedToken({ id, raw: d.raw_token }),
    });
  };

  const handleRevoke = (id: string) => {
    if (!window.confirm('This will permanently revoke this display URL. Any TV using it will stop updating.')) return;
    revokeToken(id);
    if (revealedToken?.id === id) setRevealedToken(null);
  };

  return (
    <SettingsCard
      icon={<Monitor size={16} />}
      title="Floor Display"
      description="Generate token-bound URLs for warehouse TVs. Displays show team pace and pipeline — no operator names."
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: activeCount > 0 ? 'success.main' : 'var(--ink-4)', flexShrink: 0 }} />
          <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
            {activeCount > 0 ? `${activeCount} display${activeCount > 1 ? 's' : ''} active` : 'No active displays'}
          </Typography>
        </Box>
        <Box
          onClick={() => setShowCreate(true)}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', color: 'var(--accent)', '&:hover': { opacity: 0.8 } }}
        >
          <Plus size={13} strokeWidth={2} />
          <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--accent)' }}>New display URL</Typography>
        </Box>
      </Box>

      {showCreate && (
        <Box sx={{ display: 'flex', gap: 1, mb: 1.5, p: 1.25, bgcolor: 'var(--bg-2)', borderRadius: '6px', border: `0.5px solid ${pal.rule}` }}>
          <TextField
            size="small" placeholder="Label (e.g. Warehouse main)" value={newLabel} autoFocus
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false); }}
            inputProps={{ style: { fontSize: 12 } }}
            sx={{ flex: 1 }}
          />
          <Button size="small" variant="contained" onClick={handleCreate} disabled={isCreating}
            sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, fontSize: 12, flexShrink: 0 }}>
            {isCreating ? 'Creating…' : 'Create'}
          </Button>
          <Button size="small" onClick={() => setShowCreate(false)} sx={{ fontSize: 12, flexShrink: 0 }}>Cancel</Button>
        </Box>
      )}

      {revealedToken && (
        <Box sx={{ mb: 1.5, p: 1.25, bgcolor: 'rgba(34,197,94,0.06)', border: '0.5px solid rgba(34,197,94,0.3)', borderRadius: '6px' }}>
          <Typography sx={{ fontSize: 11, fontWeight: 600, color: '#22C55E', mb: 0.5 }}>
            Copy this URL now — it won't be shown again.
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography sx={{ fontSize: 11, color: 'var(--ink)', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {buildDisplayUrl(revealedToken.raw)}
            </Typography>
            <Box onClick={() => copyToClipboard(buildDisplayUrl(revealedToken.raw))}
              sx={{ cursor: 'pointer', color: 'var(--accent)', flexShrink: 0, '&:hover': { opacity: 0.8 } }}>
              <Copy size={13} />
            </Box>
            <Box onClick={() => setRevealedToken(null)}
              sx={{ cursor: 'pointer', color: 'var(--ink-4)', flexShrink: 0, '&:hover': { color: 'var(--ink)' } }}>
              <Trash2 size={13} />
            </Box>
          </Box>
        </Box>
      )}

      {isLoading && <Skeleton height={48} sx={{ borderRadius: '6px' }} />}

      {!isLoading && tokens.length === 0 && !showCreate && (
        <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
          No display URLs yet. Create one to cast to a warehouse TV.
        </Typography>
      )}

      {!isLoading && tokens.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {tokens.map(token => (
            <Box key={token.id} sx={{
              display: 'flex', alignItems: 'center', gap: 1,
              p: 1, borderRadius: '6px',
              bgcolor: 'var(--bg-2)', border: `0.5px solid ${pal.rule}`,
            }}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: token.active ? 'success.main' : 'var(--rule)', flexShrink: 0 }} />
              {editingId === token.id ? (
                <TextField
                  size="small" value={editingLabel} autoFocus
                  onChange={(e) => setEditingLabel(e.target.value)}
                  onBlur={() => { patchToken({ id: token.id, label: editingLabel }); setEditingId(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { patchToken({ id: token.id, label: editingLabel }); setEditingId(null); }
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  inputProps={{ style: { fontSize: 12, padding: '2px 6px' } }}
                  sx={{ flex: 1 }}
                />
              ) : (
                <Typography
                  onClick={() => { setEditingId(token.id); setEditingLabel(token.label ?? ''); }}
                  sx={{ fontSize: 12, color: 'var(--ink)', flex: 1, cursor: 'text', '&:hover': { color: 'var(--accent)' } }}
                >
                  {token.label || 'Unlabelled display'}
                </Typography>
              )}
              <Typography sx={{ fontSize: 10, color: 'var(--ink-4)', flexShrink: 0 }}>
                {token.last_seen_at
                  ? `seen ${new Date(token.last_seen_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : 'never seen'}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                <Tooltip title="Rotate token (invalidates current URL)">
                  <Box onClick={() => handleRotate(token.id)} sx={{ cursor: 'pointer', color: 'var(--ink-3)', '&:hover': { color: 'var(--ink)' } }}>
                    <RotateCcw size={13} strokeWidth={1.75} />
                  </Box>
                </Tooltip>
                <Tooltip title="Revoke permanently">
                  <Box onClick={() => handleRevoke(token.id)} sx={{ cursor: 'pointer', color: 'var(--ink-3)', '&:hover': { color: theme.palette.error.main } }}>
                    <Trash2 size={13} strokeWidth={1.75} />
                  </Box>
                </Tooltip>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </SettingsCard>
  );
}

function useWmsSettings() {
  return useQuery<{ settings: { legacy_barcode_fallback_enabled: boolean } }>({
    queryKey: ['wms-settings'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/wms/settings');
      return data;
    },
  });
}

function usePatchLegacyFallback() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  return useMutation<void, Error, boolean>({
    mutationFn: async (enabled) => {
      await axiosInstance.patch('/api/v1/wms/settings', { legacy_barcode_fallback_enabled: enabled });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['wms-settings'] }),
    onError: () => show('Failed to update legacy barcode setting', 'error'),
  });
}

function UnitLabelCoverageSection() {
  const { data, isLoading } = useQuery<{
    labelled_units: number;
    total_active_units: number;
    unlabelled_in_circulation: number;
    coverage_pct: number;
  }>({
    queryKey: ['unit-label-coverage'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/wms/coverage');
      return data;
    },
    refetchInterval: 60_000,
  });

  const { data: settingsData } = useWmsSettings();
  const { mutate: patchFallback, isPending: isTogglingFallback } = usePatchLegacyFallback();
    const legacyFallbackEnabled = settingsData?.settings?.legacy_barcode_fallback_enabled ?? true;

  const pct     = data?.coverage_pct ?? 0;
  const total   = data?.total_active_units ?? 0;
  const labelled = data?.labelled_units ?? 0;
  const unlabelled = data?.unlabelled_in_circulation ?? 0;

  const barColor = pct === 100
    ? '#22C55E'
    : pct >= 50 ? 'var(--accent)' : '#EAB308';

  return (
    <SettingsCard
      icon={<Tag size={16} />}
      title="Unit Label Coverage"
      description="Percentage of active inventory carrying LaSyncro LSU- barcodes. Climbs automatically as new stock is received."
    >
      {isLoading ? (
        <Skeleton height={48} sx={{ borderRadius: '6px' }} />
      ) : (
        <>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1 }}>
            <Typography sx={{ fontSize: 28, fontWeight: 600, color: barColor, lineHeight: 1 }}>
              {pct}%
            </Typography>
            <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
              {labelled} of {total} active units labelled
            </Typography>
          </Box>

          {/* Progress bar */}
          <Box sx={{ height: 6, borderRadius: '3px', bgcolor: 'var(--rule)', overflow: 'hidden', mb: 1.5 }}>
            <Box sx={{
              height: '100%',
              width: `${pct}%`,
              bgcolor: barColor,
              borderRadius: '3px',
              transition: 'width 0.4s ease',
            }} />
          </Box>

          {pct === 100 ? (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#22C55E' }} />
                <Typography sx={{ fontSize: 12, color: '#22C55E', fontWeight: 500 }}>
                  Full coverage — legacy barcode fallback can be disabled.
                </Typography>
              </Box>
              <Button
                size="small" variant="outlined"
                disabled={isTogglingFallback}
                onClick={() => patchFallback(!legacyFallbackEnabled)}
                sx={{ fontSize: 11, flexShrink: 0 }}
              >
                {isTogglingFallback ? 'Saving…' : legacyFallbackEnabled ? 'Disable legacy fallback' : 'Re-enable legacy fallback'}
              </Button>
            </Box>
          ) : total === 0 ? (
            <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
              No active inventory yet. Coverage will grow automatically as stock is received.
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#EAB308' }} />
                <Typography sx={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 500 }}>
                  {unlabelled.toLocaleString()} {unlabelled === 1 ? 'unit' : 'units'} still in circulation without a label
                </Typography>
              </Box>
              <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
                Coverage grows automatically as new stock is received. Run a targeted stocktake to accelerate.
              </Typography>
            </Box>
          )}
        </>
      )}
    </SettingsCard>
  );
}

type PrinterRole = 'unit_label' | 'invoice' | 'problem_label' | 'general';
type ConnectionType = 'usb' | 'wifi' | 'bluetooth';

const ROLE_LABELS: Record<PrinterRole, string> = {
  unit_label:    'Unit labels (LSU-)',
  invoice:       'Invoices (A4)',
  problem_label: 'Problem bin labels',
  general:       'General',
};

const ROLE_COLORS: Record<PrinterRole, string> = {
  unit_label:    '#22C55E',
  invoice:       'var(--accent)',
  problem_label: '#EAB308',
  general:       'var(--ink-3)',
};

const CONNECTION_ICONS: Record<ConnectionType, React.ReactNode> = {
  usb:       <Usb size={12} />,
  wifi:      <Wifi size={12} />,
  bluetooth: <Bluetooth size={12} />,
};

type PrinterRow = {
  printer_id: string;
  name: string;
  connection_type: ConnectionType;
  address: string | null;
  model: string | null;
  role: PrinterRole;
  os_printer_name: string | null;
  is_default: boolean;
  active: boolean;
};

type QzStatus = 'detecting' | 'connected' | 'not_found';

function usePrinters() {
  return useQuery<{ printers: PrinterRow[] }>({
    queryKey: ['wms-printers'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/wms/printers');
      return data;
    },
  });
}

function PrintersSection() {
  const pal     = useAppTheme();
  const { show } = useToast();
  const qc      = useQueryClient();
  const { data, isLoading } = usePrinters();
  const printers = data?.printers ?? [];

  const [qzStatus,       setQzStatus]       = useState<QzStatus>('detecting');
  const [detectedPrinters, setDetectedPrinters] = useState<string[]>([]);
  const [showAdd,        setShowAdd]        = useState(false);
  const [newName,        setNewName]        = useState('');
  const [newRole,        setNewRole]        = useState<PrinterRole>('unit_label');
  const [newConnection,  setNewConnection]  = useState<ConnectionType>('usb');
  const [newAddress,     setNewAddress]     = useState('');
  const [newOsName,      setNewOsName]      = useState('');
  const [newIsDefault,   setNewIsDefault]   = useState(false);
  const [adding,         setAdding]         = useState(false);

  // Detect QZ Tray on mount
  useEffect(() => {
    const detect = async () => {
      try {
        const ws = new WebSocket('wss://localhost:8182');
        ws.onopen = () => {
          setQzStatus('connected');
          // Request printer list from QZ Tray
          ws.send(JSON.stringify({ call: 'printers.find' }));
          ws.close();
        };
        ws.onerror = () => setQzStatus('not_found');
        setTimeout(() => {
          if (ws.readyState !== WebSocket.OPEN) setQzStatus('not_found');
        }, 2000);
      } catch {
        setQzStatus('not_found');
      }
    };
    void detect();
  }, []);

  const handleSetDefault = async (printerId: string, role: PrinterRole) => {
    try {
      await axiosInstance.patch(`/api/v1/wms/printers/${printerId}`, { is_default: true, role });
      qc.invalidateQueries({ queryKey: ['wms-printers'] });
      show('Default printer updated', 'success');
    } catch {
      show('Failed to update default', 'error');
    }
  };

  const handleDelete = async (printerId: string) => {
    if (!window.confirm('Remove this printer?')) return;
    try {
      await axiosInstance.delete(`/api/v1/wms/printers/${printerId}`);
      qc.invalidateQueries({ queryKey: ['wms-printers'] });
      show('Printer removed', 'success');
    } catch {
      show('Failed to remove printer', 'error');
    }
  };

  const handleAdd = async () => {
    if (!newName || !newRole || !newConnection) return;
    setAdding(true);
    try {
      await axiosInstance.post('/api/v1/wms/printers', {
        name:            newName,
        connection_type: newConnection,
        address:         newAddress || null,
        role:            newRole,
        os_printer_name: newOsName || null,
        is_default:      newIsDefault,
      });
      qc.invalidateQueries({ queryKey: ['wms-printers'] });
      show('Printer registered', 'success');
      setShowAdd(false);
      setNewName(''); setNewRole('unit_label'); setNewConnection('usb');
      setNewAddress(''); setNewOsName(''); setNewIsDefault(false);
    } catch {
      show('Failed to register printer', 'error');
    } finally {
      setAdding(false);
    }
  };

  return (
    <SettingsCard
      icon={<Printer size={16} />}
      title="Printers"
      description="Register thermal and standard printers for automatic label routing. Requires QZ Tray on the warehouse workstation."
    >
      {/* QZ Tray status */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box sx={{
            width: 7, height: 7, borderRadius: '50%',
            bgcolor: qzStatus === 'connected' ? '#22C55E' : qzStatus === 'detecting' ? '#EAB308' : 'var(--ink-4)',
          }} />
          <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
            {qzStatus === 'connected'  ? 'QZ Tray connected' :
             qzStatus === 'detecting'  ? 'Detecting QZ Tray…' :
             'QZ Tray not detected on this computer'}
          </Typography>
          {qzStatus === 'not_found' && (
            <Box
              component="a"
              href="https://qz.io/download"
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                display: 'inline-flex', alignItems: 'center',
                px: 1, py: 0.25, fontSize: 11, fontWeight: 500,
                color: 'var(--accent)', border: '0.5px solid var(--accent-border)',
                borderRadius: '6px', cursor: 'pointer', textDecoration: 'none',
                '&:hover': { opacity: 0.75 },
              }}
            >
              Download QZ Tray →
            </Box>
          )}
        </Box>
        <Box
          onClick={() => setShowAdd(true)}
          sx={{
            display: 'flex', alignItems: 'center', gap: 0.5,
            cursor: 'pointer', color: 'var(--accent)', '&:hover': { opacity: 0.8 },
          }}
        >
          <Plus size={13} strokeWidth={2} />
          <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--accent)' }}>
            Add printer
          </Typography>
        </Box>
      </Box>

      {/* Add printer form */}
      {showAdd && (
        <Box sx={{
          mb: 2, p: 1.5, borderRadius: '6px',
          bgcolor: 'var(--bg-2)', border: `0.5px solid ${pal.rule}`,
          display: 'flex', flexDirection: 'column', gap: 1.25,
        }}>
          <TextField
            size="small" label="Printer name" value={newName} fullWidth
            onChange={(e) => setNewName(e.target.value)}
            inputProps={{ style: { fontSize: 12 } }}
            placeholder="e.g. Zebra ZD421 — Receiving dock"
          />
          <Box sx={{ display: 'flex', gap: 1 }}>
            <FormControl size="small" sx={{ flex: 1 }}>
              <InputLabel sx={{ fontSize: 12 }}>Role</InputLabel>
              <Select
                value={newRole} label="Role"
                onChange={(e) => setNewRole(e.target.value as PrinterRole)}
                sx={{ fontSize: 12 }}
              >
                {(Object.keys(ROLE_LABELS) as PrinterRole[]).map(r => (
                  <MenuItem key={r} value={r} sx={{ fontSize: 12 }}>{ROLE_LABELS[r]}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ flex: 1 }}>
              <InputLabel sx={{ fontSize: 12 }}>Connection</InputLabel>
              <Select
                value={newConnection} label="Connection"
                onChange={(e) => setNewConnection(e.target.value as ConnectionType)}
                sx={{ fontSize: 12 }}
              >
                <MenuItem value="usb" sx={{ fontSize: 12 }}>USB</MenuItem>
                <MenuItem value="wifi" sx={{ fontSize: 12 }}>Wi-Fi / Network</MenuItem>
                <MenuItem value="bluetooth" sx={{ fontSize: 12 }}>Bluetooth</MenuItem>
              </Select>
            </FormControl>
          </Box>
          <TextField
            size="small" label="OS printer name (QZ Tray)" value={newOsName} fullWidth
            onChange={(e) => setNewOsName(e.target.value)}
            inputProps={{ style: { fontSize: 12 } }}
            placeholder="Exact name as shown in your OS printer list"
          />
          {(newConnection === 'wifi' || newConnection === 'bluetooth') && (
            <TextField
              size="small" label="IP address / BT MAC" value={newAddress} fullWidth
              onChange={(e) => setNewAddress(e.target.value)}
              inputProps={{ style: { fontSize: 12 } }}
              placeholder={newConnection === 'wifi' ? '192.168.1.45' : '00:07:4D:4A:3B:2C'}
            />
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'space-between' }}>
            <Box
              onClick={() => setNewIsDefault(!newIsDefault)}
              sx={{
                display: 'inline-flex', alignItems: 'center', gap: 0.5,
                px: 1, py: 0.375, fontSize: 11, fontWeight: 500, cursor: 'pointer',
                color: newIsDefault ? 'var(--accent)' : 'var(--ink-3)',
                border: `0.5px solid ${newIsDefault ? 'var(--accent)' : pal.rule}`,
                borderRadius: '6px', bgcolor: newIsDefault ? 'var(--accent-ghost)' : 'transparent',
              }}
            >
              {newIsDefault && <CheckCircle size={11} />}
              Set as default for {ROLE_LABELS[newRole]}
            </Box>
            <Box sx={{ display: 'flex', gap: 0.75 }}>
              <Button size="small" onClick={() => setShowAdd(false)} sx={{ fontSize: 11 }}>Cancel</Button>
              <Button
                size="small" variant="contained" disabled={!newName || adding}
                onClick={() => void handleAdd()}
                sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, fontSize: 11 }}
              >
                {adding ? 'Adding…' : 'Add printer'}
              </Button>
            </Box>
          </Box>
        </Box>
      )}

      {/* Printer list */}
      {isLoading && <Skeleton height={48} sx={{ borderRadius: '6px' }} />}
      {!isLoading && printers.length === 0 && !showAdd && (
        <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
          No printers registered yet. Add one to enable automatic label routing.
        </Typography>
      )}
      {!isLoading && printers.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {printers.map(p => (
            <Box key={p.printer_id} sx={{
              display: 'flex', alignItems: 'center', gap: 1,
              p: 1, borderRadius: '6px',
              bgcolor: 'var(--bg-2)', border: `0.5px solid ${pal.rule}`,
            }}>
              <Box sx={{ color: ROLE_COLORS[p.role], flexShrink: 0 }}>
                {CONNECTION_ICONS[p.connection_type]}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.3 }} noWrap>
                  {p.name}
                </Typography>
                <Typography sx={{ fontSize: 11, color: 'var(--ink-3)' }}>
                  {p.os_printer_name ?? p.address ?? '—'}
                </Typography>
              </Box>
              <Chip
                label={ROLE_LABELS[p.role]}
                size="small"
                sx={{
                  fontSize: 10, height: 20, flexShrink: 0,
                  bgcolor: `${ROLE_COLORS[p.role]}18`,
                  color: ROLE_COLORS[p.role],
                  border: `0.5px solid ${ROLE_COLORS[p.role]}40`,
                }}
              />
              {p.is_default ? (
                <Tooltip title="Default for this role">
                  <Box sx={{ color: '#22C55E', flexShrink: 0 }}>
                    <CheckCircle size={13} />
                  </Box>
                </Tooltip>
              ) : (
                <Tooltip title="Set as default">
                  <Box
                    onClick={() => void handleSetDefault(p.printer_id, p.role)}
                    sx={{ cursor: 'pointer', color: 'var(--ink-4)', flexShrink: 0, '&:hover': { color: 'var(--accent)' } }}
                  >
                    <CheckCircle size={13} />
                  </Box>
                </Tooltip>
              )}
              <Tooltip title="Remove printer">
                <Box
                  onClick={() => void handleDelete(p.printer_id)}
                  sx={{ cursor: 'pointer', color: 'var(--ink-3)', flexShrink: 0, '&:hover': { color: 'error.main' } }}
                >
                  <Trash2 size={13} strokeWidth={1.75} />
                </Box>
              </Tooltip>
            </Box>
          ))}
        </Box>
      )}
    </SettingsCard>
  );
}

export default function ShopSettingsWarehousePage() {
  return (
    <SettingsPageWrapper>
      <UnitLabelCoverageSection />
      <PrintersSection />
      <FloorDisplaySection />
    </SettingsPageWrapper>
  );
}
