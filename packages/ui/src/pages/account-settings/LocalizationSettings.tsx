// packages/ui/src/pages/account-settings/LocalizationSettings.tsx
import React, { useContext } from 'react';

// material-ui
import Grid from '@mui/material/Grid';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';

// project imports
import useConfig from 'hooks/useConfig';
import { ConfigContext } from 'contexts/ConfigContext';

// ==============================|| LOCALIZATION SETTINGS ||============================== //

const LocalizationSettings: React.FC = () => {
  const {
    state: { i18n },
  } = useConfig();
  const { dispatch } = useContext(ConfigContext);

  const handleListItemClick = (_event: React.MouseEvent<HTMLDivElement>, lng: string) => {
    dispatch({ type: 'SET_I18N', payload: lng });
  };

  return (
    <List component="nav" sx={{ p: 0 }}>
      <ListItemButton selected={i18n === 'en'} onClick={(event) => handleListItemClick(event, 'en')}>
        <ListItemText
          primary={
            <Grid container>
              <Typography color="textPrimary">English</Typography>
              <Typography variant="caption" color="textSecondary" sx={{ ml: '8px' }}>
                (UK)
              </Typography>
            </Grid>
          }
        />
      </ListItemButton>
      <ListItemButton selected={i18n === 'fr'} onClick={(event) => handleListItemClick(event, 'fr')}>
        <ListItemText
          primary={
            <Grid container>
              <Typography color="textPrimary">français</Typography>
              <Typography variant="caption" color="textSecondary" sx={{ ml: '8px' }}>
                (French)
              </Typography>
            </Grid>
          }
        />
      </ListItemButton>
      <ListItemButton selected={i18n === 'ro'} onClick={(event) => handleListItemClick(event, 'ro')}>
        <ListItemText
          primary={
            <Grid container>
              <Typography color="textPrimary">Română</Typography>
              <Typography variant="caption" color="textSecondary" sx={{ ml: '8px' }}>
                (Romanian)
              </Typography>
            </Grid>
          }
        />
      </ListItemButton>
      <ListItemButton selected={i18n === 'zh'} onClick={(event) => handleListItemClick(event, 'zh')}>
        <ListItemText
          primary={
            <Grid container>
              <Typography color="textPrimary">中国人</Typography>
              <Typography variant="caption" color="textSecondary" sx={{ ml: '8px' }}>
                (Chinese)
              </Typography>
            </Grid>
          }
        />
      </ListItemButton>
    </List>
  );
};

export default LocalizationSettings;