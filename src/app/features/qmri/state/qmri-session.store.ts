import { Injectable, computed, inject, signal } from '@angular/core';

import { TaskLogEntry } from '../domain/qmri-evaluation.model';
import {
  IngestedScan,
  QmriInferenceResult,
  QmriInferenceStatus,
  QmriModelId,
  QMRI_MODEL_OPTIONS
} from '../domain/qmri-inference.model';
import { QmriDataIngestService } from '../services/qmri-data-ingest.service';
import { QmriInferenceService } from '../services/qmri-inference.service';
import { QmriWorkflowService } from '../services/qmri-workflow.service';
import { QmriModelControlValues, UserRole } from '../qmri.types';

@Injectable({ providedIn: 'root' })
export class QmriSessionStore {
  private readonly workflowService = inject(QmriWorkflowService);
  private readonly dataIngestService = inject(QmriDataIngestService);
  private readonly inferenceService = inject(QmriInferenceService);
  private nextLogId = 1;

  readonly selectedRole = signal<UserRole>('clinician');
  readonly showAdvancedControls = signal(false);
  readonly confidenceThreshold = signal(0.75);
  readonly overlayOpacity = signal(60);
  readonly smoothingLevel = signal(2);
  readonly showUncertaintyOverlay = signal(true);
  readonly selectedScan = signal<IngestedScan | null>(null);
  readonly ingestMessage = signal('No dataset loaded yet.');
  readonly inferenceStatus = signal<QmriInferenceStatus>('idle');
  readonly inferenceResult = signal<QmriInferenceResult | null>(null);
  readonly taskLog = signal<readonly TaskLogEntry[]>([]);
  readonly selectedModel = signal<QmriModelId>('ivimnet');
  readonly modelOptions = signal(QMRI_MODEL_OPTIONS);
  readonly ivimBMax = signal(800);
  readonly ivimRegularization = signal(0.15);
  readonly ncdeTimeSteps = signal(32);
  readonly ncdeHiddenSize = signal(64);

  readonly roleDescription = computed(() =>
    this.workflowService.getRoleDescription(this.selectedRole())
  );

  readonly workflowStep = computed(() =>
    this.workflowService.getWorkflowStep(this.showAdvancedControls())
  );

  readonly visibleTasks = computed(() =>
    this.workflowService.getVisibleTasks(this.selectedRole())
  );

  updateRole(role: UserRole): void {
    this.selectedRole.set(role);
    this.showAdvancedControls.set(role !== 'clinician');
  }

  setThreshold(value: number): void {
    this.confidenceThreshold.set(value);
  }

  setOpacity(value: number): void {
    this.overlayOpacity.set(value);
  }

  setSmoothing(value: number): void {
    this.smoothingLevel.set(value);
  }

  toggleUncertainty(): void {
    this.showUncertaintyOverlay.update((current) => !current);
  }

  setModel(model: QmriModelId): void {
    this.selectedModel.set(model);
    this.pushLog('Model selection', 'completed', `Selected ${model}.`);
  }

  setIvimBMax(value: number): void {
    this.ivimBMax.set(value);
  }

  setIvimRegularization(value: number): void {
    this.ivimRegularization.set(value);
  }

  setNcdeTimeSteps(value: number): void {
    this.ncdeTimeSteps.set(value);
  }

  setNcdeHiddenSize(value: number): void {
    this.ncdeHiddenSize.set(value);
  }

  applyRecommendedSettings(): void {
    if (this.selectedModel() === 'ivimnet') {
      this.ivimBMax.set(900);
      this.ivimRegularization.set(0.2);
      this.confidenceThreshold.set(0.8);
      this.smoothingLevel.set(2);
      this.pushLog('Preset applied', 'completed', 'Applied IVIMNET recommended settings.');
      return;
    }

    this.ncdeTimeSteps.set(40);
    this.ncdeHiddenSize.set(96);
    this.confidenceThreshold.set(0.82);
    this.smoothingLevel.set(3);
    this.pushLog('Preset applied', 'completed', 'Applied NCDE-QMRI recommended settings.');
  }

  ingestFile(file: File | null): void {
    this.pushLog('Load imaging data', 'started');

    const result = this.dataIngestService.ingest(file);
    this.ingestMessage.set(result.message);

    if (!result.ok || !result.scan) {
      this.selectedScan.set(null);
      this.inferenceStatus.set('error');
      this.pushLog('Load imaging data', 'failed', result.message);
      return;
    }

    this.selectedScan.set(result.scan);
    this.inferenceStatus.set('idle');
    this.pushLog('Load imaging data', 'completed', result.message);
  }

  runInference(): void {
    const scan = this.selectedScan();
    if (!scan) {
      const message = 'Load a scan before running inference.';
      this.inferenceStatus.set('error');
      this.pushLog('Execute inference', 'failed', message);
      return;
    }

    this.pushLog(
      'Execute inference',
      'started',
      `Running ${this.selectedModel()} on ${scan.fileName}.`
    );
    this.inferenceStatus.set('running');

    const result = this.inferenceService.runMockInference(
      this.selectedModel(),
      scan,
      {
        confidenceThreshold: this.confidenceThreshold(),
        overlayOpacity: this.overlayOpacity(),
        smoothingLevel: this.smoothingLevel(),
        showUncertaintyOverlay: this.showUncertaintyOverlay()
      },
      this.getModelControlValues()
    );

    this.inferenceResult.set(result);
    this.inferenceStatus.set('completed');
    this.pushLog('Execute inference', 'completed', `Model: ${result.modelName}.`);
  }

  private pushLog(task: string, status: TaskLogEntry['status'], notes?: string): void {
    const entry: TaskLogEntry = {
      id: this.nextLogId,
      task,
      status,
      timestampIso: new Date().toISOString(),
      notes
    };

    this.nextLogId += 1;
    this.taskLog.update((current) => [entry, ...current].slice(0, 30));
  }

  private getModelControlValues(): QmriModelControlValues {
    return {
      ivimBMax: this.ivimBMax(),
      ivimRegularization: this.ivimRegularization(),
      ncdeTimeSteps: this.ncdeTimeSteps(),
      ncdeHiddenSize: this.ncdeHiddenSize()
    };
  }
}
