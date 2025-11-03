import React from 'react';
// material-ui
import { useColorScheme, useTheme } from '@mui/material/styles';

// project imports
// import { ThemeMode } from 'config'; // <-- COMMENT OUT for now

/**
 * if you want to use image instead of <svg> uncomment following.
 *
 * import logoDark from 'assets/images/logo-dark.svg';
 * import logo from 'assets/images/logo.svg';
 *
 */

// ==============================|| LOGO SVG ||============================== //

// Define props interface
interface LogoProps {
  dark?: boolean;
  isCollapsed?: boolean;
}

// Assuming 'light' and 'dark' are the valid color scheme values
const ThemeMode = { DARK: 'dark', LIGHT: 'light' }; // <-- Placeholder

export default function Logo({ dark = false, isCollapsed = false }: LogoProps) {
  const theme = useTheme();
  const { colorScheme } = useColorScheme();

  return (
    <svg width="105" height="22" viewBox="0 0 105 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g clipPath="url(#clip0_2_14)">
        <path 
          d="M33.88 17.53C32 17.69 26.04 16.63 28.19 13.95C29.9 12.79 32.38 14.05 34.25 13.48C34.96 13.29 35.44 12.92 35.49 12.51C35.44 11.03 32.59 10.57 31.31 10.03C28.49 9.23 26.31 6.3 27.73 3.47001C29.09 0.490005 33.66 -0.559995 37.22 0.280005C38.65 0.470005 40.84 2.34001 39.08 3.47001C37.51 4.46001 34.24 3.06001 33.17 4.97001C33 5.98001 34.27 6.51001 35.07 6.85001C36.65 7.43001 38.48 7.88001 39.71 9.01C44.19 13.12 38.68 17.71 34.1 17.52H33.89L33.88 17.53Z" 
          fill={colorScheme === ThemeMode.DARK || dark ? theme.vars.palette.common.white : theme.vars.palette.grey[700]}
        />
        {isCollapsed && (
          <>
            {/* This group contains all the text paths: L, a, y, n, c, r, o */}
            <path
              d="M0 17.2V0.279999H4.42V13.53H11.93V17.2H0Z"
              fill={colorScheme === ThemeMode.DARK || dark ? theme.vars.palette.common.white : theme.vars.palette.grey[900]}
            />
            <path
              d="M17.86 17.49C16.95 17.49 16.14 17.32 15.44 16.97C14.74 16.63 14.19 16.16 13.8 15.58C13.41 15 13.21 14.33 13.21 13.58C13.21 12.72 13.43 12.04 13.88 11.54C14.33 11.04 15.05 10.69 16.05 10.47C17.05 10.25 18.37 10.15 20.02 10.15H21.34V12.14H20.02C19.54 12.14 19.13 12.17 18.8 12.24C18.47 12.31 18.18 12.38 17.96 12.48C17.74 12.58 17.57 12.7 17.47 12.85C17.37 13 17.31 13.19 17.31 13.41C17.31 13.78 17.44 14.08 17.69 14.32C17.95 14.56 18.33 14.68 18.84 14.68C19.22 14.68 19.57 14.59 19.88 14.42C20.19 14.24 20.44 14 20.64 13.69C20.83 13.38 20.93 13.01 20.93 12.6V9.82C20.93 9.23 20.78 8.82 20.49 8.58C20.19 8.35 19.69 8.23 18.99 8.23C18.37 8.23 17.69 8.33 16.96 8.52C16.23 8.71 15.51 9.01 14.79 9.41L13.69 6.6C14.11 6.31 14.63 6.06 15.25 5.83C15.87 5.6 16.53 5.43 17.23 5.3C17.93 5.17 18.57 5.11 19.16 5.11C20.47 5.11 21.56 5.3 22.41 5.69C23.26 6.08 23.91 6.65 24.33 7.43C24.75 8.21 24.97 9.2 24.97 10.42V17.21H20.99V14.98H21.13C21.05 15.48 20.87 15.91 20.58 16.29C20.29 16.67 19.92 16.96 19.45 17.18C18.99 17.4 18.46 17.5 17.87 17.5L17.86 17.49Z"
              fill={colorScheme === ThemeMode.DARK || dark ? theme.vars.palette.common.white : theme.vars.palette.grey[900]}
            />
            <path
              d="M43.81 21.23C43.58 20.37 44.31 19.7 44.7 18.65C45.19 17.83 45.51 16.54 46.09 16.35C46.17 16.4 46.17 16.59 46.11 16.65C45.97 16.76 45.77 16.29 45.68 16.12C44.69 13.94 41.85 7.83 41.16 6.17C40.9 5.42 41.61 5.47 42.22 5.42C44.66 5.39 45.55 5.06 46.5 8.05C46.87 9.14 48.38 12.13 48.13 12.87C48.05 12.84 48.1 12.1 48.64 10.93C49.27 9.47 50.08 7.47 50.55 6.48C50.94 5.66 51.54 5.44 52.59 5.41C53.48 5.39 54.51 5.38 54.87 5.52C55.06 5.59 55.12 5.71 55.08 5.89C53.91 8.66 49.35 18.19 48.18 20.74C47.66 21.77 46.47 21.43 45.36 21.51C44.68 21.51 44.09 21.48 43.86 21.28L43.8 21.22L43.81 21.23Z"
              fill={colorScheme === ThemeMode.DARK || dark ? theme.vars.palette.common.white : theme.vars.palette.grey[700]}
            />
            <path
              d="M56.16 17.07C55.82 16.87 55.8 16.47 55.79 16.07C55.79 14.06 55.77 8.54 55.79 6.52C55.66 4.76 58.98 5.12 59.67 6.08C60.24 7.09 60.56 6.23 61.43 5.8C63.57 4.52 66.78 5.28 67.46 7.86C68.01 9.56 67.86 10.94 67.89 13.37C67.81 14.45 68.14 15.99 67.51 16.85C66.75 17.48 64.89 17.42 64.09 16.94C63.44 16.39 63.67 15.06 63.62 14.2C63.57 11.57 63.89 9.45 62.57 8.88C58.56 8.15 60.8 14.7 59.74 16.73C59.22 17.47 57.26 17.38 56.24 17.11L56.15 17.06L56.16 17.07Z"
              fill={colorScheme === ThemeMode.DARK || dark ? theme.vars.palette.common.white : theme.vars.palette.grey[700]}
            />
            <path
              d="M76.26 17.5C66.16 17.2 67.96 3.43 77.85 5.24C78.76 5.4 79.64 5.63 80.04 6.12C80.6 6.77 80.37 7.94 79.69 8.39C79.11 8.85 78.32 8.61 77.37 8.52C76.19 8.41 75.01 8.92 74.53 10.02C73.9 11.39 74.41 13.33 75.91 13.86C77.11 14.49 78.76 13.4 79.8 14.29C81.76 16.65 78.35 17.54 76.46 17.5H76.26Z"
              fill={colorScheme === ThemeMode.DARK || dark ? theme.vars.palette.common.white : theme.vars.palette.grey[700]}
            />
            <path
              d="M82.28 17.16C81.78 16.88 81.85 16.19 81.84 15.01C81.84 13.75 81.84 11.93 81.84 10.49C81.99 9.05 81.38 5.74 82.51 5.47C83.9 4.97 86.04 5.38 86.11 7.14C86.29 7.64 86.84 6.15 88.07 5.65C88.43 5.47 88.85 5.32 89.24 5.28C91.42 5.12 91.44 8.31 89.49 8.75C82.63 10 90.24 18.95 82.39 17.21L82.29 17.16H82.28Z"
              fill={colorScheme === ThemeMode.DARK || dark ? theme.vars.palette.common.white : theme.vars.palette.grey[700]}
            />
            <path
              d="M98.02 17.5C90.24 17.79 89.14 6.21 96.9 5.2C106.29 3.63 107.57 17.38 98.22 17.5H98.02ZM98.21 14.31C101.04 14.19 101.1 8.53 98.32 8.3C95.06 7.94 95.04 14.3 98.04 14.31H98.21Z"
              fill={colorScheme === ThemeMode.DARK || dark ? theme.vars.palette.common.white : theme.vars.palette.grey[700]}
            />
          </>
        )}
      </g>
      <defs>
        <clipPath id="clip0_2_14">
          <rect width="104.61" height="21.52" fill="white"/>
        </clipPath>
      </defs>
    </svg>
  );
};