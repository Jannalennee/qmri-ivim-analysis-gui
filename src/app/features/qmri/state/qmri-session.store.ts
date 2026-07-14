import { Injectable, inject, signal } from '@angular/core';

import { TaskLogEntry } from '../domain/qmri-evaluation.model';
import { IngestedScan, QmriInferenceResult, QmriInferenceStatus } from '../domain/qmri-inference.model';
import { QmriDataIngestService } from '../services/qmri-data-ingest.service';
import { QmriInferenceService } from '../services/qmri-inference.service';
import { QmriPreviewService } from '../services/qmri-preview.service';
import { DatasetFileState, DiffusionPreviewDataset, IvimValidationState, UniqueBvalueSummary } from '../qmri.types';
import { buildMatchMessage } from '../utils/validation.util';

@Injectable({ providedIn: 'root' })
export class QmriSessionStore {
  private readonly dataIngestService = inject(QmriDataIngestService);
  private readonly inferenceService = inject(QmriInferenceService);
  private readonly previewService = inject(QmriPreviewService);
  private currentScanFile: File | null = null;
  private currentBvalFile: File | null = null;
  private nextLogId = 1;

  readonly selectedScan = signal<IngestedScan | null>(null);
  readonly selectedBvalFileName = signal<string | null>(null);
  readonly niftiFileState = signal<DatasetFileState>({
    fileName: null,
    status: 'not-selected',
    message: 'Not selected',
  });
  readonly bvalueFileState = signal<DatasetFileState>({
    fileName: null,
    status: 'not-selected',
    message: 'Not selected',
  });
  readonly ingestMessage = signal('Load an IVIM diffusion NIfTI file and its matching .bval file.');
  readonly validation = signal<IvimValidationState>({
    status: 'empty',
    message: 'Waiting for dataset files.'
  });
  readonly inferenceStatus = signal<QmriInferenceStatus>('idle');
  readonly inferenceResult = signal<QmriInferenceResult | null>(null);
  readonly previewDataset = signal<DiffusionPreviewDataset | null>(null);
  readonly taskLog = signal<readonly TaskLogEntry[]>([]);

  async ingestDatasetFiles(files: readonly File[]): Promise<void> {
    this.pushLog('Load dataset', 'started');
    this.inferenceResult.set(null);
    this.previewDataset.set(null);

    const scanFile = files.find((file) => this.isNiftiFile(file.name)) ?? null;
    const bvalFile = files.find((file) => this.isBvalueFile(file)) ?? null;
    const unsupported = files.find((file) => !this.isNiftiFile(file.name) && !this.isBvalueFile(file));

    if (unsupported) {
      const message = `Invalid file type for ${unsupported.name}. Select .nii/.nii.gz and .bval/.bvals/.txt.`;
      this.validation.set({ status: 'invalid', message });
      this.ingestMessage.set(message);
      this.inferenceStatus.set('error');
      this.pushLog('Load dataset', 'failed', message);
      return;
    }

    const result = this.dataIngestService.ingest(scanFile);
    if (!result.ok || !result.scan || !scanFile) {
      this.currentScanFile = null;
      this.currentBvalFile = null;
      this.selectedScan.set(null);
      this.selectedBvalFileName.set(null);
      this.niftiFileState.set({
        fileName: scanFile?.name ?? null,
        status: scanFile ? 'validation-error' : 'not-selected',
        message: scanFile ? result.message : 'Not selected',
      });
      this.bvalueFileState.set({
        fileName: bvalFile?.name ?? null,
        status: bvalFile ? 'loaded' : 'not-selected',
        message: bvalFile ? 'Loaded' : 'Not selected',
      });
      this.ingestMessage.set(result.message);
      this.validation.set({ status: 'invalid', message: result.message });
      this.inferenceStatus.set('error');
      this.previewDataset.set(null);
      this.pushLog('Load dataset', 'failed', result.message);
      return;
    }

    this.currentScanFile = scanFile;
    this.currentBvalFile = bvalFile;
    this.niftiFileState.set({ fileName: scanFile.name, status: 'loaded', message: 'Loaded' });
    this.bvalueFileState.set({
      fileName: bvalFile?.name ?? null,
      status: bvalFile ? 'loaded' : 'not-selected',
      message: bvalFile ? 'Loaded' : 'Not selected',
    });
    this.selectedBvalFileName.set(bvalFile?.name ?? null);
    this.selectedScan.set({
      ...result.scan,
      bvalFileName: bvalFile?.name
    });

    if (!bvalFile) {
      const message = `Loaded ${scanFile.name}. Select the matching b-value file.`;
      this.ingestMessage.set(message);
      this.validation.set({ status: 'pending', message });
      this.inferenceStatus.set('idle');
      this.previewDataset.set(null);
      this.pushLog('Load dataset', 'completed', message);
      return;
    }

    await this.validateCurrentDataset();
    this.pushLog('Load dataset', this.validation().status === 'valid' ? 'completed' : 'failed', this.validation().message);
  }

