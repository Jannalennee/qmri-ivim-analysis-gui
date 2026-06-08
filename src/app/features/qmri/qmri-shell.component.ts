import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { Title } from '@angular/platform-browser';

import { QmriModelId } from './domain/qmri-inference.model';
import { UserRole } from './qmri.types';
import { QmriSessionStore } from './state/qmri-session.store';

@Component({
  selector: 'app-qmri-shell',
  imports: [NgOptimizedImage],
  templateUrl: './qmri-shell.component.html',
  styleUrl: './qmri-shell.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class QmriShellComponent {
  private readonly sessionStore = inject(QmriSessionStore);
  private readonly pageTitle = inject(Title);

  constructor() {
    this.pageTitle.setTitle('AMC qMRI');
  }

  protected readonly selectedRole = this.sessionStore.selectedRole;
  protected readonly showAdvancedControls = this.sessionStore.showAdvancedControls;
  protected readonly confidenceThreshold = this.sessionStore.confidenceThreshold;
  protected readonly overlayOpacity = this.sessionStore.overlayOpacity;
  protected readonly smoothingLevel = this.sessionStore.smoothingLevel;
  protected readonly showUncertaintyOverlay = this.sessionStore.showUncertaintyOverlay;
  protected readonly ivimBMax = this.sessionStore.ivimBMax;
  protected readonly ivimRegularization = this.sessionStore.ivimRegularization;
  protected readonly ncdeTimeSteps = this.sessionStore.ncdeTimeSteps;
  protected readonly ncdeHiddenSize = this.sessionStore.ncdeHiddenSize;
  protected readonly selectedScan = this.sessionStore.selectedScan;
  protected readonly ingestMessage = this.sessionStore.ingestMessage;
  protected readonly inferenceStatus = this.sessionStore.inferenceStatus;
  protected readonly inferenceResult = this.sessionStore.inferenceResult;
  protected readonly selectedModel = this.sessionStore.selectedModel;
  protected readonly modelOptions = this.sessionStore.modelOptions;
  protected readonly taskLog = this.sessionStore.taskLog;
  protected readonly roleDescription = this.sessionStore.roleDescription;
  protected readonly workflowStep = this.sessionStore.workflowStep;
  protected readonly visibleTasks = this.sessionStore.visibleTasks;

  protected updateRole(role: UserRole): void {
    this.sessionStore.updateRole(role);
  }

  protected setThreshold(value: number): void {
    this.sessionStore.setThreshold(value);
  }

  protected setOpacity(value: number): void {
    this.sessionStore.setOpacity(value);
  }

  protected setSmoothing(value: number): void {
    this.sessionStore.setSmoothing(value);
  }

  protected toggleUncertainty(): void {
    this.sessionStore.toggleUncertainty();
  }

  protected handleFileSelected(file: File | null): void {
    this.sessionStore.ingestFile(file);
  }

  protected runInference(): void {
    this.sessionStore.runInference();
  }

  protected setModel(model: QmriModelId): void {
    this.sessionStore.setModel(model);
  }

  protected setIvimBMax(value: number): void {
    this.sessionStore.setIvimBMax(value);
  }

  protected setIvimRegularization(value: number): void {
    this.sessionStore.setIvimRegularization(value);
  }

  protected setNcdeTimeSteps(value: number): void {
    this.sessionStore.setNcdeTimeSteps(value);
  }

  protected setNcdeHiddenSize(value: number): void {
    this.sessionStore.setNcdeHiddenSize(value);
  }

  protected applyRecommendedSettings(): void {
    this.sessionStore.applyRecommendedSettings();
  }

  protected onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.handleFileSelected(file);
  }

  protected onModelChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'ivimnet' || value === 'ncde-qmri') {
      this.setModel(value);
    }
  }
}
