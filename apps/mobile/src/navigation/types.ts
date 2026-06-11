// apps/mobile/src/navigation/types.ts
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Task } from '../screens/TaskListScreen';

export type TaskStackParamList = {
  TaskList:   undefined;
  PickBrief:  { task: Task };
  ReceiveJob: { task: Task };
  Stow:       { task: Task };
};

export type TaskStackScreenProps<T extends keyof TaskStackParamList> =
  NativeStackScreenProps<TaskStackParamList, T>;