import { Injectable, inject, signal } from '@angular/core';

import { TaskLogEntry } from '../domain/qmri-evaluation.model';
import { IngestedScan, QmriInferenceResult, QmriInferenceStatus } from '../domain/qmri-inference.model';
import { QmriDataIngestService } from '../services/qmri-data-ingest.service';
import { QmriInferenceService } from '../services/qmri-inference.service';
import { IvimValidationState } from '../qmri.types';

@Injectable({ providedIn: 'root' })
export class QmriSessionStore {
  private readonly dataIngestService = inject(QmriDataIngestService);
  private readonly inferenceService = inject(QmriInferenceService);
  private currentScanFile: File | null = null;
  private currentBvalFile: File | null = null;
  private nextLogId = 1;

  readonly selectedScan = signal<IngestedScan | null>(null);
  readonly selectedBvalFileName = signal<string | null>(null);
  readonly ingestMessage = signal('Load an IVIM diffusion NIfTI file and its matching .bval file.');
  readonly validation = signal<IvimValidationState>({
    status: 'empty',
    message: 'Waiting for dataset files.'
  });
  readonly inferenceStatus = signal<QmriInferenceStatus>('idle');
  readonly inferenceResult = signal<QmriInferenceResult | null>(null);
  readonly taskLog = signal<readonly TaskLogEntry[]>([]);

  async ingestDatasetFiles(files: readonly File[]): Promise<void> {
    this.pushLog('Load dataset', 'started');
    this.inferenceResult.set(null);

    const scanFile = files.find((file) => this.isNiftiFile(file.name)) ?? null;
    const bvalFile = files.find((file) => file.name.toLowerCase().endsWith('.bval')) ?? null;

    const result = this.dataIngestService.ingest(scanFile);
    if (!result.ok || !result.scan || !scanFile) {
      this.currentScanFile = null;
      this.currentBvalFile = null;
      this.selectedScan.set(null);
      this.selectedBvalFileName.set(null);
      this.ingestMessage.set(result.message);
      this.validation.set({ status: 'invalid', message: result.message });
      this.inferenceStatus.set('error');
      this.pushLog('Load dataset', 'failed', result.message);
      return;
    }

    this.currentScanFile = scanFile;
    this.currentBvalFile = bvalFile;
    this.selectedBvalFileName.set(bvalFile?.name ?? null);
    this.selectedScan.set({
      ...result.scan,
      bvalFileName: bvalFile?.name
    });

    if (!bvalFile) {
      const message = `Loaded ${scanFile.name}. Select the matching .bval file.`;
      this.ingestMessage.set(message);
      this.validation.set({ status: 'pending', message });
      this.inferenceStatus.set('idle');
      this.pushLog('Load dataset', 'completed', message);
      return;
    }

    await this.validateCurrentDataset();
    this.pushLog('Load dataset', this.validation().status === 'valid' ? 'completed' : 'failed', this.validation().message);
  }

  async ingestScanFile(file: File | null): Promise<void> {
    await this.ingestDatasetFiles([file, this.currentBvalFile].filter((item): item is File => item !== null));
  }

  async ingestBvalFile(file: File | null): Promise<void> {
    if (!file) {
      this.currentBvalFile = null;
      this.selectedBvalFileName.set(null);
      this.validation.set({ status: 'pending', message: 'Select a .bval file.' });
      return;
    }

    if (!file.name.toLowerCase().endsWith('.bval')) {
      this.currentBvalFile = null;
      this.selectedBvalFileName.set(null);
      this.validation.set({ status: 'invalid', message: 'Unsupported b-value format. Use .bval.' });
      return;
    }

    this.currentBvalFile = file;
    this.selectedBvalFileName.set(file.name);
    await this.validateCurrentDataset();
  }

  async runInference(): Promise<void> {
    const scanFile = this.currentScanFile;
    const bvalFile = this.currentBvalFile;

    if (!scanFile || !bvalFile) {
      const message = 'Load both the NIfTI and .bval files before running IVIM-LSQ.';
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
      this.pushLog(
        'Run IVIM LSQ',
        result.status === 'success' ? 'completed' : 'failed',
        result.message,
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
      const [bvalueCount, volumeCount] = await Promise.all([
        this.readBvalueCount(bvalFile),
        this.readNiftiVolumeCount(scanFile)
      ]);

      const status = bvalueCount === volumeCount ? 'valid' : 'invalid';
      const message = status === 'valid'
        ? `Validated ${volumeCount} diffusion volumes against ${bvalueCount} b-values.`
        : `Mismatch: ${volumeCount} diffusion volumes but ${bvalueCount} b-values.`;

      this.selectedScan.update((current) => current ? {
        ...current,
        bvalFileName: bvalFile.name,
        volumeCount,
        bvalueCount
      } : current);
      this.ingestMessage.set(`Loaded ${scanFile.name} + ${bvalFile.name}.`);
      this.validation.set({ status, message, volumeCount, bvalueCount });
      this.inferenceStatus.set(status === 'valid' ? 'idle' : 'error');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not validate dataset files.';
      this.validation.set({ status: 'invalid', message });
      this.inferenceStatus.set('error');
    }
  }

  private async readBvalueCount(file: File): Promise<number> {
    const text = await file.text();
    const values = text.trim().split(/\s+/).filter(Boolean);
    if (values.length === 0) {
      throw new Error('The .bval file is empty.');
    }
    return values.length;
  }

  private async readNiftiVolumeCount(file: File): Promise<number> {
    const header = await this.readNiftiHeader(file);
    const littleEndian = new DataView(header).getInt32(0, true) === 348;
    const bigEndian = new DataView(header).getInt32(0, false) === 348;

    if (!littleEndian && !bigEndian) {
      throw new Error('Could not read the NIfTI header.');
    }

    const view = new DataView(header);
    const isLittleEndian = littleEndian;
    const dimensions = view.getInt16(40, isLittleEndian);
    if (dimensions < 4) {
      throw new Error('Expected a 4D diffusion NIfTI file.');
    }

    const volumeCount = view.getInt16(48, isLittleEndian);
    if (volumeCount < 1) {
      throw new Error('Could not determine the number of diffusion volumes.');
    }

    return volumeCount;
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
}