  async ingestScanFile(file: File | null): Promise<void> {
    if (file && !this.isNiftiFile(file.name)) {
      const message = 'Invalid file type. Diffusion NIfTI must be .nii or .nii.gz.';
      this.niftiFileState.set({ fileName: file.name, status: 'invalid-file-type', message });
      this.validation.set({ status: 'invalid', message });
      this.inferenceStatus.set('error');
      return;
    }

    await this.ingestDatasetFiles([file, this.currentBvalFile].filter((item): item is File => item !== null));
  }

  async ingestBvalFile(file: File | null): Promise<void> {
    if (!file) {
      this.currentBvalFile = null;
      this.selectedBvalFileName.set(null);
      this.bvalueFileState.set({ fileName: null, status: 'not-selected', message: 'Not selected' });
      this.validation.set({ status: 'pending', message: 'Select a .bval file.' });
      return;
    }

    if (!this.isBvalueFile(file)) {
      this.currentBvalFile = null;
      this.selectedBvalFileName.set(null);
      this.bvalueFileState.set({
        fileName: file.name,
        status: 'invalid-file-type',
        message: 'Invalid file type. Use .bval, .bvals, or plain text.',
      });
      this.validation.set({ status: 'invalid', message: 'Unsupported b-value format. Use .bval, .bvals, or plain text.' });
      this.previewDataset.set(null);
      return;
    }

    this.currentBvalFile = file;
    this.selectedBvalFileName.set(file.name);
    this.bvalueFileState.set({ fileName: file.name, status: 'loaded', message: 'Loaded' });
    await this.validateCurrentDataset();
  }

  async runInference(): Promise<void> {
    const scanFile = this.currentScanFile;
    const bvalFile = this.currentBvalFile;

    if (!scanFile || !bvalFile) {
      const message = 'Load both the NIfTI and b-value files before running IVIM-LSQ.';
      this.inferenceStatus.set('error');
      this.validation.set({ status: 'invalid', message });
      this.pushLog('Run IVIM LSQ', 'failed', message);
      return;
    }

    if (this.validation().status !== 'valid') {
      await this.validateCurrentDataset();
      if (this.validation().status === 'invalid') {
        this.inferenceStatus.set('error');
        this.pushLog('Run IVIM LSQ', 'failed', this.validation().message);
        return;
      }
    }

    this.inferenceStatus.set('running');
    this.pushLog('Run IVIM LSQ', 'started', `Fitting ${scanFile.name} with ${bvalFile.name}.`);

    try {
      const result = await this.inferenceService.runInference(scanFile, bvalFile);
      this.inferenceResult.set(result);
      this.inferenceStatus.set(result.status === 'success' ? 'completed' : 'error');
      const durationNote = this.formatDurationMinutes(result.analysisInfo?.runDurationMs);
      const startNote = this.formatRunStart(result.analysisInfo?.runStartIso);
      const timingNote = durationNote || startNote
        ? [durationNote, startNote].filter(Boolean).join(' | ')
        : null;
      this.pushLog(
        'Run IVIM LSQ',
        result.status === 'success' ? 'completed' : 'failed',
        timingNote ? `${result.message} (${timingNote})` : result.message,
      );
    } catch (error) {
      const details = error instanceof Error ? error.message : 'Unknown backend error';
      this.inferenceStatus.set('error');
      this.pushLog('Run IVIM LSQ', 'failed', details);
    }
  }

