import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { Title } from '@angular/platform-browser';

import { IvimParameterMapKey, QmriInferenceResult, RoiSummary, SelectedVoxelFit } from './domain/qmri-inference.model';
import { QmriSessionStore } from './state/qmri-session.store';
import { MapsViewerComponent } from './components/maps-viewer/maps-viewer.component';

const EXPORT_MAP_KEYS: readonly IvimParameterMapKey[] = ['D', 'f', 'Dstar', 'r2', 'validMask'];
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
  protected readonly exportMessage = signal<string | null>(null);
  protected readonly workflowSteps = WORKFLOW_STEPS;
  protected readonly workflowStepStates = computed<readonly WorkflowStepState[]>(() => {
    const hasDataset = !!this.selectedScan() && !!this.selectedBvalFileName();
    const validationReady = hasDataset && this.validation().status === 'valid';
    const analysisReady = validationReady && this.inferenceResult()?.status === 'success';
    const mapsReviewed = analysisReady && (!!this.selectedVoxelFit() || !!this.selectedRoiSummary());
    const exportReady = mapsReviewed && (this.exportMessage() ?? '').toLowerCase().startsWith('exported');

    const completionFlags = [hasDataset, validationReady, analysisReady, mapsReviewed, exportReady] as const;
    const firstIncompleteIndex = completionFlags.findIndex((flag) => !flag);
    const activeIndex = firstIncompleteIndex === -1 ? -1 : firstIncompleteIndex;

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
  protected readonly workflowCompletedCount = computed(() => {
    return this.workflowStepStates().filter((state) => state === 'completed').length;
  });
  protected readonly workflowCurrentStep = computed(() => {
    const activeIndex = this.workflowStepStates().findIndex((state) => state === 'active');
    if (activeIndex === -1) {
      return this.workflowSteps.length;
    }
    return activeIndex + 1;
  });
  protected readonly workflowProgressPercent = computed(() => {
    return Math.round((this.workflowCompletedCount() / this.workflowSteps.length) * 100);
  });
  protected readonly validationDelta = computed(() => {
    const state = this.validation();
    if (state.volumeCount === undefined || state.bvalueCount === undefined) {
      return null;
    }
    return Math.abs(state.volumeCount - state.bvalueCount);
  });
  protected readonly uploadedAtLabel = computed(() => {
    const iso = this.selectedScan()?.uploadedAtIso;
    if (!iso) {
      return null;
    }

    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return new Intl.DateTimeFormat('nl-NL', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(date);
  });
  protected readonly validationReadiness = computed(() => {
    const state = this.validation();
    if (state.status === 'valid') {
      return 'Dataset is ready for IVIM LSQ fitting.';
    }
    if (state.status === 'pending') {
      return 'Validation is in progress or incomplete. Verify both files are loaded.';
    }
    if (state.status === 'invalid') {
      return 'Resolve the mismatch between volumes and b-values before starting the fit.';
    }
    return 'Load the NIfTI and .bval files first to validate the dataset.';
  });
  protected currentSlice = 0;

  constructor() {
    this.pageTitle.setTitle('qMRI GUI (Graphic User Interface)');
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

  protected updateCurrentSlice(slice: number): void {
    this.currentSlice = slice;
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
    return !!result && result.status === 'success' && !!result.voxelFit;
  }

  protected canExportReport(): boolean {
    return this.inferenceResult() !== null;
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
        const expectedLength = x * y * z;
        if (values.length !== expectedLength) {
          throw new Error(`Map ${map.displayName} has ${values.length} voxels, expected ${expectedLength}.`);
        }

        const niftiBlob = this.buildNiftiBlob(values, [x, y, z]);
        const fileSuffix = key === 'validMask' ? 'valid_mask' : key;
        this.downloadBlob(niftiBlob, `${baseName}_${fileSuffix}.nii`);
      }

      this.exportMessage.set(`Exported ${EXPORT_MAP_KEYS.length} parameter map NIfTI files.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not export parameter maps.';
      this.exportMessage.set(message);
    }
  }

  protected exportVoxelFitCsv(): void {
    const result = this.inferenceResult();
    if (!result || result.status !== 'success' || !result.voxelFit) {
      this.exportMessage.set('Voxel fit data is not available for CSV export.');
      return;
    }

    const baseName = this.exportBaseName();
    const csvParts: string[] = [];
    csvParts.push('x,y,z,D,f,Dstar,adjustedR2,validMask');

    try {
      const shape = result.metadata.imageShape;
      const totalVoxels = shape[0] * shape[1] * shape[2];
      const d = this.decodeFloat32Base64(result.parameterMaps.D.data);
      const f = this.decodeFloat32Base64(result.parameterMaps.f.data);
      const dstar = this.decodeFloat32Base64(result.parameterMaps.Dstar.data);
      const r2 = this.decodeFloat32Base64(result.parameterMaps.r2.data);
      const validMask = this.decodeFloat32Base64(result.parameterMaps.validMask.data);

      if ([d, f, dstar, r2, validMask].some((array) => array.length !== totalVoxels)) {
        throw new Error('Voxel arrays are inconsistent and could not be exported.');
      }

      for (let x = 0; x < shape[0]; x++) {
        for (let y = 0; y < shape[1]; y++) {
          for (let z = 0; z < shape[2]; z++) {
            const index = this.getMapIndex(x, y, z, shape);
            if (!Number.isFinite(validMask[index]) || validMask[index] <= 0) {
              continue;
            }
            csvParts.push([
              x,
              y,
              z,
              this.formatCsvNumber(d[index]),
              this.formatCsvNumber(f[index]),
              this.formatCsvNumber(dstar[index]),
              this.formatCsvNumber(r2[index]),
              this.formatCsvNumber(validMask[index]),
            ].join(','));
          }
        }
      }

      this.downloadText(csvParts.join('\n'), `${baseName}_voxel_fit_summary.csv`, 'text/csv;charset=utf-8');

      const selected = this.selectedVoxelFit();
      if (selected) {
        const selectedRows = ['bValue,measuredSignal,fittedSignal'];
        for (let i = 0; i < selected.bvalues.length; i++) {
          selectedRows.push([
            this.formatCsvNumber(selected.bvalues[i]),
            this.formatCsvNumber(selected.measured[i]),
            this.formatCsvNumber(selected.fitted[i]),
          ].join(','));
        }
        this.downloadText(
          selectedRows.join('\n'),
          `${baseName}_selected_voxel_${selected.x}_${selected.y}_${selected.z}.csv`,
          'text/csv;charset=utf-8'
        );
      }

      this.exportMessage.set(selected
        ? 'Exported voxel fit summary CSV and selected voxel signal-fit CSV.'
        : 'Exported voxel fit summary CSV. Select a voxel to also export its fitted curve CSV.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not export voxel fit CSV.';
      this.exportMessage.set(message);
    }
  }

  protected exportReport(): void {
    const result = this.inferenceResult();
    if (!result) {
      this.exportMessage.set('No inference data available for report export.');
      return;
    }

    const selectedVoxel = this.selectedVoxelFit();
    const selectedRoi = this.selectedRoiSummary();
    const report = {
      exportedAtIso: new Date().toISOString(),
      scan: this.selectedScan(),
      validation: this.validation(),
      inferenceStatus: this.inferenceStatus(),
      resultSummary: this.toResultSummary(result),
      selectedVoxel: selectedVoxel ? {
        x: selectedVoxel.x,
        y: selectedVoxel.y,
        z: selectedVoxel.z,
        D: selectedVoxel.D,
        f: selectedVoxel.f,
        Dstar: selectedVoxel.Dstar,
        adjustedR2: selectedVoxel.r2,
        residualRmse: selectedVoxel.residualRmse,
      } : null,
      selectedRoi,
      taskLog: this.taskLog(),
    };

    const baseName = this.exportBaseName();
    this.downloadText(JSON.stringify(report, null, 2), `${baseName}_report.json`, 'application/json;charset=utf-8');
    this.exportMessage.set('Exported JSON report with metadata, QC metrics, and current selections.');
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

  private exportBaseName(): string {
    const fileName = this.selectedScan()?.fileName ?? 'qmri_output';
    return fileName.replace(/\.nii(\.gz)?$/i, '').replace(/[^a-z0-9._-]+/gi, '_');
  }

  private toResultSummary(result: QmriInferenceResult): Record<string, unknown> {
    return {
      status: result.status,
      message: result.message,
      metadata: result.metadata,
      qc: result.qc,
      parameterMaps: {
        D: this.mapStats(result, 'D'),
        f: this.mapStats(result, 'f'),
        Dstar: this.mapStats(result, 'Dstar'),
        r2: this.mapStats(result, 'r2'),
        validMask: this.mapStats(result, 'validMask'),
      },
    };
  }

  private mapStats(result: QmriInferenceResult, key: IvimParameterMapKey): Record<string, unknown> {
    const map = result.parameterMaps[key];
    return {
      displayName: map.displayName,
      unit: map.unit,
      minValue: map.minValue,
      maxValue: map.maxValue,
      meanValue: map.meanValue,
    };
  }

  private buildNiftiBlob(values: Float32Array, shape: [number, number, number]): Blob {
    const headerBytes = 352;
    const voxelCount = shape[0] * shape[1] * shape[2];
    const dataBytes = voxelCount * 4;
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
    view.setInt16(252, 0, true);
    view.setInt16(254, 0, true);

    bytes[123] = 2;
    bytes[344] = 110;
    bytes[345] = 43;
    bytes[346] = 49;
    bytes[347] = 0;

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
    const blob = new Blob([content], { type: mimeType });
    this.downloadBlob(blob, fileName);
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
