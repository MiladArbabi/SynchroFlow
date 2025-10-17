// packages/ui/src/components/Items/NotificationItem/index.tsx
import React, { forwardRef } from "react";
import MenuItem from "@mui/material/MenuItem";
import Link from "@mui/material/Link";
import MDBox from "../../MDBox";
import MDTypography from "../../MDTypography";
import menuItem from "./styles";

interface NotificationItemProps {
  icon: React.ReactNode;
  title: string;
  [key: string]: any; // Allow other props
}

const NotificationItem = forwardRef<HTMLLIElement, NotificationItemProps>(
  ({ icon, title, ...rest }, ref) => (
    <MenuItem {...rest} ref={ref} sx={(theme) => menuItem(theme)}>
      <MDBox component={Link} py={0.5} display="flex" alignItems="center" lineHeight={1}>
          <MDBox mr={2}>
            {icon}
        </MDBox>
        <MDTypography variant="button" fontWeight="regular" sx={{ ml: 1 }}>
          {title}
        </MDTypography>
      </MDBox>
    </MenuItem>
  )
);

export default NotificationItem;