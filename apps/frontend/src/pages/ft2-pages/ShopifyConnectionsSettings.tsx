import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Typography } from '@mui/material';
import { ExternalLink, RefreshCw, Store, Unplug } from 'lucide-react';
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
  | 'UNINSTALL_VERIFICATION_UNRESOLVED'
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
  UNINSTALL_VERIFICATION_UNRESOLVED: { label: 'Uninstall verification unresolved', detail: 'Shopify reported an uninstall, but LaSyncro cannot safely verify which authorization it affected. Shopify synchronization is paused; the store owner can reconnect to establish verified authority.', tone: 'warning' },
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
  SHOPIFY_UNINSTALL_VERIFICATION_UNRESOLVED: 'The store owner must reconnect Shopify before retrying sync.',
  SHOPIFY_RECONNECT_IN_PROGRESS: 'Shopify is reconnecting. Wait before retrying sync.',
};
// GH-979 C: an unconfirmed outcome is never presented as success or as "nothing changed".
const DISCONNECT_UNKNOWN = 'We couldn’t confirm whether Shopify completed the uninstall. Check the connection status above before trying again.';
const disconnectErrorCopy: Record<string, string> = {
  OWNER_REQUIRED: 'Only the store owner can disconnect Shopify.',
  SHOPIFY_NOT_CONNECTED: 'Shopify is no longer connected. Nothing else was changed.',
  SHOPIFY_DISCONNECT_IN_PROGRESS: 'A Shopify disconnect is already in progress.',
  DISCONNECT_CONFIRMATION_MISMATCH: 'The connected store changed. Review the current connection and try again.',
  SHOPIFY_IDENTITY_MISMATCH: 'Shopify answered for a different store. Nothing was changed.',
  SHOPIFY_DISCONNECT_REJECTED: 'Shopify declined the uninstall. Nothing was changed.',
  SHOPIFY_REAUTH_REQUIRED: 'Shopify authorization must be renewed before LaSyncro can uninstall itself. Nothing was changed.',
  SHOPIFY_AUTHORIZATION_REJECTED: 'Shopify no longer accepts LaSyncro’s authorization, so the uninstall was not sent. Check the connection status above.',
  SHOPIFY_UNAVAILABLE: 'Shopify couldn’t be reached. Nothing was changed. Please try again.',
  SHOPIFY_CREDENTIAL_UNAVAILABLE: 'The Shopify connection is busy. Nothing was changed. Please try again.',
  SHOPIFY_DISCONNECT_FAILED: 'Shopify could not be disconnected. Nothing was changed. Please try again.',
  SHOPIFY_DISCONNECT_OUTCOME_UNKNOWN: DISCONNECT_UNKNOWN,
  SHOPIFY_DISCONNECT_NOT_APPLIED: 'Shopify confirms LaSyncro is still installed on this store, so the uninstall did not take effect. Nothing was changed.',
  SHOPIFY_DISCONNECT_NOT_PENDING: 'There is no unconfirmed disconnect to check. The status above is current.',
};

// GH-979 C: a durable, unresolved disconnect keeps Shopify fail-closed and visible.
type DisconnectRecovery = 'CHECK_LATER' | 'RECONNECT';
interface UnresolvedDisconnect {
  status: 'IN_PROGRESS' | 'OUTCOME_UNKNOWN' | 'LOCAL_FENCE_PENDING';
  shopDomain: string;
  recovery: DisconnectRecovery | null;
}
interface DisconnectCapability { canDisconnectShopify: boolean; disconnect: UnresolvedDisconnect | null }

function validUnresolvedDisconnect(value: unknown): value is UnresolvedDisconnect {
  const row = value as UnresolvedDisconnect | null;
  return !!row && ['IN_PROGRESS', 'OUTCOME_UNKNOWN', 'LOCAL_FENCE_PENDING'].includes(row.status) &&
    typeof row.shopDomain === 'string' && [null, 'CHECK_LATER', 'RECONNECT'].includes(row.recovery);
}

