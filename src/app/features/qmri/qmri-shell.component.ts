import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { Title } from '@angular/platform-browser';

import {
  ExportReportModel,
  IvimParameterMapKey,
  QmriInferenceResult,
  RoiSummary,
  SelectedVoxelFit,
} from './domain/qmri-inference.model';
import { MapsViewerComponent } from './components/maps-viewer/maps-viewer.component';
import { QmriSessionStore } from './state/qmri-session.store';
import { ViewerState } from './qmri.types';
import { formatCompactList, formatPercent, formatSummaryNumber } from './utils/number-format.util';

const EXPORT_MAP_KEYS: readonly IvimParameterMapKey[] = ['D', 'f', 'Dstar', 'r2'];
const WORKFLOW_STEPS = [
  { number: 1, label: 'Dataset' },
  { number: 2, label: 'Validation' },
  { number: 3, label: 'Analysis' },
  { number: 4, label: 'Maps' },
  { number: 5, label: 'Export' },
] as const;

type WorkflowStepState = 'completed' | 'active' | 'upcoming';

@Component({
  selector: 'app-qmri-shell',
  imports: [NgOptimizedImage, MapsViewerComponent],
  templateUrl: './qmri-shell.component.html',
  styleUrl: './qmri-shell.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QmriShellComponent {
  private readonly sessionStore = inject(QmriSessionStore);
  private readonly pageTitle = inject(Title);

  protected readonly selectedScan = this.sessionStore.selectedScan;
  protected readonly selectedBvalFileName = this.sessionStore.selectedBvalFileName;
  protected readonly niftiFileState = this.sessionStore.niftiFileState;
  protected readonly bvalueFileState = this.sessionStore.bvalueFileState;
  protected readonly ingestMessage = this.sessionStore.ingestMessage;
  protected readonly validation = this.sessionStore.validation;
  protected readonly inferenceStatus = this.sessionStore.inferenceStatus;
  protected readonly inferenceResult = this.sessionStore.inferenceResult;
  protected readonly previewDataset = this.sessionStore.previewDataset;
  protected readonly taskLog = this.sessionStore.taskLog;

  protected readonly selectedVoxelFit = signal<SelectedVoxelFit | null>(null);
  protected readonly selectedRoiSummary = signal<RoiSummary | null>(null);
  protected readonly exportMessage = signal<string | null>(null);
  protected readonly viewerState = signal<ViewerState | null>(null);
  protected readonly showGraphDialog = signal(false);
  protected readonly roiToolMode = signal<'voxel' | 'rectangle' | 'polygon'>('voxel');
  protected readonly clearSelectionNonce = signal(0);
  protected readonly finishRoiNonce = signal(0);

  protected readonly workflowSteps = WORKFLOW_STEPS;
  protected readonly workflowStepStates = computed<readonly WorkflowStepState[]>(() => {
    const hasDataset = this.niftiFileState().status === 'loaded' && this.bvalueFileState().status === 'loaded';
    const validationReady = hasDataset && this.validation().status === 'valid';
    const analysisReady = validationReady && this.inferenceResult()?.status === 'success';
    const mapsReviewed = analysisReady && (!!this.selectedVoxelFit() || !!this.selectedRoiSummary());
    const exportReady = mapsReviewed && (this.exportMessage() ?? '').toLowerCase().startsWith('exported');

    const completionFlags = [hasDataset, validationReady, analysisReady, mapsReviewed, exportReady] as const;
    const activeIndex = completionFlags.findIndex((flag) => !flag);

    return this.workflowSteps.map((_, index) => {
      if (completionFlags[index]) {
        return 'completed';
      }
      if (index === activeIndex) {
        return 'active';
      }
      return 'upcoming';
    });
  });

  protected readonly workflowCompletedCount = computed(() => this.workflowStepStates().filter((state) => state === 'completed').length);
  protected readonly workflowProgressPercent = computed(() => Math.round((this.workflowCompletedCount() / this.workflowSteps.length) * 100));

  protected readonly uploadedAtLabel = computed(() => {
    const iso = this.validation().uploadTimeIso ?? this.selectedScan()?.uploadedAtIso;
    if (!iso) {
      return 'Not available';
    }

    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return 'Not available';
    }

    return new Intl.DateTimeFormat('nl-NL', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  });

  protected readonly validationResultLabel = computed(() => {
    const state = this.validation();
    if (state.volumeCount === undefined || state.bvalueCount === undefined) {
      return state.message;
    }

    if (state.filesMatch) {
      return 'Volumes and b-value entries match';
    }

    return `Mismatch: ${state.volumeCount} volumes and ${state.bvalueCount} b-value entries`;
  });

  protected readonly validationReadiness = computed(() => {
    const status = this.validation().status;
    if (status === 'valid') {
      return 'Dataset is ready for IVIM LSQ fitting.';
    }
    if (status === 'pending') {
      return 'Validation is in progress or incomplete. Verify both files are loaded.';
    }
    if (status === 'invalid') {
      return 'Resolve the mismatch between volumes and b-values before starting the fit.';
    }
    return 'Select a diffusion NIfTI dataset and its corresponding b-values file.';
  });
  protected readonly voxelSpacingLabel = computed(() => {
    const spacing = this.validation().voxelSpacing;
    if (!spacing) {
      return 'Not available';
    }

    return `${this.formatNumber(spacing[0], 2)} x ${this.formatNumber(spacing[1], 2)} x ${this.formatNumber(spacing[2], 2)} mm`;
  });

  protected readonly canExportRoiMask = computed(() => !!this.selectedRoiSummary() && this.canExportMaps());
  protected readonly canDownloadGraph = computed(() => !!this.selectedVoxelFit());
  protected readonly analysisRunStartLabel = computed(() => {
    const runStartIso = this.inferenceResult()?.analysisInfo?.runStartIso;
    if (!runStartIso) {
      return 'Not available';
    }

    const date = new Date(runStartIso);
    if (Number.isNaN(date.getTime())) {
      return 'Not available';
    }

    return new Intl.DateTimeFormat('nl-NL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Europe/Amsterdam',
    }).format(date);
  });

  protected readonly analysisRunDurationLabel = computed(() => {
    const durationMs = this.inferenceResult()?.analysisInfo?.runDurationMs;
    if (!Number.isFinite(durationMs) || (durationMs ?? 0) <= 0) {
      return 'Not available';
    }

    const totalSeconds = Math.max(0, Math.round((durationMs as number) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes > 0) {
      return `${minutes} min ${seconds} sec`;
    }

    return `${seconds} sec`;
  });

  constructor() {
    this.pageTitle.setTitle('qMRI GUI (Graphic User Interface)');
  }

  protected async onNiftiInput(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    await this.sessionStore.ingestScanFile(input.files?.[0] ?? null);
    this.resetSelections();
  }

  protected async onBvalInput(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    await this.sessionStore.ingestBvalFile(input.files?.[0] ?? null);
    this.resetSelections();
  }

  protected async onDatasetInput(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    await this.sessionStore.ingestDatasetFiles(Array.from(input.files ?? []));
    this.resetSelections();
  }

  protected async runInference(): Promise<void> {
    this.resetSelections();
    await this.sessionStore.runInference();
  }

  protected updateVoxelSelection(selection: SelectedVoxelFit | null): void {
    this.selectedVoxelFit.set(selection);
  }

  protected updateRoiSelection(summary: RoiSummary | null): void {
    this.selectedRoiSummary.set(summary);
  }

  protected updateViewerState(state: ViewerState): void {
    this.viewerState.set(state);
  }

  protected onSliceChanged(slice: number): void {
    const current = this.viewerState();
    if (!current) {
      return;
    }
    this.viewerState.set({ ...current, currentSlice: slice });
  }

  protected canRun(): boolean {
    return this.validation().status === 'valid' && this.inferenceStatus() !== 'running';
  }

  protected canExportMaps(): boolean {
    const result = this.inferenceResult();
    return !!result && result.status === 'success';
  }

  protected canExportVoxelCsv(): boolean {
    const result = this.inferenceResult();
    return !!result && result.status === 'success' && !!this.selectedVoxelFit();
  }

  protected canExportReport(): boolean {
    return this.inferenceResult() !== null;
  }

  protected openGraphDialog(): void {
    if (!this.selectedVoxelFit()) {
      return;
    }
    this.showGraphDialog.set(true);
  }

  protected closeGraphDialog(): void {
    this.showGraphDialog.set(false);
  }

  protected setRoiToolMode(value: string): void {
    if (value === 'voxel' || value === 'rectangle' || value === 'polygon') {
      this.roiToolMode.set(value);
    }
  }

  protected clearViewerSelection(): void {
    this.clearSelectionNonce.update((value) => value + 1);
    this.selectedVoxelFit.set(null);
    this.selectedRoiSummary.set(null);
  }

  protected finishViewerRoi(): void {
    this.finishRoiNonce.update((value) => value + 1);
  }

  protected downloadVoxelGraph(): void {
    const fit = this.selectedVoxelFit();
    if (!fit) {
      this.exportMessage.set('Select a voxel before downloading the fit graph.');
      return;
    }

    const points = fit.bvalues
      .map((_, index) => `${this.graphPointX(index, fit).toFixed(1)},${this.graphPointY(fit.fitted[index], fit).toFixed(1)}`)
      .join(' ');

    const circles = fit.measured
      .map((value, index) => `<circle cx="${this.graphPointX(index, fit).toFixed(1)}" cy="${this.graphPointY(value, fit).toFixed(1)}" r="3" fill="#b43d2f" />`)
      .join('');

    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">',
      '<rect width="100%" height="100%" fill="#fbfcfd"/>',
      '<line x1="42" y1="128" x2="288" y2="128" stroke="#9aa5ad"/>',
      '<line x1="42" y1="28" x2="42" y2="128" stroke="#9aa5ad"/>',
      `<polyline points="${points}" fill="none" stroke="#1f6f8b" stroke-width="2"/>`,
      circles,
      '</svg>',
    ].join('');

    const baseName = this.exportBaseName();
    this.downloadText(svg, `${baseName}_voxel_fit_graph.svg`, 'image/svg+xml;charset=utf-8');
    this.exportMessage.set('Exported voxel-fit graph as SVG.');
  }

  protected exportParameterMaps(): void {
    const result = this.inferenceResult();
    if (!result || result.status !== 'success') {
      this.exportMessage.set('No successful inference result available for map export.');
      return;
    }

    const [x, y, z] = result.metadata.imageShape;
    const baseName = this.exportBaseName();

    try {
      for (const key of EXPORT_MAP_KEYS) {
        const map = result.parameterMaps[key];
        const values = this.decodeFloat32Base64(map.data);
        if (values.length !== x * y * z) {
          throw new Error(`Map ${map.displayName} has ${values.length} voxels, expected ${x * y * z}.`);
        }

        const niftiBlob = this.buildNiftiBlob(values, [x, y, z]);
        this.downloadBlob(niftiBlob, `${baseName}_${key}.nii`);
      }

      this.exportMessage.set('Exported parameter maps (.nii).');
    } catch (error) {
      this.exportMessage.set(error instanceof Error ? error.message : 'Could not export parameter maps.');
    }
  }

  protected exportValidMask(): void {
    const result = this.inferenceResult();
    if (!result || result.status !== 'success') {
      this.exportMessage.set('No successful inference result available for valid mask export.');
      return;
    }

    const [x, y, z] = result.metadata.imageShape;
    const values = this.decodeFloat32Base64(result.parameterMaps.validMask.data);
    if (values.length !== x * y * z) {
      this.exportMessage.set('Valid mask export failed due to inconsistent map dimensions.');
      return;
    }

    const niftiBlob = this.buildNiftiBlob(values, [x, y, z]);
    this.downloadBlob(niftiBlob, `${this.exportBaseName()}_valid_mask.nii`);
    this.exportMessage.set('Exported valid mask (.nii).');
  }

  protected exportRoiMask(): void {
    const result = this.inferenceResult();
    const roi = this.selectedRoiSummary();
    if (!result || result.status !== 'success' || !roi) {
      this.exportMessage.set('ROI export requires a current ROI selection and successful analysis result.');
      return;
    }

    const [x, y, z] = result.metadata.imageShape;
    const values = new Float32Array(x * y * z);
    for (let yy = roi.bounds.yStart; yy <= roi.bounds.yEnd; yy++) {
      for (let xx = roi.bounds.xStart; xx <= roi.bounds.xEnd; xx++) {
        const index = this.getMapIndex(xx, yy, roi.bounds.z, [x, y, z]);
        values[index] = 1;
      }
    }

    this.downloadBlob(this.buildNiftiBlob(values, [x, y, z]), `${this.exportBaseName()}_roi_mask.nii`);
    this.exportMessage.set('Exported ROI mask (.nii) from current ROI bounds.');
  }

  protected exportSelectedVoxelCsv(): void {
    const fit = this.selectedVoxelFit();
    if (!fit) {
      this.exportMessage.set('Select a voxel before exporting selected voxel CSV.');
      return;
    }

    const rows = ['bValue,measuredSignal,fittedSignal'];
    for (let i = 0; i < fit.bvalues.length; i++) {
      rows.push([
        this.formatCsvNumber(fit.bvalues[i]),
        this.formatCsvNumber(fit.measured[i]),
        this.formatCsvNumber(fit.fitted[i]),
      ].join(','));
    }

    this.downloadText(rows.join('\n'), `${this.exportBaseName()}_selected_voxel_${fit.x}_${fit.y}_${fit.z}.csv`, 'text/csv;charset=utf-8');
    this.exportMessage.set('Exported selected voxel CSV.');
  }

  protected exportReport(): void {
    const result = this.inferenceResult();
    if (!result) {
      this.exportMessage.set('No inference data available for report export.');
      return;
    }

    const state = this.viewerState();
    const report: ExportReportModel = {
      exportedAtIso: new Date().toISOString(),
      inputFiles: {
        niftiFileName: this.selectedScan()?.fileName ?? null,
        bvalueFileName: this.selectedBvalFileName(),
      },
      image: {
        dimensions: this.validation().imageDimensions ?? null,
        voxelSpacing: this.validation().voxelSpacing ?? null,
      },
      bvalues: {
        totalCount: this.validation().bvalueCount ?? null,
        uniqueCount: this.validation().uniqueBvalueCount ?? null,
        uniqueValues: this.validation().uniqueBvalues ?? [],
      },
      display: {
        selectedBackgroundImage: state ? `${state.selectedBackgroundMode}:${state.selectedBackgroundVolumeIndex}` : null,
        selectedParameterMap: state?.selectedMap ?? null,
      },
      analysis: {
        status: this.inferenceStatus(),
        startedAtIso: result.analysisInfo?.runStartIso ?? null,
        durationMs: result.analysisInfo?.runDurationMs ?? null,
        softwareVersion: result.analysisInfo?.softwareVersion ?? null,
      },
      mask: result.status === 'success'
        ? {
            validVoxelCount: result.qc.validVoxelCount ?? 0,
            invalidVoxelCount: result.qc.failedVoxelCount,
            totalEvaluatedVoxelCount: result.qc.evaluatedVoxelCount ?? 0,
            validPercentage: result.qc.validVoxelPercentage,
            invalidPercentage: 100 - result.qc.validVoxelPercentage,
          }
        : null,
      selectedVoxel: this.selectedVoxelFit(),
      selectedRoi: this.selectedRoiSummary(),
      appVersion: '0.2.0',
    };

    this.downloadText(
      JSON.stringify(report, null, 2),
      `${this.exportBaseName()}_analysis_report.json`,
      'application/json;charset=utf-8',
    );
    this.exportMessage.set('Exported analysis report JSON.');
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

  protected formatNumber(value: number | null | undefined, decimals = 3): string {
    return formatSummaryNumber(value, { decimals });
  }

  protected formatPercent(value: number | null | undefined, decimals = 1): string {
    return formatPercent(value, decimals);
  }

  protected formatBvalueList(values: readonly number[] | undefined): string {
    return formatCompactList(values ?? []);
  }

  private resetSelections(): void {
    this.selectedVoxelFit.set(null);
    this.selectedRoiSummary.set(null);
    this.viewerState.set(null);
    this.showGraphDialog.set(false);
  }

  private sortedFitIndices(fit: SelectedVoxelFit): readonly number[] {
    return fit.bvalues.map((_, index) => index).sort((left, right) => fit.bvalues[left] - fit.bvalues[right]);
  }

  private exportBaseName(): string {
    const fileName = this.selectedScan()?.fileName ?? 'qmri_output';
    return fileName.replace(/\.nii(\.gz)?$/i, '').replace(/[^a-z0-9._-]+/gi, '_');
  }

  private buildNiftiBlob(values: Float32Array, shape: [number, number, number]): Blob {
    const headerBytes = 352;
    const dataBytes = shape[0] * shape[1] * shape[2] * 4;
    const buffer = new ArrayBuffer(headerBytes + dataBytes);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    view.setInt32(0, 348, true);
    view.setInt16(40, 3, true);
    view.setInt16(42, shape[0], true);
    view.setInt16(44, shape[1], true);
    view.setInt16(46, shape[2], true);
    view.setInt16(70, 16, true);
    view.setInt16(72, 32, true);
    view.setFloat32(76 + 4, 1, true);
    view.setFloat32(76 + 8, 1, true);
    view.setFloat32(76 + 12, 1, true);
    view.setFloat32(108, 352, true);

    bytes[123] = 2;
    bytes[344] = 110;
    bytes[345] = 43;
    bytes[346] = 49;

    const dataView = new DataView(buffer, headerBytes, dataBytes);
    for (let i = 0; i < values.length; i++) {
      dataView.setFloat32(i * 4, values[i], true);
    }

    return new Blob([buffer], { type: 'application/octet-stream' });
  }

  private decodeFloat32Base64(base64: string): Float32Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Float32Array(bytes.buffer);
  }

  private getMapIndex(x: number, y: number, z: number, shape: [number, number, number]): number {
    return x * shape[1] * shape[2] + y * shape[2] + z;
  }

  private formatCsvNumber(value: number): string {
    return Number.isFinite(value) ? String(value) : 'NaN';
  }

  private downloadText(content: string, fileName: string, mimeType: string): void {
    this.downloadBlob(new Blob([content], { type: mimeType }), fileName);
  }

  private downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
