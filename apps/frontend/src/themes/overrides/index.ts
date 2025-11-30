// apps/frontend/src/themes/overrides/index.ts
import { merge } from 'lodash-es';
import { Theme } from '@mui/material/styles'; // Import MUI Theme type

// Import individual override functions (assuming they exist, adjust paths/names if needed)
// We'll convert these files next. For now, TypeScript might complain they don't exist yet.
import Alert from './Alert';
import Autocomplete from './Autocomplete';
import Avatar from './Avatar';
import Button from './Button'; // This likely contains Slider overrides based on previous cat output
import CardActions from './CardActions';
import CardContent from './CardContent';
import CardHeader from './CardHeader';
import Checkbox from './Checkbox';
import Chip from './Chip';
import DataGrid from './DataGrid';
import DatePicker from './DatePicker';
import Divider from './Divider';
import DateTimePickerToolbar from './DateTimePickerToolbar';
import Dialog from './Dialog';
import DialogTitle from './DialogTitle';
import InputBase from './InputBase';
import InternalDateTimePickerTabs from './InternalDateTimePickerTabs';
import ListItemButton from './ListItemButton';
import ListItemIcon from './ListItemIcon';
import ListItemText from './ListItemText';
import OutlinedInput from './OutlinedInput';
import PaginationItem from './PaginationItem';
import Paper from './Paper';
import PickersTextField from './PickersTextField';
import Select from './Select';
import TableCell from './TableCell';
import Tabs from './Tabs';
import TimelineContent from './TimelineContent';
import TimelineDot from './TimelineDot';
import Tooltip from './Tooltip';
import TreeItem from './TreeItem';
import Typography from './Typography';

// ===============================||  OVERRIDES - MAIN  ||=============================== //

// Define the function signature with MUI Theme type
export default function ComponentsOverrides(theme: Theme, borderRadius: number, outlinedFilled: boolean) {
  // Call merge with the results of individual override functions
  // TypeScript might initially complain about argument types until individual files are converted
  return merge(
    Alert(theme),
    Autocomplete(theme, borderRadius),
    Avatar(theme),
    Button(theme), // Contains Slider overrides?
    CardActions, // Might need conversion if it's not just an object
    CardContent(), // Might need theme/args
    CardHeader(theme),
    Checkbox(), // Might need theme/args
    Chip(theme),
    DataGrid(theme),
    DatePicker(), // Might need theme/args
    DateTimePickerToolbar(), // Might need theme/args
    Dialog(), // Might need theme/args
    DialogTitle(), // Might need theme/args
    Divider(theme),
    InputBase(theme),
    InternalDateTimePickerTabs(theme),
    ListItemButton(theme),
    ListItemIcon(theme),
    ListItemText(theme),
    OutlinedInput(theme, borderRadius, outlinedFilled),
    PaginationItem(), // Might need theme/args
    Paper(borderRadius), // Might need theme/args
    PickersTextField(theme, borderRadius, outlinedFilled),
    Select(), // Might need theme/args
    TableCell(theme),
    Tabs(theme),
    TimelineContent(theme),
    TimelineDot(), // Might need theme/args
    Tooltip(theme),
    TreeItem(), // Might need theme/args
    Typography(theme)
  );
}