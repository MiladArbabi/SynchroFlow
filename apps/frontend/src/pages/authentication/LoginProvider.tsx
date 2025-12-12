/* eslint-disable @typescript-eslint/no-unused-vars */
import React from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';

// material-ui
import { useTheme, Theme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import Button from '@mui/material/Button';
import CardMedia from '@mui/material/CardMedia';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import { APP_AUTH, AuthProvider } from 'config';

// project imports
//import { AuthProvider, APP_AUTH } from 'config';

// assets
// assets - COMMENT OUT or verify paths
// import Jwt from 'assets/images/icons/jwt.svg';
// import Firebase from 'assets/images/icons/firebase.svg';
// import Auth0 from 'assets/images/icons/auth0.svg';
// import Aws from 'assets/images/icons/aws.svg';
// import Supabase from 'assets/images/icons/supabase.svg';

// ==============================|| SOCIAL BUTTON ||============================== //

// Define props interface
interface LoginProviderProps {
  currentLoginWith: string;
}

export default function LoginProvider({ currentLoginWith }: LoginProviderProps) {
  const theme = useTheme();
  const downLG = useMediaQuery((theme: Theme) => theme.breakpoints.down('lg'));

  // const [searchParams] = useSearchParams();
  //const auth = useSearchParams.get('auth'); // get auth and set route based on that

  const loginHandlers = {
    Jwt: APP_AUTH === AuthProvider.JWT ? '/login' : '/login?auth=jwt',
    //Firebase: APP_AUTH === AuthProvider.FIREBASE ? '/login' : '/login?auth=firebase',
    //Auth0: APP_AUTH === AuthProvider.AUTH0 ? '/login' : '/login?auth=auth0',
    //Aws: APP_AUTH === AuthProvider.AWS ? '/login' : '/login?auth=aws',
    //Supabase: APP_AUTH === AuthProvider.SUPABASE ? '/login' : '/login?auth=supabase'
  };

  const buttonData = [
    { name: 'jwt', icon: 'jwt', url: loginHandlers.Jwt },
    //{ name: 'firebase', icon: Firebase, url: loginHandlers.Firebase },
    //{ name: 'auth0', icon: Auth0, url: loginHandlers.Auth0 },
    //{ name: 'aws', icon: Aws, url: loginHandlers.Aws },
    //{ name: 'supabase', icon: Supabase, url: loginHandlers.Supabase }
  ];

  // const currentLoginExists = buttonData.some((button) => button.name === currentLoginWith);

  return (
    <Stack
      direction="row"
      sx={{ gap: 1, justifyContent: 'center', '& .MuiButton-startIcon': { mr: { xs: 0, md: 1 }, ml: { xs: 0, sm: -0.5, md: 1 } } }}
    >
      {buttonData
        .filter((button) => {
          /* if (auth) {
            return button.name !== auth;
          } */
          if (currentLoginWith) {
            return button.name !== currentLoginWith;
          }
          return button.name !== APP_AUTH;
        })
        .map((button) => (
          <Tooltip title={button.name} key={button.name}>
            <Button
              sx={{
                borderColor: (theme as any).vars?.palette?.grey?.[300] ?? theme.palette.grey[300],
                color: (theme as any).vars?.palette?.grey?.[900] ?? theme.palette.text.primary,
                '&:hover': {
                  borderColor: (theme as any).vars?.palette?.primary?.[400] ?? theme.palette.primary.main,
                  backgroundColor: (theme as any).vars?.palette?.primary?.[100] ?? theme.palette.primary.light
                }
              }}
              variant="outlined"
              color="secondary"
              startIcon={<CardMedia component="img" src={button.icon} alt={button.name} />}
              component={RouterLink}
              to={button.url}
              target="_blank"
            >
              {!downLG && button.name}
            </Button>
          </Tooltip>
        ))}
    </Stack>
  );
}