import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Typography } from '@mui/material';
import { ExternalLink, RefreshCw, Store } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import { SHOPIFY_APP_STORE_URL } from '../../lib/appStoreUrl';
import { SettingsCard, SettingsPageWrapper } from './ShopSettingsShared';

export type ShopifyConnectionState =
  | 'NOT_INSTALLED'
  | 'UNINSTALLED'
  | 'CONNECTED'
  | 'REFRESHING'
  | 'REAUTH_REQUIRED'
  | 'RECONNECT_IN_PROGRESS';

interface ConnectionStatus {
  integrationId: number | null;
  status: string;
  connectionState: ShopifyConnectionState;
  shopDomain: string | null;
  recoveryRequestOutstanding: boolean | null;
  lastSyncedAt: string | null;
  lastError: string | null;
}

const CONNECTION_COPY: Record<ShopifyConnectionState, { label: string; detail: string; tone: 'success' | 'warning' | 'default' }> = {
  NOT_INSTALLED: { label: 'Not installed', detail: 'Install LaSyncro from Shopify to connect this shop.', tone: 'default' },
  UNINSTALLED: { label: 'Uninstalled', detail: 'The Shopify app was removed. Reinstall it from the App Store to reconnect.', tone: 'warning' },
  CONNECTED: { label: 'Connected', detail: '', tone: 'success' },
  REFRESHING: { label: 'Refreshing', detail: 'Shopify access is being refreshed.', tone: 'default' },
  REAUTH_REQUIRED: { label: 'Authorization required', detail: 'Shopify authorization must be renewed before synchronization can continue.', tone: 'warning' },
  RECONNECT_IN_PROGRESS: { label: 'Reconnecting', detail: 'Shopify authorization is already in progress.', tone: 'default' },
};

const SYNC_LABELS: Record<string, string> = {
  NOT_FOUND: 'Not started',
  PENDING: 'Pending',
  FAILED: 'Failed',
  COMPLETED: 'Completed',
  SYNCING_PRODUCTS: 'Synchronizing products',
  SYNCING_ORDERS: 'Synchronizing orders',
  SYNCING_LINE_ITEMS: 'Synchronizing order details',
  SYNCING_INVENTORY: 'Synchronizing inventory',
  SYNCING_SHOP: 'Synchronizing store',
  COMPLETING: 'Finishing synchronization',
};

export function safeShopifyAuthorizationUrl(value: unknown, shopDomain: string): string | null {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shopDomain)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      url.hostname.toLowerCase() === shopDomain.toLowerCase() &&
      url.pathname === '/admin/oauth/authorize'
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function validStatus(value: unknown): value is SyncStatus {
  if (!value || typeof value !== 'object') return false;
  const row = value as SyncStatus;
  return Object.prototype.hasOwnProperty.call(CONNECTION_COPY, row.connectionState) &&
    Object.prototype.hasOwnProperty.call(SYNC_LABELS, row.status) &&
    (row.integrationId === null || (Number.isSafeInteger(row.integrationId) && row.integrationId > 0)) &&
    (row.recoveryRequestOutstanding === null || typeof row.recoveryRequestOutstanding === 'boolean') &&
    (row.shopDomain === null || (typeof row.shopDomain === 'string' && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(row.shopDomain))) &&
    (row.lastSyncedAt === null || (typeof row.lastSyncedAt === 'string' && Number.isFinite(Date.parse(row.lastSyncedAt))));
}

function formatLastSync(value: string | null): string {
  if (!value) return 'No successful synchronization yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'No successful synchronization yet' : new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  }).format(date);
}

type SyncStatus = ConnectionStatus;
const primarySx = {
  bgcolor: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: '6px', fontSize: 12,
  fontWeight: 600, textTransform: 'none', minHeight: 40, width: { xs: '100%', sm: 'auto' },
  '&:hover': { bgcolor: 'var(--accent-hover)' },
  '&:focus-visible': { outline: '2px solid var(--ink)', outlineOffset: 3 },
};
const refusalCopy: Record<string, string> = {
  SYNC_ALREADY_COMPLETED: 'Synchronization is already complete. No recovery was started.',
  SYNC_ALREADY_REQUESTED: 'Sync recovery has already been requested. Waiting to start.',
  SYNC_IN_PROGRESS: 'Synchronization is already running.',
  SHOPIFY_NOT_INSTALLED: 'Install LaSyncro from the Shopify App Store before retrying sync.',
  SHOPIFY_UNINSTALLED: 'Reinstall LaSyncro from the Shopify App Store before retrying sync.',
  SHOPIFY_REAUTH_REQUIRED: 'Reconnect Shopify before retrying sync.',
  SHOPIFY_RECONNECT_IN_PROGRESS: 'Shopify is reconnecting. Wait before retrying sync.',
};

