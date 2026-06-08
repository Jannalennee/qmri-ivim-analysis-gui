export type TaskLogStatus = 'started' | 'completed' | 'failed';

export interface TaskLogEntry {
  id: number;
  task: string;
  status: TaskLogStatus;
  timestampIso: string;
  notes?: string;
}
