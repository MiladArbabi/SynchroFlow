// apps/frontend/src/pages/ft2-pages/MembersPage.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from 'contexts/AuthContext';
// ISS-051: Team lives outside ShopSettingsPage's <Routes> subtree (route
// owned by LifecycleRouteHost.tsx at /team, not /settings/team — see
// ISS-048). Rendering the shared ModuleTabBar here keeps the tab row
// visible when navigating Settings → Team instead of it disappearing.
import {
  Box, Typography, CircularProgress, Alert as MuiAlert,
  Table, TableBody, TableCell, TableHead, TableRow,
  Select, MenuItem, Chip, Button,
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, FormControl, InputLabel,
  Stack,
} from '@mui/material';
import { UserPlus } from 'lucide-react';
import { useMembers, useUpdateMemberRole, useCreateMember, type MemberRole, type SeatCapacity } from '../members/useMembers';
import { useUiEvents } from '../../analytics/useUiEvents';
import { useEntitlements } from '../../contexts/EntitlementsContext';
import { UpgradePrompt } from '../../components/UpgradePrompt';
import { AddSeatsModal } from '../../components/AddSeatsModal';
import { LinearProgress } from '@mui/material';
import { SettingsShellHeader } from './SettingsShellHeader';

/**
 * MEMBERS PAGE (WM-31)
 * --------------------
 * Owner/admin surface for viewing, managing, and creating shop members.
 *
 * Create flow:
 * - Modal opens per row (pre-selects no role — admin must choose)
 * - Backend generates temporary password + sends invite email
 * - Email is non-fatal: user is created regardless of delivery
 *
 * Role source of truth: shop_memberships.role
 * Synced to users.role on change until WM-19 deprecates users.role.
 */

const ROLE_COLORS: Record<MemberRole, 'default' | 'primary' | 'secondary'> = {
  owner: 'primary',
  admin: 'secondary',
  operator: 'default',
};

const VALID_ROLES: MemberRole[] = ['owner', 'admin', 'operator'];

interface CreateMemberForm {
  email: string;
  first_name: string;
  last_name: string;
  role: MemberRole | '';
}

const EMPTY_FORM: CreateMemberForm = {
  email: '',
  first_name: '',
  last_name: '',
  role: '',
};

function resolveUpgradeTier(seatCapacity: SeatCapacity | undefined): 'core' | 'growth' | 'scale' {
  if (seatCapacity?.tier === 'core') return 'growth';
  if (seatCapacity?.tier === 'growth') return 'scale';
  return 'core';
}

