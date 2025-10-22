/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/layout/MainLayout/Header/SearchSection/index.tsx
import React, { useState, forwardRef } from 'react';

// material-ui
import { useTheme, Theme } from '@mui/material/styles';
import Avatar, { AvatarProps } from '@mui/material/Avatar';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import InputAdornment from '@mui/material/InputAdornment';
import OutlinedInput from '@mui/material/OutlinedInput';
import Popper from '@mui/material/Popper';
import Box from '@mui/material/Box';
import { SxProps } from '@mui/system';


// third party
import PopupState, { bindPopper, bindToggle, InjectedProps } from 'material-ui-popup-state'; // Import types

// project imports
import Transitions from 'ui-component/extended/Transitions';
import { withAlpha } from 'utils/colorUtils'; // Ensure typed later

// assets
import { IconAdjustmentsHorizontal, IconSearch, IconX } from '@tabler/icons-react';


// Define props for HeaderAvatar, extending AvatarProps
interface HeaderAvatarProps extends AvatarProps {
  children: React.ReactNode;
  // Ref needs special handling with forwardRef
}

// Internal HeaderAvatar component using forwardRef
const HeaderAvatar = forwardRef<HTMLDivElement, HeaderAvatarProps>(
    ({ children, ...others }, ref) => {
    const theme = useTheme();

    // Define SX with type safety
    const avatarSx: SxProps<Theme> = {
        // Use theme.typography helpers if available, or define manually
        width: 34, height: 34, // Example size
        borderRadius: '6px', // Example border radius
        fontSize: '1rem', // Example font size
        // --- Colors ---
        color: theme.palette.mode === 'dark' ? theme.palette.secondary.main : theme.palette.secondary.dark,
        background: theme.palette.mode === 'dark' ? theme.palette.dark.main : theme.palette.secondary.light,
        '&:hover': {
            color: theme.palette.mode === 'dark' ? theme.palette.secondary.light : theme.palette.secondary.light,
            background: theme.palette.mode === 'dark' ? theme.palette.secondary.main : theme.palette.secondary.dark,
        },
    };


    return (
      <Avatar
        ref={ref}
        variant="rounded"
        sx={avatarSx}
        {...others}
      >
        {children}
      </Avatar>
    );
});


// Define props for MobileSearch
interface MobileSearchProps {
  value: string;
  setValue: (value: string) => void;
  popupState: InjectedProps; // Use type from material-ui-popup-state
}

// Internal MobileSearch component
const MobileSearch: React.FC<MobileSearchProps> = ({ value, setValue, popupState }) => {
  const theme = useTheme();

  return (
    <OutlinedInput
      id="input-search-header-mobile" // Unique ID
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder="Search"
      startAdornment={
        <InputAdornment position="start">
          <IconSearch stroke={1.5} size="16px" color="grey" />
        </InputAdornment>
      }
      endAdornment={
        <InputAdornment position="end">
          {/* HeaderAvatar for filter icon */}
          <HeaderAvatar>
            <IconAdjustmentsHorizontal stroke={1.5} size="20px" />
          </HeaderAvatar>
          <Box sx={{ ml: 2 }}>
            {/* Close button Avatar */}
            <Avatar
              variant="rounded"
              sx={{
                width: 34, height: 34, borderRadius: '6px', 
                bgcolor: theme.palette.mode === 'dark' ? theme.palette.dark.main : theme.palette.orange.light, // <-- Restore orange.light
                color: theme.palette.orange.dark,
                '&:hover': {
                    bgcolor: theme.palette.orange.dark, 
                    color: theme.palette.orange.light
                },
              }}
              {...bindToggle(popupState)} // Spread toggle props
            >
              <IconX stroke={1.5} size="20px" />
            </Avatar>
          </Box>
        </InputAdornment>
      }
      aria-describedby="search-helper-text-mobile"
      // Use inputProps directly
      inputProps={{
        'aria-label': 'Search',
         sx: { bgcolor: 'transparent', pl: 0.5 } // Keep input background transparent
      }}
      sx={{
          width: '100%',
          // ml: 0.5, // Maybe remove margin left if container handles padding
          // px: 2, // Popper/Card likely handles padding
          bgcolor: theme.palette.background.paper // Use paper background
      }}
    />
  );
};

// ==============================|| SEARCH INPUT ||============================== //

const SearchSection: React.FC = () => {
  const theme = useTheme();
  const [value, setValue] = useState('');

  return (
    <>
      {/* Mobile Search - Icon + Popper */}
      <Box sx={{ display: { xs: 'block', md: 'none' } }}>
        <PopupState variant="popper" popupId="mobile-search-popper">
          {(popupState) => (
            <>
              <Box sx={{ ml: { xs: 0, md: 1 } }}> {/* Adjust margin */}
                {/* Use HeaderAvatar directly with spread toggle props */}
                <HeaderAvatar {...bindToggle(popupState)}>
                  <IconSearch stroke={1.5} size="19.2px" />
                </HeaderAvatar>
              </Box>
              <Popper
                {...bindPopper(popupState)}
                transition
                sx={{
                    zIndex: 1200, // Ensure it's above other elements
                    width: 'calc(100% - 24px)', // Adjust width calculation as needed
                    // top: '-55px !important', // Avoid !important if possible, test positioning
                    p: { xs: 1.25, sm: 1.5 }
                }}
                placement="bottom-start" // Define placement
              >
                {({ TransitionProps }) => (
                   <Transitions type="fade" // Use fade or grow
                     {...TransitionProps}
                     // transformOriginPosition="top left" // Adjust origin if needed
                     sx={{ width: '100%' }} // Ensure Transitions takes full width
                    >
                    <Card sx={{ bgcolor: 'background.default', border: 0, boxShadow: 'none', width: '100%' }}>
                      <Box sx={{ p: 1 }}> {/* Adjust padding */}
                        {/* Remove Grid, Box is sufficient */}
                           <MobileSearch value={value} setValue={setValue} popupState={popupState} />
                      </Box>
                    </Card>
                  </Transitions>
                )}
              </Popper>
            </>
          )}
        </PopupState>
      </Box>

      {/* Desktop Search - Direct Input */}
      <Box sx={{ display: { xs: 'none', md: 'block' } }}>
        <OutlinedInput
          id="input-search-header"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search"
          startAdornment={
            <InputAdornment position="start">
             <IconSearch stroke={1.5} size="16px" color={theme.palette.grey[500]} />
            </InputAdornment>
          }
          endAdornment={
            <InputAdornment position="end">
              {/* HeaderAvatar for filter icon */}
              <HeaderAvatar>
                <IconAdjustmentsHorizontal stroke={1.5} size="20px" />
              </HeaderAvatar>
            </InputAdornment>
          }
          aria-describedby="search-helper-text"
          // Use inputProps
           inputProps={{
             'aria-label': 'Search',
              sx: { bgcolor: 'transparent', pl: 0.5 }
           }}
          sx={{
              width: { md: 250, lg: 434 }, // Keep responsive width
              ml: 2,
              // px: 2 // Input itself likely has padding, adjust if needed
              // Consider border color or background for better visibility if needed
               "& .MuiOutlinedInput-notchedOutline": {
                   // borderColor: theme.palette.grey[300] // Example border color
               },
          }}
        />
      </Box>
    </>
  );
};

export default SearchSection;