const RECOVERY_COPY: Record<DisconnectRecovery, string> = {
  CHECK_LATER: 'You can ask LaSyncro to check with Shopify again in a few minutes.',
  RECONNECT: 'Shopify still can’t confirm the result. Reconnect Shopify, or reinstall LaSyncro from the Shopify App Store, to restore the connection.',
};
function unresolvedCopy(disconnect: UnresolvedDisconnect): string {
  if (disconnect.status === 'LOCAL_FENCE_PENDING') {
    return `Shopify confirmed that LaSyncro was uninstalled from ${disconnect.shopDomain}. LaSyncro is finishing the disconnect; Shopify synchronization is paused.`;
  }
  if (disconnect.status === 'IN_PROGRESS') {
    return `LaSyncro is uninstalling itself from ${disconnect.shopDomain}. Shopify synchronization is paused.`;
  }
  return `LaSyncro asked Shopify to uninstall the app from ${disconnect.shopDomain}, but the result couldn’t be confirmed. Shopify synchronization is paused until it is. ${RECOVERY_COPY[disconnect.recovery ?? 'CHECK_LATER']}`;
}
const destructiveOutlineSx = {
  borderRadius: '6px', fontSize: 12, fontWeight: 600, textTransform: 'none', minHeight: 40,
  width: { xs: '100%', sm: 'auto' }, color: 'error.main', borderColor: 'error.main',
  '&:focus-visible': { outline: '2px solid var(--ink)', outlineOffset: 3 },
};
const destructiveSx = {
  ...destructiveOutlineSx, bgcolor: 'error.main', color: 'white', '&:hover': { bgcolor: 'error.dark' },
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
  const activeConnection = !!status?.shopDomain && ['CONNECTED', 'REFRESHING'].includes(status.connectionState);
  // GH-979 C: advisory owner-only gate from current server membership; the
  // disconnect endpoint re-checks authority itself. An unresolved disconnect
  // reads as REAUTH_REQUIRED, so it is looked up there too.
  const disconnectCapabilityQuery = useQuery<DisconnectCapability>({
    queryKey: ['shopify-disconnect-capability'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/integrations/shopify/disconnect/capability');
      return { canDisconnectShopify: data?.canDisconnectShopify === true,
        disconnect: validUnresolvedDisconnect(data?.disconnect) ? data.disconnect : null };
    },
    enabled: !!status?.shopDomain && ['CONNECTED', 'REFRESHING', 'REAUTH_REQUIRED', 'UNINSTALL_VERIFICATION_UNRESOLVED'].includes(status.connectionState),
    retry: false,
  });
  const capability = !disconnectCapabilityQuery.isError ? disconnectCapabilityQuery.data : undefined;
  const unresolvedDisconnect = status?.connectionState === 'REAUTH_REQUIRED' ? capability?.disconnect ?? null : null;
  const canDisconnect = activeConnection && capability?.canDisconnectShopify === true;
  const canCheckDisconnect = !!unresolvedDisconnect && capability?.canDisconnectShopify === true &&
    unresolvedDisconnect.status !== 'IN_PROGRESS' && unresolvedDisconnect.recovery !== 'RECONNECT';
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnectPending, setDisconnectPending] = useState(false);
  const canAct = permissionQuery.data === true && !permissionQuery.isError && !permissionQuery.isFetching;
  const installState = status?.connectionState === 'NOT_INSTALLED' || status?.connectionState === 'UNINSTALLED';
  const reconnectState = !!status?.shopDomain && ['REAUTH_REQUIRED', 'UNINSTALL_VERIFICATION_UNRESOLVED'].includes(status.connectionState);
  const canReconnect = reconnectState && canAct && (status?.connectionState !== 'UNINSTALL_VERIFICATION_UNRESOLVED'
    || capability?.canDisconnectShopify === true);
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

  const presentDisconnectResponse = (response: { status: number; data?: any }, shopDomain: string) => {
    if (response.status === 200 && response.data?.status === 'SHOPIFY_DISCONNECTED') {
      setFeedback(`LaSyncro was uninstalled from ${shopDomain}. Your LaSyncro workspace and history are kept. Reinstall from the Shopify App Store to reconnect.`);
    } else if (response.status === 202 && response.data?.status === 'SHOPIFY_DISCONNECT_PENDING_CONFIRMATION') {
      setFeedback(response.data?.reason === 'AUTHORITY_CHANGED'
        ? 'Shopify confirmed the uninstall, but the Shopify connection has changed since. The status above is current.'
        : 'Shopify confirmed the uninstall. LaSyncro is finishing the disconnect; the status above will update.');
    } else {
      setActionError(DISCONNECT_UNKNOWN);
    }
  };

  const disconnectRequest = async (path: string, shopDomain: string) => {
    submitting.current = true;
    setDisconnectPending(true);
    setActionError(null);
    setFeedback(null);
    try {
      presentDisconnectResponse(await axiosInstance.post(path, { confirmShopDomain: shopDomain }), shopDomain);
      setConfirmingDisconnect(false);
    } catch (error: any) {
      const code = error?.response?.data?.error;
      // No response at all: the request may still have reached Shopify.
      setActionError(error?.response ? disconnectErrorCopy[code] ?? DISCONNECT_UNKNOWN : DISCONNECT_UNKNOWN);
      setConfirmingDisconnect(false);
    } finally {
      submitting.current = false;
      setDisconnectPending(false);
      await Promise.all([statusQuery.refetch(), disconnectCapabilityQuery.refetch()]);
    }
  };

  const disconnect = async () => {
    if (!status?.shopDomain || !canDisconnect || submitting.current) return;
    await disconnectRequest('/api/v1/integrations/shopify/disconnect', status.shopDomain);
  };

  // Re-checks with Shopify; the server never resends the uninstall.
  const checkDisconnect = async () => {
    if (!unresolvedDisconnect || !canCheckDisconnect || submitting.current) return;
    await disconnectRequest('/api/v1/integrations/shopify/disconnect/reconcile', unresolvedDisconnect.shopDomain);
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

          {unresolvedDisconnect && (
            <Alert severity="warning" action={canCheckDisconnect
              ? <Button color="inherit" disabled={disconnectPending} onClick={checkDisconnect} sx={{ textTransform: 'none', minHeight: 40 }}>{disconnectPending ? 'Checking…' : 'Check with Shopify again'}</Button>
              : undefined}>
              {unresolvedCopy(unresolvedDisconnect)}
            </Alert>
          )}

          {(installState || reconnectState || retryState) && <>
            {permissionQuery.isFetching && <Typography role="status" sx={{ fontSize: 12 }}>Checking connection permissions…</Typography>}
            {permissionQuery.isError && <Alert severity="warning" action={<Button color="inherit" onClick={() => permissionQuery.refetch()}>Retry permissions</Button>}>Your permissions could not be verified.</Alert>}
            {!permissionQuery.isFetching && !permissionQuery.isError && permissionQuery.data === false && <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>You don’t have permission to manage this connection.</Typography>}
          </>}

          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {installState && canAct && SHOPIFY_APP_STORE_URL && <Button component="a" href={SHOPIFY_APP_STORE_URL} target="_blank" rel="noopener noreferrer" variant="contained" sx={primarySx} endIcon={<ExternalLink size={14} aria-hidden="true" />}>{status.connectionState === 'UNINSTALLED' ? 'Reinstall from App Store' : 'Install from App Store'}</Button>}
            {installState && !SHOPIFY_APP_STORE_URL && <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', fontStyle: 'italic' }}>Shopify App Store installation is not available yet.</Typography>}
            {reconnectState && canReconnect && <Button variant="contained" sx={primarySx} disabled={actionPending} onClick={reconnect} startIcon={<RefreshCw size={14} aria-hidden="true" />}>Reconnect Shopify</Button>}
            {retryState && canAct && !requested && <Button variant="contained" sx={primarySx} disabled={actionPending} onClick={retrySync} startIcon={<RefreshCw size={14} aria-hidden="true" />}>{actionPending ? 'Requesting…' : 'Retry synchronization'}</Button>}
            {canDisconnect && !confirmingDisconnect && <Button variant="outlined" sx={destructiveOutlineSx} disabled={actionPending || disconnectPending} onClick={() => { setActionError(null); setConfirmingDisconnect(true); }} startIcon={<Unplug size={14} aria-hidden="true" />}>Disconnect Shopify</Button>}
          </Box>

          {canDisconnect && confirmingDisconnect && (
            <Box role="group" aria-labelledby="shopify-disconnect-title" sx={{ p: 1.5, bgcolor: 'var(--bg-2)', border: '0.5px solid var(--rule)', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography id="shopify-disconnect-title" sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflowWrap: 'anywhere' }}>
                Uninstall LaSyncro from {status.shopDomain}?
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.25, display: 'flex', flexDirection: 'column', gap: 0.5, fontSize: 12, color: 'var(--ink-2)' }}>
                <li>Shopify removes LaSyncro from this store and revokes its access. This can’t be undone from LaSyncro.</li>
                <li>Shopify synchronization stops: new orders, product and inventory updates no longer arrive, and LaSyncro stops updating Shopify.</li>
                <li>Your LaSyncro workspace, users, orders, inventory and history are kept.</li>
                <li>To reconnect, reinstall LaSyncro from the Shopify App Store.</li>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button variant="contained" sx={destructiveSx} disabled={disconnectPending} onClick={disconnect}>
                  {disconnectPending ? 'Disconnecting…' : 'Uninstall from Shopify'}
                </Button>
                <Button variant="text" sx={{ textTransform: 'none', fontSize: 12, color: 'var(--ink-3)', minHeight: 40 }} disabled={disconnectPending} onClick={() => setConfirmingDisconnect(false)}>
                  Cancel
                </Button>
              </Box>
            </Box>
          )}
          </>}
          <Box role={feedback ? 'status' : undefined} aria-live="polite">{feedback}</Box>
          {actionError && <Alert severity="error">{actionError}</Alert>}
        </Box>
      </SettingsCard>
    </SettingsPageWrapper>
  );
}