export default function MembersPage() {
  const { data, isLoading, isError, error, refetch } = useMembers();
  const is403 = (error as Error & { response?: { status?: number } })?.response?.status === 403;

  const { mutate: updateRole, isPending: isUpdating } = useUpdateMemberRole();
  const { mutate: createMember, isPending: isCreating, error: createError, reset: resetCreate } = useCreateMember();

  const { user } = useAuth();
  const canWrite = user?.role === 'owner' || user?.role === 'admin';

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<CreateMemberForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [successEmail, setSuccessEmail] = useState<string | null>(null);

  const navigate = useNavigate();
  const members = data?.members ?? [];
  const seatCapacity = data?.seat_capacity;
  const { emit } = useUiEvents();
  // SHB-03/SHB-05 interim: Shopify-billed shops have no pay-per-order path
  // (Managed Pricing has no usage add-on built yet) — hard cap + upgrade only.
  const { billingProvider } = useEntitlements();
  const seatUsagePct = seatCapacity && seatCapacity.limit > 0
    ? (seatCapacity.current / seatCapacity.limit) * 100
    : 100;
  const remainingSeats = seatCapacity
    ? Math.max(0, seatCapacity.limit - seatCapacity.current)
    : 0;
  const atSeatLimit = !seatCapacity || seatCapacity.current >= seatCapacity.limit;
  const nearSeatLimit =
    !!seatCapacity &&
    seatCapacity.limit > 0 &&
    seatUsagePct >= 80 &&
    !atSeatLimit;
  const [seatLimitModalOpen, setSeatLimitModalOpen] = useState(false);
  const showAddSeatsModal =
    !!seatCapacity &&
    (seatCapacity.tier === 'core' || seatCapacity.tier === 'growth') &&
    billingProvider !== 'shopify';
  const showScaleCapacityDialog = seatCapacity?.tier === 'scale';
  const showUnresolvedCapacityDialog = !seatCapacity;
  const upgradeTier = resolveUpgradeTier(seatCapacity);

  const openModal = () => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setSuccessEmail(null);
    resetCreate();
    setModalOpen(true);
  };

  const openCapacityResolution = () => {
    setSeatLimitModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setFormError(null);
    setSuccessEmail(null);
    resetCreate();
  };

  const handleConfirm = () => {
    if (!form.email || !form.role) {
      setFormError('Email and role are required.');
      return;
    }
    setFormError(null);

    createMember(
      {
        email: form.email.trim(),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        role: form.role as MemberRole,
      },
      {
        onSuccess: (data) => {
          setSuccessEmail(data.email);
          emit('team.invite_sent', {
            invite_count: 1,
            workspace_operator_total: members.length + 1,
          });
        },
        onError: async (err: Error & { response?: { data?: { error?: string } } }) => {
          const msg = err?.response?.data?.error;
          if (msg === 'SEAT_LIMIT_REACHED') {
            closeModal();
            await refetch();
            openCapacityResolution();
            return;
          }
          setFormError(
            msg === 'EMAIL_ALREADY_IN_USE'
              ? 'This email is already registered.'
              : 'Failed to create member. Please try again.'
          );
        },
      }
    );
  };

  return (
  <>
    <SettingsShellHeader />
      <Box sx={{ p: 3 }}>

      {/* HEADER */}
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2, py: 2 }}>
            Team
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Manage shop members and their roles.
          </Typography>
        </Box>
        {canWrite && (
          <Button
            variant="contained"
            startIcon={<UserPlus size={16} />}
            onClick={atSeatLimit ? openCapacityResolution : openModal}
            size="small"
            sx={{ bgcolor: 'var(--accent)', color: 'var(--accent-ink)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}
          >
            Add Member
          </Button>
        )}
      </Box>

      {/* SEAT USAGE */}
      {seatCapacity && (
        <Box sx={{ mb: 3, p: 2, borderRadius: '8px', border: '1px solid', borderColor: atSeatLimit ? 'error.light' : nearSeatLimit ? 'warning.light' : 'divider' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'text.secondary' }}>
              Team seats
            </Typography>
            <Typography sx={{ fontSize: 12, fontWeight: 600, color: atSeatLimit ? 'error.main' : 'text.primary' }}>
              {seatCapacity.current} of {seatCapacity.limit} used
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={Math.min(seatUsagePct, 100)}
            color={atSeatLimit ? 'error' : nearSeatLimit ? 'warning' : 'primary'}
            sx={{ borderRadius: 4, height: 6 }}
          />
          {atSeatLimit && (
            <Typography sx={{ fontSize: 11, color: 'error.main', mt: 1 }}>
              Seat limit reached. Free a seat or increase capacity to add another team member.
            </Typography>
          )}
          {!atSeatLimit && (
            <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 1 }}>
              {seatCapacity.extra_seats > 0
                ? `${seatCapacity.base_limit} included + ${seatCapacity.extra_seats} additional · ${remainingSeats} available`
                : `${remainingSeats} seat${remainingSeats === 1 ? '' : 's'} available`}
            </Typography>
          )}
          <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.5 }}>
            Owner accounts do not use a seat.
          </Typography>
        </Box>
      )}

      {/* SEAT LIMIT MODAL (AUD-C16) — Core/Growth get the seat add-on
          stepper; Starter has no seat add-on product, keeps the
          generic tier-upgrade-only modal. */}
      {/* SHB-05 interim: AUD-C16 seat add-on is a Stripe subscriptionItem.
          Shopify-billed shops currently have no configured extra-seat
          purchase flow; they receive the tier-upgrade path instead. */}
      {showAddSeatsModal ? (
        <AddSeatsModal
          open={seatLimitModalOpen}
          onClose={() => setSeatLimitModalOpen(false)}
        />
      ) : showScaleCapacityDialog ? (
        <Dialog
          open={seatLimitModalOpen}
          onClose={() => setSeatLimitModalOpen(false)}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>Seat limit reached</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary">
              Scale includes 25 non-owner seats. To add another person, revoke an existing member's access.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSeatLimitModalOpen(false)} size="small">
              Review team
            </Button>
          </DialogActions>
        </Dialog>
      ) : showUnresolvedCapacityDialog ? (
        <Dialog
          open={seatLimitModalOpen}
          onClose={() => setSeatLimitModalOpen(false)}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>Seat capacity unavailable</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary">
              Seat capacity is still loading. Try again once the Team page has finished loading.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSeatLimitModalOpen(false)} size="small">
              Close
            </Button>
          </DialogActions>
        </Dialog>
      ) : (
        <UpgradePrompt
          requiredTier={upgradeTier}
          mode="modal"
          featureName="Additional team seats"
          open={seatLimitModalOpen}
          onClose={() => setSeatLimitModalOpen(false)}
        />
      )}

      {/* LOADING */}
      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {/* ERROR */}
      {isError && !is403 && (
        <MuiAlert severity="error" sx={{ mb: 3 }}>
          Failed to load members. Please refresh.
        </MuiAlert>
      )}

      {/* TABLE */}
      {!isLoading && !isError && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Member Since</TableCell>
              <TableCell>Role</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {members.map((member) => (
              <TableRow
                key={member.user_id}
                onClick={() => navigate(`/team/${member.user_id}`)}
                sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'var(--bg-2)' } }}
              >
                <TableCell>
                  {member.first_name || member.last_name
                    ? `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim()
                    : '—'}
                </TableCell>
                <TableCell>{member.email}</TableCell>
                <TableCell>
                  {new Date(member.member_since).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip
                      label={member.role}
                      size="small"
                      color={ROLE_COLORS[member.role]}
                      variant="outlined"
                    />
                    {canWrite && (
                      <Select
                        size="small"
                        value={member.role}
                        disabled={isUpdating}
                        onChange={(e) =>
                          updateRole({ userId: member.user_id, role: e.target.value as MemberRole })
                        }
                        sx={{ fontSize: 12, height: 28 }}
                      >
                        {VALID_ROLES.map((r) => (
                          <MenuItem key={r} value={r}>{r}</MenuItem>
                        ))}
                      </Select>
                    )}
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* EMPTY STATE */}
      {!isLoading && !isError && members.length === 0 && (
        <Box sx={{ p: 4, textAlign: 'center', border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
          <Typography variant="body1" fontWeight={600}>No members found</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Shop members will appear here once added.
          </Typography>
        </Box>
      )}

      {/* CREATE MEMBER MODAL */}
      <Dialog open={modalOpen} onClose={closeModal} maxWidth="xs" fullWidth>
        <DialogTitle>Add Team Member</DialogTitle>
        <DialogContent>
          {successEmail ? (
            <MuiAlert severity="success" sx={{ mt: 1 }}>
              Invite sent to <strong>{successEmail}</strong>. They will receive login credentials by email.
            </MuiAlert>
          ) : (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                label="Email *"
                type="email"
                size="small"
                fullWidth
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
              <TextField
                label="First Name"
                size="small"
                fullWidth
                value={form.first_name}
                onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
              />
              <TextField
                label="Last Name"
                size="small"
                fullWidth
                value={form.last_name}
                onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
              />
              <FormControl size="small" fullWidth>
                <InputLabel>Role *</InputLabel>
                <Select
                  value={form.role}
                  label="Role *"
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as MemberRole }))}
                >
                  {VALID_ROLES.map((r) => (
                    <MenuItem key={r} value={r}>{r}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              {formError && (
                <MuiAlert severity="error">{formError}</MuiAlert>
              )}
              {createError && !formError && (
                <MuiAlert severity="error">Something went wrong. Please try again.</MuiAlert>
              )}

              {/* REMAINING SLOTS HINT */}
              {seatCapacity && (
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="caption" color="text.disabled" sx={{ display: 'block' }}>
                    {remainingSeats} of {seatCapacity.limit} seats available
                  </Typography>
                  {seatCapacity.extra_seats > 0 && (
                    <Typography variant="caption" color="text.disabled" sx={{ display: 'block' }}>
                      {seatCapacity.base_limit} included + {seatCapacity.extra_seats} additional
                    </Typography>
                  )}
                  <Typography variant="caption" color="text.disabled" sx={{ display: 'block' }}>
                    Owner accounts do not use a seat.
                  </Typography>
                </Box>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeModal} size="small">
            {successEmail ? 'Close' : 'Cancel'}
          </Button>
          {!successEmail && (
            <Button
              onClick={handleConfirm}
              variant="contained"
              size="small"
              disabled={isCreating}
            >
              {isCreating ? 'Sending...' : 'Confirm & Send Invite'}
            </Button>
          )}
        </DialogActions>
      </Dialog>

    </Box>
    </>
  );
}
