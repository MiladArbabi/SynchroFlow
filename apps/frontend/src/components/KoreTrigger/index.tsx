// apps/frontend/src/components/KoreTrigger/index.tsx
import React from 'react';
import { useTheme, Theme } from '@mui/material/styles';
import { Tooltip, SxProps } from '@mui/material';
import Avatar from 'ui-component/extended/Avatar'; // Our shared component
import { KoreIcon } from 'components/KoreIcon';

interface KoreTriggerProps {
  onClick: () => void;
  isActive: boolean;
}

// This is the styling from the old HeaderAvatar.
// We apply it via 'sx' to our shared <Avatar> component.
const getTriggerSx = (theme: Theme): SxProps<Theme> => ({
    borderRadius: '18px', // Match the old style exactly
    color: theme.palette.mode === 'dark' ? theme.palette.secondary.main : theme.palette.secondary.dark,
    background: theme.palette.mode === 'dark' ? theme.palette.dark.main : theme.palette.secondary.light,
    '&:hover': {
        color: theme.palette.mode === 'dark' ? theme.palette.secondary.light : theme.palette.secondary.light,
        background: theme.palette.mode === 'dark' ? theme.palette.secondary.main : theme.palette.secondary.dark,
    },
    cursor: 'pointer', // Make it obvious it's clickable
});

const KoreTrigger: React.FC<KoreTriggerProps> = ({ onClick, isActive }) => {
  const theme = useTheme();
  const triggerSx = getTriggerSx(theme);

  return (
    <Tooltip title="Open Kore Command (Cmd+J)">
      <Avatar
        variant="rounded" // Use 'rounded' variant
        size="xs" // Sets width/height to 34x34
        sx={triggerSx}
        onClick={onClick}
        data-testid="kore-navbar-button" // Pass the test-id for E2E
      >
        <KoreIcon isActive={isActive} />
      </Avatar>
    </Tooltip>
  );
};

export default KoreTrigger;