export default function ShopifyConnectionsSettings() {
  const submitting = useRef(false);
  const [requestedId, setRequestedId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const statusQuery = useQuery<ConnectionStatus>({
    queryKey: ['shopify-connection-status'],
    queryFn: async () => (await axiosInstance.get('/api/v1/integrations/sync-status')).data,
    retry: false,
    refetchInterval: query => {
      const value = query.state.data;
      return validStatus(value) && (value.recoveryRequestOutstanding === true ||
        ['REFRESHING', 'RECONNECT_IN_PROGRESS'].includes(value.connectionState) ||
        !['FAILED', 'COMPLETED', 'NOT_FOUND'].includes(value.status)) ? 5000 : false;
    },
  });
  const permissionQuery = useQuery<boolean>({
    queryKey: ['integration-capabilities'],
    queryFn: async () => {
      try {
        const { data } = await axiosInstance.get('/api/v1/integrations/capabilities');
        if (data?.canManageConnection !== true) throw new Error('INVALID_CAPABILITY_RESPONSE');
        return true;
      } catch (error: any) {
        if (error?.response?.status === 403 && error?.response?.data?.error === 'ACTION_FORBIDDEN') return false;
        throw error;
      }
    },
    retry: false,
  });

  const status = validStatus(statusQuery.data) && !statusQuery.isError ? statusQuery.data : null;
  const canAct = permissionQuery.data === true && !permissionQuery.isError && !permissionQuery.isFetching;
  const installState = status?.connectionState === 'NOT_INSTALLED' || status?.connectionState === 'UNINSTALLED';
  const reconnectState = status?.connectionState === 'REAUTH_REQUIRED' && !!status.shopDomain;
  const retryState = !!status && ['CONNECTED', 'REFRESHING'].includes(status.connectionState) &&
    status.status === 'FAILED' && status.integrationId !== null &&
    status.recoveryRequestOutstanding === false;
  const requested = status?.recoveryRequestOutstanding === true;
  useEffect(() => {
    if (requestedId !== null && status?.recoveryRequestOutstanding === false && requestedId === status.integrationId) {
      setRequestedId(null);
      setFeedback(status.status === 'FAILED'
        ? 'The recovery attempt did not complete. You can retry synchronization.'
        : 'Sync recovery started. See the current synchronization status above.');
    }
  }, [requestedId, status]);

  const reconnect = async () => {
    if (!status?.shopDomain || !canAct || !reconnectState || submitting.current) return;
    submitting.current = true;
    setActionPending(true);
    setActionError(null);
    setFeedback('Opening Shopify authorization…');
    try {
      const response = await axiosInstance.get('/api/v1/integrations/oauth/initiate', {
        params: { platform: 'shopify', shop: status.shopDomain },
      });
      const target = safeShopifyAuthorizationUrl(response.data?.authorizationUrl, status.shopDomain);
      if (!target) throw new Error('UNSAFE_AUTHORIZATION_URL');
      window.location.assign(target);
    } catch {
      setFeedback(null);
      submitting.current = false;
      setActionError('Shopify reconnection could not be started. Please try again.');
      setActionPending(false);
    }
  };

  const retrySync = async () => {
    if (!status?.integrationId || !canAct || !retryState || requested || submitting.current) return;
    submitting.current = true;
    setActionPending(true);
    setActionError(null);
    try {
      const response = await axiosInstance.post(`/api/v1/integrations/sync/${status.integrationId}`);
      if (response.status !== 202 || response.data?.status !== 'SYNC_RECOVERY_REQUESTED') throw new Error('INVALID_RECOVERY_RESPONSE');
      setRequestedId(status.integrationId);
      setFeedback('Sync recovery requested. Waiting to start.');
      await statusQuery.refetch();
    } catch (error: any) {
      const code = error?.response?.data?.error;
      if (code === 'SYNC_ALREADY_REQUESTED') setRequestedId(status.integrationId);
      setActionError(error?.response?.status === 409
        ? refusalCopy[code] ?? 'Synchronization recovery is not available in the current state.'
        : 'Synchronization recovery could not be requested. Please try again.');
      if (error?.response?.status === 409) await statusQuery.refetch();
    } finally {
      submitting.current = false;
      setActionPending(false);
    }
  };

  const connection = status ? CONNECTION_COPY[status.connectionState] : null;

  return (
    <SettingsPageWrapper>
      <Box>
        <Typography component="h2" sx={{ m: 0, fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Connections</Typography>
      </Box>
      <SettingsCard icon={<Store size={18} aria-hidden="true" />} title="Shopify" description="Store connection">
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {statusQuery.isLoading ? <Box role="status" sx={{ display: 'flex', gap: 1, alignItems: 'center' }}><CircularProgress size={18} aria-hidden="true" />Loading Shopify connection…</Box>
            : !status || !connection ? <Alert severity="error" action={<Button color="inherit" onClick={() => statusQuery.refetch()}>Retry</Button>}>Shopify connection details could not be loaded.</Alert>
            : <>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflowWrap: 'anywhere' }}>{status.shopDomain ?? 'No verified Shopify store'}</Typography>
              {connection.detail && <Typography sx={{ mt: 0.5, fontSize: 12, fontWeight: 300, color: 'var(--ink-3)', maxWidth: 480 }}>{connection.detail}</Typography>}
            </Box>
            <Chip size="small" label={connection.label} sx={{ height: 'auto', py: 0.5, maxWidth: '100%', '& .MuiChip-label': { whiteSpace: 'normal' },
              bgcolor: connection.tone === 'default' ? 'var(--bg-3)' : connection.tone === 'success' ? 'var(--good-ghost)' : 'var(--warning-ghost)',
              color: connection.tone === 'default' ? 'var(--ink-2)' : connection.tone === 'success' ? 'var(--good-ink)' : 'var(--ink-2)' }} />
          </Box>

          <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
            <Box><Typography component="dt" sx={{ fontSize: 12, color: 'var(--ink-3)' }}>Synchronization</Typography><Typography component="dd" sx={{ m: 0, mt: 0.5, fontSize: 13, color: 'var(--ink)' }}>{SYNC_LABELS[status.status]}</Typography></Box>
            <Box><Typography component="dt" sx={{ fontSize: 12, color: 'var(--ink-3)' }}>Last successful sync</Typography><Typography component="dd" sx={{ m: 0, mt: 0.5, fontSize: 13, color: 'var(--ink)', overflowWrap: 'anywhere' }}>{formatLastSync(status.lastSyncedAt)}</Typography></Box>
          </Box>

          {(installState || reconnectState || retryState) && <>
            {permissionQuery.isFetching && <Typography role="status" sx={{ fontSize: 12 }}>Checking connection permissions…</Typography>}
            {permissionQuery.isError && <Alert severity="warning" action={<Button color="inherit" onClick={() => permissionQuery.refetch()}>Retry permissions</Button>}>Your permissions could not be verified.</Alert>}
            {!permissionQuery.isFetching && !permissionQuery.isError && permissionQuery.data === false && <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>You don’t have permission to manage this connection.</Typography>}
          </>}

          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {installState && canAct && SHOPIFY_APP_STORE_URL && <Button component="a" href={SHOPIFY_APP_STORE_URL} target="_blank" rel="noopener noreferrer" variant="contained" sx={primarySx} endIcon={<ExternalLink size={14} aria-hidden="true" />}>{status.connectionState === 'UNINSTALLED' ? 'Reinstall from App Store' : 'Install from App Store'}</Button>}
            {installState && !SHOPIFY_APP_STORE_URL && <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', fontStyle: 'italic' }}>Shopify App Store installation is not available yet.</Typography>}
            {reconnectState && canAct && <Button variant="contained" sx={primarySx} disabled={actionPending} onClick={reconnect} startIcon={<RefreshCw size={14} aria-hidden="true" />}>Reconnect Shopify</Button>}
            {retryState && canAct && !requested && <Button variant="contained" sx={primarySx} disabled={actionPending} onClick={retrySync} startIcon={<RefreshCw size={14} aria-hidden="true" />}>{actionPending ? 'Requesting…' : 'Retry synchronization'}</Button>}
          </Box>
          </>}
          <Box role={feedback ? 'status' : undefined} aria-live="polite">{feedback}</Box>
          {actionError && <Alert severity="error">{actionError}</Alert>}
        </Box>
      </SettingsCard>
    </SettingsPageWrapper>
  );
}