  private async validateCurrentDataset(): Promise<void> {
    const scanFile = this.currentScanFile;
    const bvalFile = this.currentBvalFile;

    if (!scanFile || !bvalFile) {
      this.validation.set({ status: 'pending', message: 'Load both files to validate the dataset.' });
      return;
    }

    this.validation.set({ status: 'pending', message: 'Reading b-values and NIfTI header.' });

    try {
      const [bvalueSummary, niftiMeta] = await Promise.all([
        this.readBvalues(bvalFile),
        this.readNiftiMetadata(scanFile)
      ]);
      const bvalueCount = bvalueSummary.values.length;
      const volumeCount = niftiMeta.volumeCount;
      const filesMatch = bvalueCount === volumeCount;

      const status = filesMatch ? 'valid' : 'invalid';
      const message = buildMatchMessage(volumeCount, bvalueCount);

      this.selectedScan.update((current) => current ? {
        ...current,
        bvalFileName: bvalFile.name,
        volumeCount,
        bvalueCount,
        uniqueBvalueCount: bvalueSummary.unique.values.length,
        uniqueBvalues: bvalueSummary.unique.values,
        imageDimensions: niftiMeta.imageDimensions,
        numberOfSlices: niftiMeta.numberOfSlices,
        voxelSpacing: niftiMeta.voxelSpacing,
      } : current);
      this.ingestMessage.set(`Loaded ${scanFile.name} + ${bvalFile.name}.`);
      this.validation.set({
        status,
        message,
        volumeCount,
        bvalueCount,
        uniqueBvalueCount: bvalueSummary.unique.values.length,
        uniqueBvalues: bvalueSummary.unique.values,
        uniqueBvalueSummary: bvalueSummary.unique,
        imageDimensions: niftiMeta.imageDimensions,
        numberOfSlices: niftiMeta.numberOfSlices,
        voxelSpacing: niftiMeta.voxelSpacing,
        fileFormat: this.resolveFileFormat(scanFile.name),
        fileSizeBytes: scanFile.size,
        uploadTimeIso: this.selectedScan()?.uploadedAtIso ?? new Date().toISOString(),
        filesMatch,
      });
      this.niftiFileState.set({ fileName: scanFile.name, status: 'loaded', message: 'Loaded' });
      this.bvalueFileState.set({
        fileName: bvalFile.name,
        status: filesMatch ? 'loaded' : 'validation-error',
        message: filesMatch ? 'Loaded' : 'Validation error',
      });
      this.inferenceStatus.set(status === 'valid' ? 'idle' : 'error');

      if (filesMatch) {
        this.previewDataset.set(await this.previewService.parsePreview(scanFile, bvalueSummary));
      } else {
        this.previewDataset.set(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not validate dataset files.';
      this.validation.set({ status: 'invalid', message });
      this.bvalueFileState.update((current) => ({ ...current, status: 'validation-error', message: 'Validation error' }));
      this.inferenceStatus.set('error');
      this.previewDataset.set(null);
    }
  }

  private async readBvalues(file: File): Promise<{ values: readonly number[]; unique: UniqueBvalueSummary }> {
    const text = await file.text();
    const values = text
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((value) => Number(value));
    if (values.length === 0) {
      throw new Error('The b-value file is empty.');
    }
    if (values.some((value) => !Number.isFinite(value))) {
      throw new Error('The b-value file contains non-numeric values.');
    }

    const countsByValue: Record<string, number> = {};
    for (const value of values) {
      const key = String(value);
      countsByValue[key] = (countsByValue[key] ?? 0) + 1;
    }

    const uniqueValues = Object.keys(countsByValue)
      .map((key) => Number(key))
      .sort((left, right) => left - right);

    return {
      values,
      unique: {
        values: uniqueValues,
        countsByValue,
      },
    };
  }

  private async readNiftiMetadata(file: File): Promise<{
    volumeCount: number;
    imageDimensions: [number, number, number];
    numberOfSlices: number;
    voxelSpacing: [number, number, number] | null;
  }> {
    const header = await this.readNiftiHeader(file);
    const headerView = new DataView(header);
    const littleEndian = headerView.getInt32(0, true) === 348;
    const bigEndian = headerView.getInt32(0, false) === 348;

    if (!littleEndian && !bigEndian) {
      throw new Error('Could not read the NIfTI header.');
    }

    const isLittleEndian = littleEndian;
    const dimensions = headerView.getInt16(40, isLittleEndian);
    if (dimensions < 4) {
      throw new Error('Expected a 4D diffusion NIfTI file.');
    }

    const imageDimensions: [number, number, number] = [
      headerView.getInt16(42, isLittleEndian),
      headerView.getInt16(44, isLittleEndian),
      headerView.getInt16(46, isLittleEndian),
    ];

    if (imageDimensions.some((value) => value <= 0)) {
      throw new Error('Could not determine image dimensions from the NIfTI header.');
    }

    const volumeCount = headerView.getInt16(48, isLittleEndian);
    if (volumeCount < 1) {
      throw new Error('Could not determine the number of diffusion volumes.');
    }

    const spacingX = headerView.getFloat32(80, isLittleEndian);
    const spacingY = headerView.getFloat32(84, isLittleEndian);
    const spacingZ = headerView.getFloat32(88, isLittleEndian);
    const voxelSpacing: [number, number, number] | null = [spacingX, spacingY, spacingZ].every((value) => Number.isFinite(value) && value > 0)
      ? [spacingX, spacingY, spacingZ]
      : null;

    return {
      volumeCount,
      imageDimensions,
      numberOfSlices: imageDimensions[2],
      voxelSpacing,
    };
  }

  private async readNiftiHeader(file: File): Promise<ArrayBuffer> {
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith('.gz')) {
      return await file.slice(0, 352).arrayBuffer();
    }

    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This browser cannot validate .nii.gz headers. Use .nii or run backend validation.');
    }

    const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    while (total < 352) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    await reader.cancel();

    const bytes = new Uint8Array(Math.min(total, 352));
    let offset = 0;
    for (const chunk of chunks) {
      const available = Math.min(chunk.byteLength, bytes.byteLength - offset);
      bytes.set(chunk.slice(0, available), offset);
      offset += available;
      if (offset >= bytes.byteLength) break;
    }

    return bytes.buffer;
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
    this.taskLog.update((current) => [entry, ...current].slice(0, 20));
  }

  private isNiftiFile(fileName: string): boolean {
    const normalized = fileName.toLowerCase();
    return normalized.endsWith('.nii') || normalized.endsWith('.nii.gz');
  }

  private isBvalueFile(file: File): boolean {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.bval') || lower.endsWith('.bvals')) {
      return true;
    }

    if (lower.endsWith('.txt')) {
      return true;
    }

    return file.type === 'text/plain';
  }

  private resolveFileFormat(fileName: string): string {
    return fileName.toLowerCase().endsWith('.nii.gz') ? 'NIfTI (.nii.gz)' : 'NIfTI (.nii)';
  }

  private formatDurationMinutes(durationMs: number | undefined): string | null {
    if (!Number.isFinite(durationMs) || (durationMs ?? 0) <= 0) {
      return null;
    }

    const totalSeconds = Math.max(0, Math.round((durationMs as number) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `Duration: ${minutes} min ${seconds} sec` : `Duration: ${seconds} sec`;
  }

  private formatRunStart(startIso: string | undefined): string | null {
    if (!startIso) {
      return null;
    }

    const date = new Date(startIso);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    const formatted = new Intl.DateTimeFormat('nl-NL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Europe/Amsterdam',
    }).format(date);
    return `Start time: ${formatted}`;
  }
}
