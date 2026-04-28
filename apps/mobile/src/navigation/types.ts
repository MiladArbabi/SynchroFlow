import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Task } from '../screens/TaskListScreen';

type LineItem = {
  lasyncro_line_item_id: string;
  lasyncro_variant_id: string;
  lasyncro_order_id: string;
  sku: string | null;
  title: string;
  quantity: number;
  location_code: string;
};

export type TaskStackParamList = {
  TaskList: undefined;
  PickBrief: { task: Task };
  Scan: { task: Task; lineItems?: LineItem[] };
  ReceiveJob: { task: Task };
  Stow: { task: Task };
  Pack: { task: Task };
};

export type TaskStackScreenProps<T extends keyof TaskStackParamList> =
  NativeStackScreenProps<TaskStackParamList, T>;