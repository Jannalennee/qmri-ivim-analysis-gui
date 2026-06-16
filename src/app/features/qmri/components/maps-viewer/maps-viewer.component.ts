import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, effect, input, output, signal } from '@angular/core';
import { CommonModule, NgStyle } from '@angular/common';
import { IvimParameterMapKey, QmriInferenceResult, RoiBounds, RoiParameterStats, RoiSummary, SelectedVoxelFit, VoxelMapArrays } from '../../domain/qmri-inference.model';

const DISPLAY_MAP_KEYS: readonly IvimParameterMapKey[] = ['D', 'f', 'Dstar', 'r2', 'validMask'];

interface WindowLevel {
  window: number;
  level: number;
}

interface FitArrays {
  bvalues: readonly number[];
  signals: Float32Array;
  shape: [number, number, number, number];
}

interface DecodedMapsResult {
  arrays: VoxelMapArrays | null;
  error: string | null;
}

interface VoxelPoint {
  x: number;
  y: number;
}

interface RoiDraft {
  start: VoxelPoint;
  current: VoxelPoint;
  z: number;
}

@Component({
  selector: 'app-maps-viewer',
  standalone: true,
  imports: [CommonModule, NgStyle],
  templateUrl: './maps-viewer.component.html',
  styleUrl: './maps-viewer.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapsViewerComponent {
  readonly inferenceResult = input.required<QmriInferenceResult | null>();
  readonly currentSlice = input<number>(0);
  readonly voxelSelected = output<SelectedVoxelFit | null>();
  readonly roiSelected = output<RoiSummary | null>();

  private canvasRef?: ElementRef<HTMLCanvasElement>;

  @ViewChild('mapCanvas', { read: ElementRef })
  set mapCanvasRef(ref: ElementRef<HTMLCanvasElement> | undefined) {
    this.canvasRef = ref;
    this.renderCanvas();
  }

  protected selectedMapIndex = signal(0);
  protected currentSliceSignal = signal(0);
  protected windowLevel = signal<WindowLevel>({ window: 100, level: 50 });
  protected selectedVoxel = signal<{ x: number; y: number; z: number } | null>(null);
  protected roiDraft = signal<RoiDraft | null>(null);
  protected roiBounds = signal<RoiBounds | null>(null);
  private suppressNextClick = false;

  protected decodedMaps = computed<DecodedMapsResult>(() => {
    const result = this.inferenceResult();
    if (!result || result.status !== 'success') {
      return { arrays: null, error: null };
    }
    return this.decodeVoxelMaps(result);
  });

  protected voxelArrays = computed(() => this.decodedMaps().arrays);
  protected decodeError = computed(() => this.decodedMaps().error);

  protected fitArrays = computed(() => {
    const result = this.inferenceResult();
    if (!result?.voxelFitSupport || !result.voxelFit) return null;
    return this.decodeFitData(result);
  });

  protected mapEntries = computed(() => {
    const result = this.inferenceResult();
    if (!result || result.status !== 'success') return [];
    return DISPLAY_MAP_KEYS.map((key) => ({ key, map: result.parameterMaps[key] }));
  });

  protected maxSlice = computed(() => {
    const result = this.inferenceResult();
    return Math.max(0, (result?.metadata.numberOfSlices ?? 1) - 1);
  });

  protected selectedMap = computed(() => {
    const entries = this.mapEntries();
    if (this.selectedMapIndex() >= entries.length) {
      return null;
    }
    return entries[this.selectedMapIndex()]?.map ?? null;
  });

  protected selectedMapKey = computed(() => {
    return this.mapEntries()[this.selectedMapIndex()]?.key ?? null;
  });

  protected sliceData = computed(() => {
    const arrays = this.voxelArrays();
    const mapKey = this.selectedMapKey();
    if (!arrays || !mapKey) return null;

    const [width, height, depth] = arrays.shape;
    const slice = Math.min(this.currentSliceSignal(), Math.max(0, depth - 1));
    const array = arrays[mapKey];
    const sliceArray = new Float32Array(width * height);

    for (let yIndex = 0; yIndex < height; yIndex++) {
      for (let xIndex = 0; xIndex < width; xIndex++) {
        const sourceIndex = this.getMapIndex(xIndex, yIndex, slice, arrays.shape);
        sliceArray[yIndex * width + xIndex] = array[sourceIndex];
      }
    }

    return { data: sliceArray, shape: [width, height] as [number, number] };
  });

  protected canvasImageData = computed(() => {
    const slice = this.sliceData();
    const map = this.selectedMap();
    if (!slice || !map) return null;

    const [width, height] = slice.shape;
    const imageData = new ImageData(width, height);
    const data = imageData.data;
    const { minValue, maxValue } = this.getDisplayRange(map.minValue, map.maxValue);
    const { window, level } = this.windowLevel();
    const minVal = this.levelToValue(level - window / 2, minValue, maxValue);
    const maxVal = this.levelToValue(level + window / 2, minValue, maxValue);
    const range = maxVal - minVal || 1;

    for (let i = 0; i < slice.data.length; i++) {
      const idx = i * 4;
      const value = slice.data[i];
      if (!Number.isFinite(value)) {
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 255;
        continue;
      }

      const normalized = Math.max(0, Math.min(1, (value - minVal) / range));
      const gray = Math.round(normalized * 255);
      data[idx] = gray;
      data[idx + 1] = gray;
      data[idx + 2] = gray;
      data[idx + 3] = 255;
    }

    return imageData;
  });

  constructor() {
    effect(() => {
      const slice = Math.min(this.currentSlice(), this.maxSlice());
      this.currentSliceSignal.set(slice);
    });

    effect(() => {
      this.canvasImageData();
      this.renderCanvas();
    });
  }

  protected selectMap(index: number): void {
    if (index >= 0 && index < this.mapEntries().length) {
      this.selectedMapIndex.set(index);
      this.selectedVoxel.set(null);
      this.voxelSelected.emit(null);
    }
  }

  protected setSliceFromEvent(event: Event): void {
    this.setSlice(+(event.target as HTMLInputElement).value);
  }

  protected setWindowFromEvent(event: Event): void {
    this.setWindow(+(event.target as HTMLInputElement).value);
  }

  protected setLevelFromEvent(event: Event): void {
    this.setLevel(+(event.target as HTMLInputElement).value);
  }

  protected setSlice(value: number): void {
    this.currentSliceSignal.set(value);
    this.selectedVoxel.set(null);
    this.roiDraft.set(null);
    this.roiBounds.set(null);
    this.voxelSelected.emit(null);
    this.roiSelected.emit(null);
  }

  protected setWindow(value: number): void {
    this.windowLevel.update((current) => ({ ...current, window: value }));
  }

  protected setLevel(value: number): void {
    this.windowLevel.update((current) => ({ ...current, level: value }));
  }

  protected getMapColor(index: number): string {
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#6b7280'];
    return colors[index % colors.length];
  }

  protected isSelected(index: number): boolean {
    return index === this.selectedMapIndex();
  }

  protected selectVoxelFromCanvas(event: MouseEvent): void {
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }

    const arrays = this.voxelArrays();
    const fitArrays = this.fitArrays();
    const canvas = this.canvasRef?.nativeElement;
    if (!arrays || !fitArrays || !canvas) {
      return;
    }

    const point = this.eventToVoxelPoint(event, canvas, arrays.shape);
    const x = point.x;
    const y = point.y;
    const z = this.currentSliceSignal();
    const selection = this.buildVoxelSelection(x, y, z, arrays, fitArrays);

    if (!selection) {
      this.selectedVoxel.set(null);
      this.voxelSelected.emit(null);
      return;
    }

    this.selectedVoxel.set({ x, y, z });
    this.voxelSelected.emit(selection);
  }

  protected startRoi(event: PointerEvent): void {
    const arrays = this.voxelArrays();
    const canvas = this.canvasRef?.nativeElement;
    if (!arrays || !canvas || event.button !== 0) {
      return;
    }

    canvas.setPointerCapture(event.pointerId);
    const point = this.eventToVoxelPoint(event, canvas, arrays.shape);
    this.roiDraft.set({ start: point, current: point, z: this.currentSliceSignal() });
    this.roiBounds.set(null);
    this.roiSelected.emit(null);
  }

  protected updateRoi(event: PointerEvent): void {
    const arrays = this.voxelArrays();
    const canvas = this.canvasRef?.nativeElement;
    const draft = this.roiDraft();
    if (!arrays || !canvas || !draft) {
      return;
    }

    this.roiDraft.set({
      ...draft,
      current: this.eventToVoxelPoint(event, canvas, arrays.shape),
    });
  }

  protected finishRoi(event: PointerEvent): void {
    const arrays = this.voxelArrays();
    const canvas = this.canvasRef?.nativeElement;
    const draft = this.roiDraft();
    if (!arrays || !canvas || !draft) {
      return;
    }

    canvas.releasePointerCapture(event.pointerId);
    const current = this.eventToVoxelPoint(event, canvas, arrays.shape);
    const bounds = this.normalizeRoiBounds(draft.start, current, draft.z);
    this.roiDraft.set(null);

    if (bounds.xStart === bounds.xEnd && bounds.yStart === bounds.yEnd) {
      this.roiBounds.set(null);
      this.roiSelected.emit(null);
      return;
    }

    this.suppressNextClick = true;
    this.roiBounds.set(bounds);
    this.roiSelected.emit(this.buildRoiSummary(bounds, arrays));
  }

  protected cancelRoi(event: PointerEvent): void {
    const canvas = this.canvasRef?.nativeElement;
    if (canvas?.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    this.roiDraft.set(null);
  }

  protected roiOverlayStyle(): Record<string, string> | null {
    const arrays = this.voxelArrays();
    const canvas = this.canvasRef?.nativeElement;
    if (!arrays || !canvas) return null;

    const draft = this.roiDraft();
    const bounds = this.roiBounds();
    const normalized = draft
      ? this.normalizeRoiBounds(draft.start, draft.current, draft.z)
      : bounds;
    if (!normalized) return null;

    const rect = canvas.getBoundingClientRect();
    const [width, height] = arrays.shape;
    return {
      left: `${(normalized.xStart / width) * rect.width}px`,
      top: `${(normalized.yStart / height) * rect.height}px`,
      width: `${((normalized.xEnd - normalized.xStart + 1) / width) * rect.width}px`,
      height: `${((normalized.yEnd - normalized.yStart + 1) / height) * rect.height}px`,
    };
  }

  private decodeVoxelMaps(result: QmriInferenceResult): DecodedMapsResult {
    try {
      const expectedLength = result.metadata.imageShape.reduce((total, value) => total * value, 1);
      const arrays: VoxelMapArrays = {
        D: new Float32Array(this.base64ToArrayBuffer(result.parameterMaps.D.data)),
        f: new Float32Array(this.base64ToArrayBuffer(result.parameterMaps.f.data)),
        Dstar: new Float32Array(this.base64ToArrayBuffer(result.parameterMaps.Dstar.data)),
        r2: new Float32Array(this.base64ToArrayBuffer(result.parameterMaps.r2.data)),
        validMask: new Float32Array(this.base64ToArrayBuffer(result.parameterMaps.validMask.data)),
        shape: result.metadata.imageShape,
      };

      for (const key of DISPLAY_MAP_KEYS) {
        if (arrays[key].length !== expectedLength) {
          const message = `Decoded ${key} map has ${arrays[key].length} voxels, expected ${expectedLength}.`;
          console.error(message, { metadata: result.metadata, map: result.parameterMaps[key] });
          return { arrays: null, error: message };
        }
      }

      return { arrays, error: null };
    } catch (error) {
      const message = error instanceof Error
        ? `Could not decode parameter map voxel data: ${error.message}`
        : 'Could not decode parameter map voxel data.';
      console.error(message, error);
      return { arrays: null, error: message };
    }
  }

  private decodeFitData(result: QmriInferenceResult): FitArrays | null {
    try {
      return {
        bvalues: result.metadata.bValues,
        signals: new Float32Array(this.base64ToArrayBuffer(result.voxelFit?.signals ?? '')),
        shape: result.voxelFit?.shape ?? [0, 0, 0, 0],
      };
    } catch (error) {
      console.error('Could not decode voxel fit signal data.', error);
      return null;
    }
  }

  private buildVoxelSelection(
    x: number,
    y: number,
    z: number,
    arrays: VoxelMapArrays,
    fitArrays: FitArrays,
  ): SelectedVoxelFit | null {
    const [width, height, depth] = arrays.shape;
    if (x < 0 || y < 0 || z < 0 || x >= width || y >= height || z >= depth) {
      return null;
    }

    const mapIndex = this.getMapIndex(x, y, z, arrays.shape);
    const D = arrays.D[mapIndex];
    const f = arrays.f[mapIndex];
    const Dstar = arrays.Dstar[mapIndex];
    const r2 = arrays.r2[mapIndex];
    if (![D, f, Dstar, r2].every((value) => Number.isFinite(value))) {
      return null;
    }

    const measured = fitArrays.bvalues.map((_, bIndex) => {
      const signalIndex = this.getSignalIndex(x, y, z, bIndex, fitArrays.shape);
      return fitArrays.signals[signalIndex];
    });
    if (!measured.some((value) => Number.isFinite(value))) {
      return null;
    }

    const fitted = fitArrays.bvalues.map((bvalue) =>
      f * Math.exp(-bvalue * Dstar) + (1 - f) * Math.exp(-bvalue * D)
    );
    const finiteResiduals = measured
      .map((value, index) => value - fitted[index])
      .filter((value) => Number.isFinite(value));
    const residualRmse = finiteResiduals.length
      ? Math.sqrt(finiteResiduals.reduce((sum, value) => sum + value * value, 0) / finiteResiduals.length)
      : 0;

    return { x, y, z, D, f, Dstar, r2, residualRmse, bvalues: fitArrays.bvalues, measured, fitted };
  }

  private buildRoiSummary(bounds: RoiBounds, arrays: VoxelMapArrays): RoiSummary {
    const dValues: number[] = [];
    const fValues: number[] = [];
    const dstarValues: number[] = [];
    const r2Values: number[] = [];

    for (let y = bounds.yStart; y <= bounds.yEnd; y++) {
      for (let x = bounds.xStart; x <= bounds.xEnd; x++) {
        const index = this.getMapIndex(x, y, bounds.z, arrays.shape);
        if (arrays.validMask[index] <= 0) {
          continue;
        }

        this.pushFinite(dValues, arrays.D[index]);
        this.pushFinite(fValues, arrays.f[index]);
        this.pushFinite(dstarValues, arrays.Dstar[index]);
        this.pushFinite(r2Values, arrays.r2[index]);
      }
    }

    return {
      bounds,
      D: this.calculateStats(dValues),
      f: this.calculateStats(fValues),
      Dstar: this.calculateStats(dstarValues),
      validVoxelCount: dValues.length,
      meanAdjustedR2: this.calculateStats(r2Values).mean,
    };
  }

  private calculateStats(values: readonly number[]): RoiParameterStats {
    if (values.length === 0) {
      return { mean: 0, median: 0, standardDeviation: 0 };
    }

    const sorted = [...values].sort((left, right) => left - right);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;

    return { mean, median, standardDeviation: Math.sqrt(variance) };
  }

  private pushFinite(target: number[], value: number): void {
    if (Number.isFinite(value)) {
      target.push(value);
    }
  }

  private eventToVoxelPoint(event: MouseEvent | PointerEvent, canvas: HTMLCanvasElement, shape: [number, number, number]): VoxelPoint {
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(shape[0] - 1, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * shape[0])));
    const y = Math.min(shape[1] - 1, Math.max(0, Math.floor(((event.clientY - rect.top) / rect.height) * shape[1])));
    return { x, y };
  }

  private normalizeRoiBounds(start: VoxelPoint, end: VoxelPoint, z: number): RoiBounds {
    return {
      xStart: Math.min(start.x, end.x),
      yStart: Math.min(start.y, end.y),
      xEnd: Math.max(start.x, end.x),
      yEnd: Math.max(start.y, end.y),
      z,
    };
  }

  private getMapIndex(x: number, y: number, z: number, shape: [number, number, number]): number {
    return x * shape[1] * shape[2] + y * shape[2] + z;
  }

  private getSignalIndex(x: number, y: number, z: number, b: number, shape: [number, number, number, number]): number {
    return ((x * shape[1] + y) * shape[2] + z) * shape[3] + b;
  }

  private renderCanvas(): void {
    const imageData = this.canvasImageData();
    const canvas = this.canvasRef?.nativeElement;
    if (!imageData || !canvas) {
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      console.error('Could not render parameter map: 2D canvas context is unavailable.');
      return;
    }

    context.putImageData(imageData, 0, 0);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  private getDisplayRange(minValue: number, maxValue: number): { minValue: number; maxValue: number } {
    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || minValue === maxValue) {
      return { minValue: 0, maxValue: 1 };
    }
    return { minValue, maxValue };
  }

  private levelToValue(level: number, min: number, max: number): number {
    return min + (level / 100) * (max - min);
  }
}
