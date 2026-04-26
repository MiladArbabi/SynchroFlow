// apps/frontend/src/components/AlertRulesPanel.tsx
import { useState } from 'react';
import {
  Box, Typography, Button, TextField, MenuItem,
  Chip, IconButton, CircularProgress, Switch,
  FormControlLabel, Divider,
} from '@mui/material';
import { Plus, Trash2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

/**
 * ALERT RULES PANEL (PP3-01)
 * --------------------------
 * Operator-configurable alert rules.
 * Rendered alongside AlertsPage — right column.
 *
 * Rules are evaluated on every order arrival via
 * evaluateAlertRulesForOrder in orders.create projection.
 */

type AlertRule = {
  id: string;
  rule_type: string;
  config: Record<string, unknown>;
  push_enabled: boolean;
  is_active: boolean;
  created_at: string;
};

const RULE_TYPE_LABELS: Record<string, string> = {
  new_order: 'Every new order',
  order_from_region: 'Order from region',
  order_above_value: 'Order above value',
};

function useAlertRules() {
  return useQuery<AlertRule[]>({
    queryKey: ['alert-rules'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/alerts/rules');
      return data.rules;
    },
  });
}

function useCreateAlertRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      rule_type: string;
      config: Record<string, unknown>;
      push_enabled: boolean;
    }) => {
      const { data } = await axiosInstance.post('/api/v1/alerts/rules', payload);
      return data.rule;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['alert-rules'] }),
  });
}

function useDeleteAlertRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ruleId: string) => {
      await axiosInstance.delete(`/api/v1/alerts/rules/${ruleId}`);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['alert-rules'] }),
  });
}

function RuleRow({ rule, onDelete }: { rule: AlertRule; onDelete: (id: string) => void }) {
  const configLabel = (() => {
    if (rule.rule_type === 'order_from_region') {
      return [rule.config.province, rule.config.country_code].filter(Boolean).join(' / ');
    }
    if (rule.rule_type === 'order_above_value') {
      return `> $${rule.config.threshold}`;
    }
    return null;
  })();

  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      px: 2, py: 1.25,
      borderBottom: '1px solid', borderColor: 'divider',
      '&:last-child': { borderBottom: 'none' },
    }}>
      <Box>
        <Typography variant="body2" fontWeight={600}>
          {RULE_TYPE_LABELS[rule.rule_type] ?? rule.rule_type}
        </Typography>
        {configLabel && (
          <Typography variant="caption" color="text.secondary">{configLabel}</Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {rule.push_enabled && <Chip label="Push" size="small" color="primary" variant="outlined" />}
        <IconButton size="small" onClick={() => onDelete(rule.id)}>
          <Trash2 size={14} />
        </IconButton>
      </Box>
    </Box>
  );
}

export default function AlertRulesPanel() {
  const { data: rules, isLoading } = useAlertRules();
  const { mutate: createRule, isPending: creating } = useCreateAlertRule();
  const { mutate: deleteRule } = useDeleteAlertRule();

  const [ruleType, setRuleType] = useState('new_order');
  const [province, setProvince] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [threshold, setThreshold] = useState('');
  const [pushEnabled, setPushEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = () => {
    setError(null);
    const config: Record<string, unknown> = {};

    if (ruleType === 'order_from_region') {
      if (!province && !countryCode) {
        setError('Enter a province code or country code.');
        return;
      }
      if (province) config.province = province.toUpperCase().trim();
      if (countryCode) config.country_code = countryCode.toUpperCase().trim();
    }

    if (ruleType === 'order_above_value') {
      const t = parseFloat(threshold);
      if (isNaN(t) || t <= 0) {
        setError('Enter a valid threshold amount.');
        return;
      }
      config.threshold = t;
    }

    createRule(
      { rule_type: ruleType, config, push_enabled: pushEnabled },
      {
        onSuccess: () => {
          setProvince('');
          setCountryCode('');
          setThreshold('');
          setPushEnabled(false);
        },
        onError: () => setError('Failed to create rule.'),
      }
    );
  };

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      {/* HEADER */}
      <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="body2" fontWeight={700}>Alert rules</Typography>
        <Typography variant="caption" color="text.secondary">
          Get notified when specific orders arrive.
        </Typography>
      </Box>

      {/* EXISTING RULES */}
      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={18} />
        </Box>
      )}
      {!isLoading && (rules ?? []).length === 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, py: 1.5 }}>
          No rules yet. Add one below.
        </Typography>
      )}
      {(rules ?? []).map((rule) => (
        <RuleRow key={rule.id} rule={rule} onDelete={(id) => deleteRule(id)} />
      ))}

      <Divider />

      {/* NEW RULE FORM */}
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <TextField
          select
          label="Notify me when..."
          size="small"
          fullWidth
          value={ruleType}
          onChange={(e) => { setRuleType(e.target.value); setError(null); }}
        >
          {Object.entries(RULE_TYPE_LABELS).map(([value, label]) => (
            <MenuItem key={value} value={value}>{label}</MenuItem>
          ))}
        </TextField>

        {ruleType === 'order_from_region' && (
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              label="Province (e.g. CA)"
              size="small"
              value={province}
              onChange={(e) => setProvince(e.target.value)}
              sx={{ flex: 1 }}
              inputProps={{ maxLength: 10 }}
            />
            <TextField
              label="Country (e.g. US)"
              size="small"
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              sx={{ flex: 1 }}
              inputProps={{ maxLength: 2 }}
            />
          </Box>
        )}

        {ruleType === 'order_above_value' && (
          <TextField
            label="Threshold amount ($)"
            size="small"
            type="number"
            fullWidth
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            inputProps={{ min: 0.01, step: 0.01 }}
          />
        )}

        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={pushEnabled}
              onChange={(e) => setPushEnabled(e.target.checked)}
            />
          }
          label={<Typography variant="caption">Push notification</Typography>}
        />

        {error && (
          <Typography variant="caption" color="error">{error}</Typography>
        )}

        <Button
          variant="contained"
          size="small"
          startIcon={<Plus size={14} />}
          onClick={handleCreate}
          disabled={creating}
          fullWidth
        >
          {creating ? 'Adding...' : 'Add rule'}
        </Button>
      </Box>
    </Box>
  );
}