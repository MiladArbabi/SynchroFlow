// third party
import { merge } from 'lodash-es';

// project imports
import Alert from './Alert';
import Autocomplete from './Autocomplete';
import Avatar from './Avatar';
import Button from './Button';
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
import Slider from './Slider';
import TableCell from './TableCell';
import Tabs from './Tabs';
import TimelineContent from './TimelineContent';
import TimelineDot from './TimelineDot';
import Tooltip from './Tooltip';
import TreeItem from './TreeItem';
import Typography from './Typography';

// ===============================||  OVERRIDES - MAIN  ||=============================== //

export default function ComponentsOverrides(theme, borderRadius, outlinedFilled) {
  return merge(
    Alert(theme),
    Autocomplete(theme, borderRadius),
    Avatar(theme),
    Button(theme),
    CardActions,
    CardContent(),
    CardHeader(theme),
    Checkbox(),
    Chip(theme),
    DataGrid(theme),
    DatePicker(),
    DateTimePickerToolbar(),
    Dialog(),
    DialogTitle(),
    Divider(theme),
    InputBase(theme),
    InternalDateTimePickerTabs(theme),
    ListItemButton(theme),
    ListItemIcon(theme),
    ListItemText(theme),
    OutlinedInput(theme, borderRadius, outlinedFilled),
    PaginationItem(),
    Paper(borderRadius),
    PickersTextField(theme, borderRadius, outlinedFilled),
    Select(),
    Slider(theme),
    TableCell(theme),
    Tabs(theme),
    TimelineContent(theme),
    TimelineDot(),
    Tooltip(theme),
    TreeItem(),
    Typography(theme)
  );
}
