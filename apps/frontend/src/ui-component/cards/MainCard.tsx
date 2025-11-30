/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/ui-component/cards/MainCard.tsx
import React, { forwardRef } from 'react';

// material-ui
import { useColorScheme, Theme } from '@mui/material/styles';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardHeader from '@mui/material/CardHeader';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import { SxProps } from '@mui/material';

// project imports
import { ThemeMode } from '../../config';

// constant
const headerStyle = {
  '& .MuiCardHeader-action': { mr: 0 }
};

// Define the props interface
export interface MainCardProps {
  border?: boolean;
  boxShadow?: boolean;
  children: React.ReactNode;
  content?: boolean;
  contentClass?: string;
  contentSX?: SxProps<Theme>;
  headerSX?: SxProps<Theme>;
  darkTitle?: boolean;
  secondary?: React.ReactNode;
  shadow?: string;
  sx?: SxProps<Theme>;
  title?: string | React.ReactNode;
  [key: string]: any; // Allow other props
}

// Use forwardRef to pass down the ref
const MainCard = forwardRef<HTMLDivElement, MainCardProps>(
  (
    {
      border = false,
      boxShadow,
      children,
      content = true,
      contentClass = '',
      contentSX = {},
      headerSX = {},
      darkTitle,
      secondary,
      shadow,
      sx = {},
      title,
      ...others
    },
    ref
  ) => {
    const { colorScheme } = useColorScheme();
    const defaultShadow = colorScheme === ThemeMode.DARK ? '0 2px 14px 0 rgb(33 150 243 / 10%)' : '0 2px 14px 0 rgb(32 40 45 / 8%)';

    return (
      <Card
        ref={ref}
        {...others}
        sx={(theme) => ({
          border: border ? '1px solid' : 'none',
          borderColor: theme.palette.divider,
          ':hover': {
            boxShadow: boxShadow ? shadow || defaultShadow : 'inherit'
          },
          // Allow sx prop to be an object or a function
          ...(typeof sx === 'function' ? sx(theme) : sx)
        })}
      >
        {/* card header and action */}
        {!darkTitle && title && <CardHeader sx={{ ...headerStyle, ...headerSX }} title={title} action={secondary} />}
        {darkTitle && title && (
          <CardHeader sx={{ ...headerStyle, ...headerSX }} title={<Typography variant="h3">{title}</Typography>} action={secondary} />
        )}

        {/* content & header divider */}
        {title && <Divider />}

        {/* card content */}
        {content && (
          <CardContent sx={contentSX} className={contentClass}>
            {children}
          </CardContent>
        )}
        {!content && children}
      </Card>
    );
  }
);

export default MainCard;