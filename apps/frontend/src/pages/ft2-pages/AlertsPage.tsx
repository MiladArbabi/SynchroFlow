import { useEffect } from 'react';
import {
  Box,
  Chip,
  Skeleton,
  Typography,
} from '@mui/material';
import {
  AlertCircle,
  Bell,
  Info,
} from 'lucide-react';
import {
  useLocation,
  useNavigate,
} from 'react-router-dom';

import { ModuleTabBar } from '../../components/ModuleTabBar';
import AlertsSettingsPanel from '../alerts/AlertsSettingsPanel';
import {
  type RecentNotification,
  useMarkNotificationClicked,
  useMarkNotificationRead,
  useRecentNotifications,
} from '../alerts/useNotifications';

const ALERTS_TABS = [
  {
    id: 'recent',
    label: 'Recent',
    path: '/alerts',
  },
  {
    id: 'settings',
    label: 'Settings',
    path: '/alerts/settings',
  },
];

function relativeAge(value: string): string {
  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) return '';

  const seconds = Math.max(
    0,
    Math.floor((Date.now() - timestamp) / 1000),
  );

  if (seconds < 60) return 'just now';
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }

  return `${Math.floor(seconds / 86400)}d ago`;
}

function urgencyPresentation(
  urgency: RecentNotification['urgency'],
) {
  if (urgency === 'critical') {
    return {
      label: 'Critical',
      icon: AlertCircle,
      color: 'var(--critical-ink)',
    };
  }

  if (urgency === 'important') {
    return {
      label: 'Important',
      icon: Bell,
      color: 'var(--warning-ink)',
    };
  }

  return {
    label: 'Info',
    icon: Info,
    color: 'var(--ink-3)',
  };
}

function stateLabel(
  state: RecentNotification['state'],
): string {
  if (state === 'unread') return 'Unread';
  if (state === 'clicked') return 'Clicked';
  return 'Read';
}

function NotificationRow({
  notification,
  onRead,
  onOpen,
}: {
  notification: RecentNotification;
  onRead: (notificationId: string) => void;
  onOpen: (
    notification: RecentNotification,
  ) => Promise<void>;
}) {
  const presentation =
    urgencyPresentation(notification.urgency);
  const UrgencyIcon = presentation.icon;
  const isUnread = notification.state === 'unread';

  return (
    <Box
      onClick={() => {
        if (isUnread) onRead(notification.id);
      }}
      sx={{
        display: 'flex',
        gap: 1.5,
        p: 1.75,
        border: '1px solid var(--rule)',
        borderRadius: '10px',
        bgcolor: isUnread
          ? 'var(--surface)'
          : 'var(--bg-2)',
        cursor: isUnread ? 'pointer' : 'default',
      }}
    >
      <Box
        sx={{
          width: 28,
          height: 28,
          flexShrink: 0,
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'var(--bg-3)',
        }}
      >
        <UrgencyIcon
          size={15}
          color="currentColor"
        />
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            flexWrap: 'wrap',
            mb: 0.5,
          }}
        >
          <Typography
            sx={{
              fontSize: 13,
              fontWeight: isUnread ? 600 : 500,
              color: 'var(--ink)',
            }}
          >
            {notification.title}
          </Typography>

          <Chip
            label={presentation.label}
            size="small"
            sx={{
              height: 20,
              fontSize: 10,
              color: presentation.color,
            }}
          />

          <Chip
            label={stateLabel(notification.state)}
            size="small"
            variant="outlined"
            sx={{
              height: 20,
              fontSize: 10,
            }}
          />

          <Typography
            sx={{
              ml: 'auto',
              fontSize: 11,
              color: 'var(--ink-4)',
              whiteSpace: 'nowrap',
            }}
          >
            {relativeAge(notification.created_at)}
          </Typography>
        </Box>

        <Typography
          sx={{
            fontSize: 12,
            color: 'var(--ink-3)',
            lineHeight: 1.5,
          }}
        >
          {notification.message}
        </Typography>

        {notification.action && (
          <Box
            component="button"
            type="button"
            onClick={async (event: React.MouseEvent) => {
              event.stopPropagation();
              await onOpen(notification);
            }}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              mt: 1,
              px: 1.25,
              py: 0.5,
              fontFamily: 'inherit',
              fontSize: 11,
              fontWeight: 500,
              color: 'var(--accent-text)',
              bgcolor: 'transparent',
              border: '0.5px solid var(--accent)',
              borderRadius: '6px',
              cursor: 'pointer',
              '&:hover': { opacity: 0.75 },
              '&:focus-visible': {
                outline: '2px solid var(--accent)',
                outlineOffset: '2px',
              },
            }}
          >
            {notification.action.label} →
          </Box>
        )}
      </Box>
    </Box>
  );
}

