import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { axiosInstance } from 'api/axiosConfig';
import './shopifyConnectionBadge.css';

export type ShopifyConnectionState =
  | 'NOT_INSTALLED'
  | 'UNINSTALLED'
  | 'CONNECTED'
  | 'REFRESHING'
  | 'REAUTH_REQUIRED'
  | 'UNINSTALL_VERIFICATION_UNRESOLVED'
  | 'RECONNECT_IN_PROGRESS';

type BadgeTone = 'connected' | 'reconnecting' | 'disconnected';

export interface ShopifyConnectionBadgePresentation {
  tone: BadgeTone;
  label: string;
}

const PRESENTATION: Record<ShopifyConnectionState, ShopifyConnectionBadgePresentation> = {
  CONNECTED: { tone: 'connected', label: 'Connected' },
  REFRESHING: { tone: 'reconnecting', label: 'Refreshing' },
  RECONNECT_IN_PROGRESS: { tone: 'reconnecting', label: 'Reconnecting' },
  NOT_INSTALLED: { tone: 'disconnected', label: 'Not installed' },
  UNINSTALLED: { tone: 'disconnected', label: 'Uninstalled' },
  REAUTH_REQUIRED: { tone: 'disconnected', label: 'Authorization required' },
  UNINSTALL_VERIFICATION_UNRESOLVED: { tone: 'disconnected', label: 'Status unresolved' },
};

const UNAVAILABLE: ShopifyConnectionBadgePresentation = {
  tone: 'disconnected',
  label: 'Status unavailable',
};

interface ConnectionStatusResponse {
  connectionState: ShopifyConnectionState;
  recoveryRequestOutstanding: boolean | null;
  status: string;
}

function isConnectionStatusResponse(value: unknown): value is ConnectionStatusResponse {
  if (!value || typeof value !== 'object') return false;
  const status = value as Partial<ConnectionStatusResponse>;
  return typeof status.connectionState === 'string'
    && Object.prototype.hasOwnProperty.call(PRESENTATION, status.connectionState)
    && (status.recoveryRequestOutstanding === null || typeof status.recoveryRequestOutstanding === 'boolean')
    && typeof status.status === 'string';
}

export function getShopifyConnectionBadgePresentation(
  value: unknown,
): ShopifyConnectionBadgePresentation {
  return isConnectionStatusResponse(value) ? PRESENTATION[value.connectionState] : UNAVAILABLE;
}

function ShopifyStatusGlyph() {
  return (
    <svg className="shopify-connection-badge__glyph" viewBox="0 0 16 16" aria-hidden="true">
      <circle className="shopify-connection-badge__arc" cx="8" cy="8" r="6.25" pathLength="100" />
      <circle className="shopify-connection-badge__core" cx="8" cy="8" r="3.25" />
      <line className="shopify-connection-badge__slash" x1="3.4" y1="12.6" x2="12.6" y2="3.4" />
    </svg>
  );
}

export function ShopifyConnectionBadge() {
  const navigate = useNavigate();
  const location = useLocation();
  const statusQuery = useQuery<unknown>({
    queryKey: ['shopify-connection-status'],
    queryFn: async () => (await axiosInstance.get('/api/v1/integrations/sync-status')).data,
    retry: false,
    refetchInterval: query => {
      const value = query.state.data;
      if (!isConnectionStatusResponse(value)) return false;
      return value.recoveryRequestOutstanding === true
        || ['REFRESHING', 'RECONNECT_IN_PROGRESS'].includes(value.connectionState)
        || !['FAILED', 'COMPLETED', 'NOT_FOUND'].includes(value.status)
        ? 5000
        : false;
    },
  });
  const presentation = statusQuery.isError || statusQuery.isPending
    ? UNAVAILABLE
    : getShopifyConnectionBadgePresentation(statusQuery.data);
  const accessibleStatus = `Shopify connection: ${presentation.label}. Open connection settings`;

  return (
    <button
      type="button"
      className="shopify-connection-badge"
      data-state={presentation.tone}
      aria-label={accessibleStatus}
      title={accessibleStatus}
      onClick={() => navigate('/settings/connections', { state: { backgroundLocation: location } })}
    >
      <ShopifyStatusGlyph />
      <span aria-hidden="true">
        Shopify {presentation.tone !== 'connected' && <strong>· {presentation.label}</strong>}
      </span>
    </button>
  );
}
