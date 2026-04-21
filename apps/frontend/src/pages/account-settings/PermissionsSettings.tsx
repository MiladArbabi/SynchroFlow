// apps/frontend/src/pages/account-settings/PermissionsSettings.tsx
//
// PERMISSIONS SETTINGS (WM-19 v2)
// ---------------------------------
// Owner-only panel for configuring which roles can perform which actions.
// Renders a grouped permission matrix (domain → actions × roles).
// Locked actions are shown but not editable.
// Owner permissions are always granted and cannot be revoked.

import React, { useEffect, useState, useCallback } from 'react';
import {
  Box,
  Typography,
  Switch,
  Alert,
  CircularProgress,
  Chip,
  Tooltip,
  Divider,
  Button,
  Snackbar,
} from '@mui/material';
import { Lock } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  getPermissions,
  updatePermissions,
  type ActionPermission,
  type PermissionMatrix,
  type PermissionUpdate,
  type Role,
} from '../../api/permissions';

const ROLES: Role[] = ['owner', 'admin', 'operator'];

const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  operator: 'Operator',
};

const ROLE_COLORS: Record<Role, 'error' | 'warning' | 'info'> = {
  owner: 'error',
  admin: 'warning',
  operator: 'info',
};

// ─────────────────────────────────────────────
// DOMAIN GROUP
// ─────────────────────────────────────────────

function DomainGroup({
  domain,
  actions,
  pendingChanges,
  onToggle,
  isOwner,
}: {
  domain: string;
  actions: ActionPermission[];
  pendingChanges: Map<string, boolean>;
  onToggle: (action: string, role: Role, granted: boolean) => void;
  isOwner: boolean;
}) {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography
        variant="caption"
        fontWeight={700}
        color="text.secondary"
        sx={{ textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', mb: 1 }}
      >
        {domain}
      </Typography>

      {/* Header row */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5, px: 1 }}>
        <Box sx={{ flex: 1 }} />
        {ROLES.map((role) => (
          <Box key={role} sx={{ width: 80, textAlign: 'center' }}>
            <Chip
              label={ROLE_LABELS[role]}
              size="small"
              color={ROLE_COLORS[role]}
              variant="outlined"
              sx={{ fontSize: 10, height: 20 }}
            />
          </Box>
        ))}
      </Box>

      {actions.map((item, idx) => (
        <Box
          key={item.action}
          sx={{
            display: 'flex',
            alignItems: 'center',
            px: 1,
            py: 0.5,
            borderRadius: 1,
            bgcolor: idx % 2 === 0 ? 'background.default' : 'transparent',
          }}
        >
          {/* Action label */}
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="body2" fontSize={12}>
              {item.label}
            </Typography>
            {item.permissions.owner.locked && (
              <Tooltip title="This permission cannot be changed">
                <Lock size={11} style={{ opacity: 0.4 }} />
              </Tooltip>
            )}
          </Box>

          {/* Toggle per role */}
          {ROLES.map((role) => {
            const perm = item.permissions[role];
            const pendingKey = `${item.action}:${role}`;
            const currentValue = pendingChanges.has(pendingKey)
              ? pendingChanges.get(pendingKey)!
              : perm.granted;

            const isLocked = perm.locked || role === 'owner';
            const canEdit = isOwner && !isLocked;

            return (
              <Box key={role} sx={{ width: 80, display: 'flex', justifyContent: 'center' }}>
                <Tooltip
                  title={
                    role === 'owner'
                      ? 'Owner always has full access'
                      : perm.locked
                      ? 'This permission is locked'
                      : !isOwner
                      ? 'Only owners can change permissions'
                      : ''
                  }
                >
                  <span>
                    <Switch
                      size="small"
                      checked={currentValue}
                      disabled={!canEdit}
                      onChange={(e) => onToggle(item.action, role, e.target.checked)}
                      sx={{ opacity: isLocked ? 0.4 : 1 }}
                    />
                  </span>
                </Tooltip>
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────

const PermissionsSettings: React.FC = () => {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';

  const [matrix, setMatrix] = useState<PermissionMatrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState<Map<string, boolean>>(new Map());
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getPermissions()
      .then(setMatrix)
      .catch(() => setError('Failed to load permissions.'))
      .finally(() => setLoading(false));
  }, []);

  const handleToggle = useCallback((action: string, role: Role, granted: boolean) => {
    setPendingChanges((prev) => {
      const next = new Map(prev);
      next.set(`${action}:${role}`, granted);
      return next;
    });
  }, []);

  const handleSave = async () => {
    if (pendingChanges.size === 0) return;
    setSaving(true);
    setSaveError(null);

    const updates: PermissionUpdate[] = Array.from(pendingChanges.entries()).map(([key, granted]) => {
      const [action, role] = key.split(':') as [string, Role];
      return { action, role, granted };
    });

    try {
      const result = await updatePermissions(updates);
      if (result.rejected.length > 0) {
        setSaveError(`${result.rejected.length} change(s) rejected. Locked or invalid actions cannot be changed.`);
      } else {
        setSaveSuccess(true);
        setPendingChanges(new Map());
        // Reload matrix to reflect server state
        const fresh = await getPermissions();
        setMatrix(fresh);
      }
    } catch {
      setSaveError('Failed to save permissions. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setPendingChanges(new Map());
    setSaveError(null);
  };

  // Group actions by domain
  const grouped: Record<string, ActionPermission[]> = matrix
    ? matrix.actions.reduce<Record<string, ActionPermission[]>>((acc: Record<string, ActionPermission[]>, item: ActionPermission) => {
        if (!acc[item.domain]) acc[item.domain] = [];
        acc[item.domain].push(item);
        return acc;
      }, {})
    : {};

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: 4 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
        <Box>
          <Typography variant="h6" fontWeight={600}>
            Role Permissions
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Configure which actions each role can perform in your warehouse.
            {!isOwner && (
              <Typography component="span" color="warning.main" fontWeight={500}>
                {' '}View only — only owners can change permissions.
              </Typography>
            )}
          </Typography>
        </Box>

        {isOwner && pendingChanges.size > 0 && (
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button size="small" onClick={handleDiscard} disabled={saving}>
              Discard
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? 'Saving...' : `Save ${pendingChanges.size} change${pendingChanges.size > 1 ? 's' : ''}`}
            </Button>
          </Box>
        )}
      </Box>

      {saveError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setSaveError(null)}>
          {saveError}
        </Alert>
      )}

      {Object.entries(grouped).map(([domain, actions], idx) => (
        <React.Fragment key={domain}>
          {idx > 0 && <Divider sx={{ my: 2 }} />}
          <DomainGroup
            domain={domain}
            actions={actions}
            pendingChanges={pendingChanges}
            onToggle={handleToggle}
            isOwner={isOwner}
          />
        </React.Fragment>
      ))}

      <Snackbar
        open={saveSuccess}
        autoHideDuration={3000}
        onClose={() => setSaveSuccess(false)}
        message="Permissions saved successfully"
      />
    </Box>
  );
};

export default PermissionsSettings;