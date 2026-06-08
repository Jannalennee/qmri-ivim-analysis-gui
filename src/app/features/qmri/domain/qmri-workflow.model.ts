import { UserRole } from '../qmri.types';

export type WorkflowStage = 'load-data' | 'configure-model' | 'run-model' | 'interpret-output';

export interface WorkflowTask {
  id: WorkflowStage;
  title: string;
  description: string;
  technicalOnly?: boolean;
}

export const QMRI_WORKFLOW_TASKS: readonly WorkflowTask[] = [
  {
    id: 'load-data',
    title: 'Load Imaging Data',
    description: 'Import DICOM or NIfTI and run basic data quality checks.'
  },
  {
    id: 'configure-model',
    title: 'Configure Model',
    description: 'Set model parameters and acquisition-specific settings.',
    technicalOnly: true
  },
  {
    id: 'run-model',
    title: 'Execute Inference',
    description: 'Run deep learning estimation for qMRI parameter maps.'
  },
  {
    id: 'interpret-output',
    title: 'Interpret Results',
    description: 'Review parameter maps, uncertainty, and export summaries.'
  }
] as const;

export function isTaskVisibleForRole(task: WorkflowTask, role: UserRole): boolean {
  if (!task.technicalOnly) {
    return true;
  }

  return role !== 'clinician';
}
