import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';

import { TaskLogEntry } from '../../domain/qmri-evaluation.model';
import { QmriInferenceStatus, QmriModelId, QmriModelOption } from '../../domain/qmri-inference.model';

@Component({
  selector: 'app-execution-panel',
  imports: [DatePipe],
  templateUrl: './execution-panel.component.html',
  styleUrl: './execution-panel.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ExecutionPanelComponent {
  readonly inferenceStatus = input.required<QmriInferenceStatus>();
  readonly hasScan = input.required<boolean>();
  readonly selectedModel = input.required<QmriModelId>();
  readonly modelOptions = input.required<readonly QmriModelOption[]>();
  readonly taskLog = input.required<readonly TaskLogEntry[]>();

  readonly modelChange = output<QmriModelId>();
  readonly runRequested = output<void>();

  protected onModelChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as QmriModelId;
    this.modelChange.emit(value);
  }

  protected runInference(): void {
    this.runRequested.emit();
  }
}
