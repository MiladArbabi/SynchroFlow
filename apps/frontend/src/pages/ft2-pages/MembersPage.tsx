// apps/frontend/src/pages/ft2-pages/MembersPage.tsx
import { useState } from 'react';
import { useAuth } from 'contexts/AuthContext';
import {
  Box, Typography, CircularProgress, Alert as MuiAlert,
  Table, TableBody, TableCell, TableHead, TableRow,
  Select, MenuItem, Chip, Button,
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, FormControl, InputLabel,
  Stack,
} from '@mui/material';
import { UserPlus } from 'lucide-react';
import { useMembers, useUpdateMemberRole, useCreateMember, type MemberRole } from '../members/useMembers';

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

export default function MembersPage() {
  const { data, isLoading, isError, error } = useMembers();
  const is403 = (error as Error & { response?: { status?: number } })?.response?.status === 403;

  const { mutate: updateRole, isPending: isUpdating } = useUpdateMemberRole();
  const { mutate: createMember, isPending: isCreating, error: createError, reset: resetCreate } = useCreateMember();

  const { user } = useAuth();
  const canWrite = user?.role === 'owner' || user?.role === 'admin';

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<CreateMemberForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [successEmail, setSuccessEmail] = useState<string | null>(null);

  const members = data?.members ?? [];

  const openModal = () => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setSuccessEmail(null);
    resetCreate();
    setModalOpen(true);
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
        },
        onError: (err: Error & { response?: { data?: { error?: string } } }) => {
          const msg = err?.response?.data?.error;
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
    <Box sx={{ p: 3 }}>

      {/* HEADER */}
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>Team</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Manage shop members and their roles.
          </Typography>
        </Box>
        {canWrite && (
          <Button
            variant="contained"
            startIcon={<UserPlus size={16} />}
            onClick={openModal}
            size="small"
          >
            Add Member
          </Button>
        )}
      </Box>

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
              <TableRow key={member.user_id}>
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
              <Typography variant="caption" color="text.disabled" sx={{ textAlign: 'center' }}>
                {members.length} member{members.length !== 1 ? 's' : ''} in this shop
              </Typography>
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
  );
}