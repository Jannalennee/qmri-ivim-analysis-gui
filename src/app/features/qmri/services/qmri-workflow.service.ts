import { Injectable } from '@angular/core';

import { UserRole } from '../qmri.types';
import { QMRI_WORKFLOW_TASKS, WorkflowTask, isTaskVisibleForRole } from '../domain/qmri-workflow.model';

@Injectable({ providedIn: 'root' })
export class QmriWorkflowService {
  getRoleDescription(role: UserRole): string {
    switch (role) {
      case 'researcher':
        return 'Research mode exposes intermediate maps and reproducibility controls.';
      case 'developer':
        return 'Developer mode unlocks model-level diagnostics and advanced tuning.';
      default:
        return 'Clinical mode prioritizes clear outputs and fast, safe interpretation.';
    }
  }

  getWorkflowStep(showAdvancedControls: boolean): string {
    if (showAdvancedControls) {
      return 'Step 3: Review quantitative maps with active parameter tuning.';
    }

    return 'Step 2: Validate quality checks and inspect transparent model summary.';
  }

  getVisibleTasks(role: UserRole): readonly WorkflowTask[] {
    return QMRI_WORKFLOW_TASKS.filter((task) => isTaskVisibleForRole(task, role));
  }
}