function RecentPanel() {
  const navigate = useNavigate();

  const recent = useRecentNotifications();
  const markRead = useMarkNotificationRead();
  const markClicked = useMarkNotificationClicked();

  const notifications = recent.data?.notifications ?? [];
  const unreadCount = recent.data?.unread_count ?? 0;

  if (recent.isLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        }}
      >
        {[1, 2, 3].map((item) => (
          <Skeleton
            key={item}
            variant="rounded"
            height={92}
          />
        ))}
      </Box>
    );
  }

  if (recent.isError) {
    return (
      <Box
        sx={{
          p: 3,
          border: '1px solid var(--rule)',
          borderRadius: '10px',
          bgcolor: 'var(--surface)',
          textAlign: 'center',
        }}
      >
        <Typography
          sx={{
            fontSize: 13,
            color: 'var(--ink-3)',
          }}
        >
          Could not load recent notifications.
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          mb: 2,
        }}
      >
        <Typography
          sx={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--ink)',
          }}
        >
          Recent notifications
        </Typography>

        {unreadCount > 0 && (
          <Chip
            label={`${unreadCount} unread`}
            size="small"
            sx={{ height: 22, fontSize: 11 }}
          />
        )}
      </Box>

      {notifications.length === 0 ? (
        <Box
          sx={{
            p: 4,
            border: '1px solid var(--rule)',
            borderRadius: '10px',
            bgcolor: 'var(--surface)',
            textAlign: 'center',
          }}
        >
          <Typography
            sx={{
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--ink)',
            }}
          >
            No recent notifications.
          </Typography>

          <Typography
            sx={{
              fontSize: 12,
              color: 'var(--ink-3)',
              mt: 0.5,
            }}
          >
            Important updates will appear here.
          </Typography>
        </Box>
      ) : (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          {notifications.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              onRead={(notificationId) => {
                markRead.mutate(notificationId);
              }}
              onOpen={async (selected) => {
                if (!selected.action) return;

                try {
                  await markClicked.mutateAsync(selected.id);
                } finally {
                  navigate(selected.action.route);
                }
              }}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

export default function AlertsPage() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const isSettings = pathname === '/alerts/settings';

  useEffect(() => {
    if (
      pathname !== '/alerts'
      && pathname !== '/alerts/settings'
    ) {
      navigate('/alerts', { replace: true });
    }
  }, [navigate, pathname]);

  return (
    <Box
      sx={{
        bgcolor: 'var(--bg)',
        minHeight: '100%',
        p: 3,
      }}
    >
      <Box sx={{ mb: 2 }}>
        <Typography
          sx={{
            fontSize: 22,
            fontWeight: 500,
            color: 'var(--ink)',
          }}
        >
          Alerts
        </Typography>

        <Typography
          sx={{
            fontSize: 13,
            color: 'var(--ink-3)',
            mt: 0.5,
          }}
        >
          {isSettings
            ? 'Choose what should notify you and how.'
            : 'A lightweight history of notifications sent to you.'}
        </Typography>
      </Box>

      <ModuleTabBar tabs={ALERTS_TABS} />

      <Box sx={{ mt: 3 }}>
        {isSettings
          ? <AlertsSettingsPanel />
          : <RecentPanel />}
      </Box>
    </Box>
  );
}
