import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { Title } from '@angular/platform-browser';

import { RoiSummary, SelectedVoxelFit } from './domain/qmri-inference.model';
import { QmriSessionStore } from './state/qmri-session.store';
import { MapsViewerComponent } from './components/maps-viewer/maps-viewer.component';

@Component({
  selector: 'app-qmri-shell',
  imports: [NgOptimizedImage, MapsViewerComponent],
  templateUrl: './qmri-shell.component.html',
  styleUrl: './qmri-shell.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class QmriShellComponent {
  private readonly sessionStore = inject(QmriSessionStore);
  private readonly pageTitle = inject(Title);

  protected readonly selectedScan = this.sessionStore.selectedScan;
  protected readonly selectedBvalFileName = this.sessionStore.selectedBvalFileName;
  protected readonly ingestMessage = this.sessionStore.ingestMessage;
  protected readonly validation = this.sessionStore.validation;
  protected readonly inferenceStatus = this.sessionStore.inferenceStatus;
  protected readonly inferenceResult = this.sessionStore.inferenceResult;
  protected readonly taskLog = this.sessionStore.taskLog;
  protected readonly selectedVoxelFit = signal<SelectedVoxelFit | null>(null);
  protected readonly selectedRoiSummary = signal<RoiSummary | null>(null);
  protected currentSlice = 0;

  constructor() {
    this.pageTitle.setTitle('IVIM LSQ Proof of Concept');
  }

  protected async onNiftiInput(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    await this.sessionStore.ingestScanFile(input.files?.[0] ?? null);
    this.selectedVoxelFit.set(null);
    this.selectedRoiSummary.set(null);
  }

  protected async onBvalInput(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    await this.sessionStore.ingestBvalFile(input.files?.[0] ?? null);
    this.selectedVoxelFit.set(null);
    this.selectedRoiSummary.set(null);
  }

  protected async onDatasetInput(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    await this.sessionStore.ingestDatasetFiles(Array.from(input.files ?? []));
    this.selectedVoxelFit.set(null);
    this.selectedRoiSummary.set(null);
  }

  protected async runInference(): Promise<void> {
    this.selectedVoxelFit.set(null);
    this.selectedRoiSummary.set(null);
    await this.sessionStore.runInference();
  }

  protected updateVoxelSelection(selection: SelectedVoxelFit | null): void {
    this.selectedVoxelFit.set(selection);
  }

  protected updateRoiSelection(summary: RoiSummary | null): void {
    this.selectedRoiSummary.set(summary);
  }

  protected canRun(): boolean {
    return this.validation().status === 'valid' && this.inferenceStatus() !== 'running';
  }

  protected graphPointX(index: number, fit: SelectedVoxelFit): number {
    const maxBvalue = Math.max(...fit.bvalues, 1);
    return 42 + (fit.bvalues[index] / maxBvalue) * 246;
  }

  protected graphPointY(value: number, fit: SelectedVoxelFit): number {
    const maxSignal = this.graphMaxSignal(fit);
    const clamped = Math.max(0, Math.min(maxSignal, value));
    return 128 - (clamped / maxSignal) * 100;
  }

  protected fittedPolyline(fit: SelectedVoxelFit): string {
    return this.sortedFitIndices(fit)
      .map((index) => `${this.graphPointX(index, fit).toFixed(1)},${this.graphPointY(fit.fitted[index], fit).toFixed(1)}`)
      .join(' ');
  }

  protected graphMaxSignal(fit: SelectedVoxelFit): number {
    const maxSignal = Math.max(...fit.measured, ...fit.fitted, 1);
    return Math.ceil(maxSignal * 10) / 10;
  }

  protected minBvalue(fit: SelectedVoxelFit): number {
    return Math.min(...fit.bvalues);
  }

  protected maxBvalue(fit: SelectedVoxelFit): number {
    return Math.max(...fit.bvalues);
  }

  private sortedFitIndices(fit: SelectedVoxelFit): readonly number[] {
    return fit.bvalues.map((_, index) => index).sort((left, right) => fit.bvalues[left] - fit.bvalues[right]);
  }
}
