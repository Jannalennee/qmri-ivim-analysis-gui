import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, effect, input, output, signal } from '@angular/core';
import { CommonModule, NgStyle } from '@angular/common';

import {
  IvimParameterMap,
  IvimParameterMapKey,
  QmriInferenceResult,
  RoiBounds,
  RoiSummary,
  SelectedVoxelFit,
  VoxelMapArrays,
} from '../../domain/qmri-inference.model';
import { DiffusionPreviewDataset, ViewerState } from '../../qmri.types';
import { formatPercent, formatSummaryNumber } from '../../utils/number-format.util';

type BackgroundMode = 'volume' | 'mean';
type WindowLevelTarget = 'background' | 'map';

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

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface RoiDraft {
  start: VoxelPoint;
  current: VoxelPoint;
  z: number;
}

interface SliceGrayImage {
  values: Float32Array;
  width: number;
  height: number;
}

@Component({
  selector: 'app-maps-viewer',
  imports: [CommonModule, NgStyle],
  templateUrl: './maps-viewer.component.html',
  styleUrl: './maps-viewer.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapsViewerComponent {
  readonly inferenceResult = input.required<QmriInferenceResult | null>();
  readonly previewDataset = input<DiffusionPreviewDataset | null>(null);
  readonly currentSlice = input<number>(0);
  readonly roiTool = input<'voxel' | 'rectangle' | 'polygon'>('voxel');
  readonly clearSelectionNonce = input<number>(0);
  readonly finishRoiNonce = input<number>(0);

  readonly sliceChanged = output<number>();
  readonly voxelSelected = output<SelectedVoxelFit | null>();
  readonly roiSelected = output<RoiSummary | null>();
  readonly viewerStateChanged = output<ViewerState>();

  private canvasRef?: ElementRef<HTMLCanvasElement>;
  private backgroundCanvasRef?: ElementRef<HTMLCanvasElement>;
  private viewportRef?: ElementRef<HTMLDivElement>;
  private readonly hasManualZoom = signal(false);
  private lastFinishNonce = 0;

  @ViewChild('overlayCanvas', { read: ElementRef })
  set overlayCanvasRef(ref: ElementRef<HTMLCanvasElement> | undefined) {
    this.canvasRef = ref;
    this.renderOverlayCanvas();
  }

  @ViewChild('backgroundCanvas', { read: ElementRef })
  set backgroundCanvasElementRef(ref: ElementRef<HTMLCanvasElement> | undefined) {
    this.backgroundCanvasRef = ref;
    this.renderBackgroundCanvas();
  }

  @ViewChild('viewport', { read: ElementRef })
  set viewportElementRef(ref: ElementRef<HTMLDivElement> | undefined) {
    this.viewportRef = ref;
    this.applyFitToWidthZoom();
  }

  protected readonly mapKeys: readonly IvimParameterMapKey[] = ['D', 'f', 'Dstar', 'r2', 'validMask'];
  protected readonly selectedMapIndex = signal(0);
  protected readonly currentSliceSignal = signal(0);
  protected readonly currentVolumeSignal = signal(0);
  protected readonly backgroundMode = signal<BackgroundMode>('volume');
  protected readonly windowLevelTarget = signal<WindowLevelTarget>('map');
  protected readonly mapWindowLevel = signal<WindowLevel>({ window: 100, level: 50 });
  protected readonly backgroundWindowLevel = signal<WindowLevel>({ window: 100, level: 50 });
  protected readonly zoomPercent = signal(100);
  protected readonly mapOpacity = signal(70);
  protected readonly panOffset = signal({ x: 0, y: 0 });
  protected readonly showValidMaskVoxels = signal(true);
  protected readonly showInvalidMaskVoxels = signal(true);
  protected readonly showMaskOutline = signal(false);
  protected readonly selectedVoxel = signal<{ x: number; y: number; z: number } | null>(null);
  protected readonly roiDraft = signal<RoiDraft | null>(null);
  protected readonly roiBounds = signal<RoiBounds | null>(null);
  protected readonly polygonPoints = signal<readonly VoxelPoint[]>([]);
  protected readonly polygonClosed = signal(false);

  private suppressNextClick = false;
  protected readonly hasInferenceResult = computed(() => {
    const result = this.inferenceResult();
    return !!result && result.status === 'success';
  });

  protected readonly decodedMaps = computed<DecodedMapsResult>(() => {
    const result = this.inferenceResult();
    if (!result || result.status !== 'success') {
      return { arrays: null, error: null };
    }
    return this.decodeVoxelMaps(result);
  });

  protected readonly voxelArrays = computed(() => this.decodedMaps().arrays);
  protected readonly decodeError = computed(() => this.decodedMaps().error);

  protected readonly fitArrays = computed(() => {
    const result = this.inferenceResult();
    if (!result?.voxelFitSupport || !result.voxelFit) {
      return null;
    }

    return {
      bvalues: result.metadata.bValues,
      signals: new Float32Array(this.base64ToArrayBuffer(result.voxelFit.signals)),
      shape: [
        result.voxelFit.shape[0],
        result.voxelFit.shape[1],
        result.voxelFit.shape[2],
        result.voxelFit.shape[3],
      ],
    } satisfies FitArrays;
  });

  protected readonly mapEntries = computed(() => {
    const result = this.inferenceResult();
    if (!result || result.status !== 'success') {
      return [];
    }

    return this.mapKeys.map((key) => ({ key, map: result.parameterMaps[key] }));
  });

  protected readonly selectedMapEntry = computed(() => {
    const entries = this.mapEntries();
    if (!entries.length) {
      return null;
    }

    const index = Math.min(this.selectedMapIndex(), entries.length - 1);
    return entries[index] ?? null;
  });

  protected readonly maxSlice = computed(() => {
    if (this.hasInferenceResult()) {
      const result = this.inferenceResult();
      return Math.max(0, (result?.metadata.numberOfSlices ?? 1) - 1);
    }

    const preview = this.previewDataset();
    return preview ? Math.max(0, preview.shape[2] - 1) : 0;
  });

  protected readonly maxVolume = computed(() => {
    if (this.hasInferenceResult()) {
      const fit = this.fitArrays();
      return fit ? Math.max(0, fit.shape[3] - 1) : 0;
    }

    const preview = this.previewDataset();
    return preview ? Math.max(0, preview.shape[3] - 1) : 0;
  });

  protected readonly backgroundSelectionLabel = computed(() => {
    const mode = this.backgroundMode();
    const volume = this.currentVolumeSignal();
    const bvalue = this.currentBvalueLabel();

    if (mode === 'volume' && this.inferenceResult()?.referenceImage) {
      return 'Reference MRI image';
    }

    if (mode === 'mean') {
      return 'Mean diffusion image';
    }

    return `Diffusion volume ${volume} (b=${bvalue})`;
  });

  protected readonly currentBvalueLabel = computed(() => {
    const bvalues = this.currentBvalues();
    const index = this.currentVolumeSignal();
    if (!bvalues.length || index < 0 || index >= bvalues.length) {
      return 'n/a';
    }
    return String(bvalues[index]);
  });

  protected readonly currentBvalues = computed(() => {
    if (this.hasInferenceResult()) {
      return this.inferenceResult()?.metadata.bValues ?? [];
    }
    return this.previewDataset()?.bvalues ?? [];
  });

  protected readonly uniqueBvalueSummary = computed(() => {
    const values = this.currentBvalues();
    const unique = Array.from(new Set(values));
    return `${unique.length} unique b-values across ${values.length} volumes`;
  });

  protected readonly backgroundSlice = computed<SliceGrayImage | null>(() => {
    if (this.hasInferenceResult()) {
      return this.buildInferenceBackgroundSlice();
    }

    const preview = this.previewDataset();
    if (!preview) {
      return null;
    }

    const z = Math.min(this.currentSliceSignal(), preview.shape[2] - 1);
    const volume = Math.min(this.currentVolumeSignal(), preview.shape[3] - 1);
    const [width, height] = preview.shape;
    const values = new Float32Array(width * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const sourceIndex = this.getPreviewSignalIndex(x, y, z, volume, preview.shape);
        values[y * width + x] = preview.values[sourceIndex];
      }
    }

    return { values, width, height };
  });

  protected readonly overlaySlice = computed<SliceGrayImage | null>(() => {
    const arrays = this.voxelArrays();
    const selected = this.selectedMapEntry();
    if (!arrays || !selected) {
      return null;
    }

    const [width, height, depth] = arrays.shape;
    const z = Math.min(this.currentSliceSignal(), depth - 1);
    const values = new Float32Array(width * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const sourceIndex = this.getMapIndex(x, y, z, arrays.shape);
        values[y * width + x] = arrays[selected.key][sourceIndex];
      }
    }

    return { values, width, height };
  });

  protected readonly backgroundImageData = computed(() => {
    const source = this.backgroundSlice();
    if (!source) {
      return null;
    }

    const range = this.resolveDisplayRange(source.values, this.backgroundWindowLevel());
    const image = new ImageData(source.width, source.height);

    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        const sourceX = source.width - 1 - x;
        const sourceY = source.height - 1 - y;
        const value = source.values[sourceY * source.width + sourceX];
        const normalized = Number.isFinite(value)
          ? Math.max(0, Math.min(1, (value - range.min) / range.delta))
          : 0;
        const pixel = Math.round(normalized * 255);
        const outIndex = (y * source.width + x) * 4;
        image.data[outIndex] = pixel;
        image.data[outIndex + 1] = pixel;
        image.data[outIndex + 2] = pixel;
        image.data[outIndex + 3] = 255;
      }
    }

    return image;
  });

  protected readonly overlayImageData = computed(() => {
    const source = this.overlaySlice();
    const selected = this.selectedMapEntry();
    if (!source || !selected) {
      return null;
    }

    const image = new ImageData(source.width, source.height);

    if (selected.key === 'validMask') {
      return this.buildMaskOverlay(source, image);
    }

    const range = this.resolveDisplayRange(source.values, this.mapWindowLevel());
    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        const sourceX = source.width - 1 - x;
        const sourceY = source.height - 1 - y;
        const value = source.values[sourceY * source.width + sourceX];
        const outIndex = (y * source.width + x) * 4;
        if (!Number.isFinite(value)) {
          image.data[outIndex + 3] = 0;
          continue;
        }

        const normalized = Math.max(0, Math.min(1, (value - range.min) / range.delta));
        const color = this.applyColorMap(normalized);
        image.data[outIndex] = color.r;
        image.data[outIndex + 1] = color.g;
        image.data[outIndex + 2] = color.b;
        image.data[outIndex + 3] = 255;
      }
    }

    return image;
  });

  protected readonly maskSummaryLabel = computed(() => {
    if (this.selectedMapEntry()?.key !== 'validMask') {
      return null;
    }

    const slice = this.overlaySlice();
    if (!slice) {
      return null;
    }

    let valid = 0;
    let invalid = 0;
    for (const value of slice.values) {
      if (!Number.isFinite(value)) {
        continue;
      }
      if (value > 0) {
        valid += 1;
      } else {
        invalid += 1;
      }
    }

    const total = valid + invalid;
    const validPercentage = total ? (valid / total) * 100 : 0;
    const invalidPercentage = total ? (invalid / total) * 100 : 0;

    return {
      valid,
      invalid,
      total,
      validPercentage: formatPercent(validPercentage, 1),
      invalidPercentage: formatPercent(invalidPercentage, 1),
    };
  });

  protected readonly zoomedCanvasWidth = computed(() => {
    const image = this.backgroundImageData();
    return image ? Math.round(image.width * (this.zoomPercent() / 100)) : 0;
  });

  protected readonly zoomedCanvasHeight = computed(() => {
    const image = this.backgroundImageData();
    return image ? Math.round(image.height * (this.zoomPercent() / 100)) : 0;
  });

  protected readonly mapStats = computed(() => {
    const selected = this.selectedMapEntry();
    if (!selected) {
      return null;
    }

    const map = selected.map;
    return {
      name: map.displayName,
      unit: map.unit,
      min: formatSummaryNumber(map.minValue, { decimals: 3 }),
      max: formatSummaryNumber(map.maxValue, { decimals: 3 }),
      mean: selected.key === 'validMask' ? 'Not available' : formatSummaryNumber(map.meanValue, { decimals: 3 }),
      minRaw: map.minValue,
      maxRaw: map.maxValue,
      meanRaw: map.meanValue,
    };
  });

  protected readonly showContinuousLegend = computed(() => {
    return this.hasInferenceResult() && this.selectedMapEntry()?.key !== 'validMask';
  });

  protected readonly legendLabels = computed(() => {
    const selected = this.selectedMapEntry();
    if (!selected || selected.key === 'validMask') {
      return { low: '0.000', mid: '0.500', high: '1.000' };
    }

    const values = this.overlaySlice()?.values;
    if (!values) {
      return { low: '0.000', mid: '0.500', high: '1.000' };
    }

    const range = this.resolveDisplayRange(values, this.mapWindowLevel());
    return {
      low: formatSummaryNumber(range.min, { decimals: 3 }),
      mid: formatSummaryNumber((range.min + range.max) / 2, { decimals: 3 }),
      high: formatSummaryNumber(range.max, { decimals: 3 }),
    };
  });

  protected readonly zoomLabel = computed(() => `${this.zoomPercent()}%`);
  protected readonly opacityLabel = computed(() => `${this.mapOpacity()}%`);
  protected readonly windowLabel = computed(() => {
    const value = this.windowLevelTarget() === 'map' ? this.mapWindowLevel().window : this.backgroundWindowLevel().window;
    return String(value);
  });
  protected readonly levelLabel = computed(() => {
    const value = this.windowLevelTarget() === 'map' ? this.mapWindowLevel().level : this.backgroundWindowLevel().level;
    return String(value);
  });

  protected readonly showWindowLevelControls = computed(() => {
    if (!this.hasInferenceResult()) {
      return true;
    }

    if (this.selectedMapEntry()?.key === 'validMask') {
      return this.windowLevelTarget() === 'background';
    }

    return true;
  });

  protected readonly selectedVoxelStyle = computed<Record<string, string> | null>(() => {
    const voxel = this.selectedVoxel();
    const image = this.backgroundImageData();
    if (!voxel || !image) {
      return null;
    }

    const displayPoint = this.dataToDisplayPoint(voxel, image.width, image.height);

    return {
      left: `${((displayPoint.x + 0.5) / image.width) * 100}%`,
      top: `${((displayPoint.y + 0.5) / image.height) * 100}%`,
    };
  });

  protected readonly roiOverlayStyle = computed<Record<string, string> | null>(() => {
    const image = this.backgroundImageData();
    if (!image) {
      return null;
    }

    const draft = this.roiDraft();
    const bounds = this.roiBounds();
    const normalized = draft
      ? this.normalizeRoiBounds(draft.start, draft.current, draft.z)
      : bounds;

    if (!normalized) {
      return null;
    }

    const displayStart = this.dataToDisplayPoint({ x: normalized.xStart, y: normalized.yStart }, image.width, image.height);
    const displayEnd = this.dataToDisplayPoint({ x: normalized.xEnd, y: normalized.yEnd }, image.width, image.height);
    const xStart = Math.min(displayStart.x, displayEnd.x);
    const xEnd = Math.max(displayStart.x, displayEnd.x);
    const yStart = Math.min(displayStart.y, displayEnd.y);
    const yEnd = Math.max(displayStart.y, displayEnd.y);

    return {
      left: `${(xStart / image.width) * 100}%`,
      top: `${(yStart / image.height) * 100}%`,
      width: `${((xEnd - xStart + 1) / image.width) * 100}%`,
      height: `${((yEnd - yStart + 1) / image.height) * 100}%`,
    };
  });

  protected readonly polygonPath = computed(() => {
    const points = this.polygonPoints();
    const image = this.backgroundImageData();
    if (!points.length || !image) {
      return null;
    }

    const segments = points
      .map((point, index) => {
        const displayPoint = this.dataToDisplayPoint(point, image.width, image.height);
        return `${index === 0 ? 'M' : 'L'} ${((displayPoint.x / image.width) * 100).toFixed(3)} ${((displayPoint.y / image.height) * 100).toFixed(3)}`;
      })
      .join(' ');

    return this.polygonClosed() ? `${segments} Z` : segments;
  });

  protected readonly polygonDisplayPoints = computed(() => {
    const image = this.backgroundImageData();
    if (!image) {
      return [];
    }

    return this.polygonPoints().map((point, index) => {
      const displayPoint = this.dataToDisplayPoint(point, image.width, image.height);
      return {
        id: `${index}-${point.x}-${point.y}`,
        left: `${((displayPoint.x + 0.5) / image.width) * 100}%`,
        top: `${((displayPoint.y + 0.5) / image.height) * 100}%`,
      };
    });
  });

  constructor() {
    effect(() => {
      const slice = Math.min(this.currentSlice(), this.maxSlice());
      this.currentSliceSignal.set(slice);
    });

    effect(() => {
      const max = this.maxVolume();
      this.currentVolumeSignal.update((value) => Math.min(Math.max(0, value), max));
    });

    effect(() => {
      this.backgroundImageData();
      this.renderBackgroundCanvas();
      if (!this.hasManualZoom()) {
        this.applyFitToWidthZoom();
      }
    });

    effect(() => {
      this.overlayImageData();
      this.renderOverlayCanvas();
    });

    effect(() => {
      this.clearSelectionNonce();
      this.clearSelection();
    });

    effect(() => {
      const nonce = this.finishRoiNonce();
      if (nonce !== this.lastFinishNonce) {
        this.lastFinishNonce = nonce;
        if (this.roiTool() === 'polygon') {
          this.finishPolygonRoi();
        }
      }
    });

    effect(() => {
      this.viewerStateChanged.emit({
        selectedMap: this.selectedMapEntry()?.key ?? null,
        selectedBackgroundMode: this.backgroundMode(),
        selectedBackgroundVolumeIndex: this.currentVolumeSignal(),
        currentSlice: this.currentSliceSignal(),
        currentVolumeIndex: this.currentVolumeSignal(),
        zoomPercent: this.zoomPercent(),
        panX: this.panOffset().x,
        panY: this.panOffset().y,
        window: this.activeWindowLevel().window,
        level: this.activeWindowLevel().level,
        overlayOpacityPercent: this.mapOpacity(),
        roiTool: this.roiTool(),
      });
    });
  }

  protected selectMap(index: number): void {
    if (index >= 0 && index < this.mapEntries().length) {
      this.selectedMapIndex.set(index);
      if (this.selectedMapEntry()?.key === 'validMask') {
        this.windowLevelTarget.set('background');
      }
      this.clearSelection();
    }
  }

  protected setSliceFromEvent(event: Event): void {
    const next = Number((event.target as HTMLInputElement).value);
    this.setSlice(next);
  }

  protected setVolumeFromEvent(event: Event): void {
    const next = Number((event.target as HTMLInputElement).value);
    this.currentVolumeSignal.set(Math.max(0, Math.min(this.maxVolume(), next)));
  }

  protected setSlice(value: number): void {
    const next = Math.min(this.maxSlice(), Math.max(0, Math.round(value)));
    this.currentSliceSignal.set(next);
    this.sliceChanged.emit(next);
    this.clearSelection();
  }

  protected incrementSlice(): void {
    this.setSlice(this.currentSliceSignal() + 1);
  }

  protected decrementSlice(): void {
    this.setSlice(this.currentSliceSignal() - 1);
  }

  protected setZoomFromEvent(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.setZoom(value);
  }

  protected setZoom(value: number): void {
    const next = Math.min(500, Math.max(100, Math.round(value)));
    this.hasManualZoom.set(true);
    this.zoomPercent.set(next);
  }

  protected resetView(): void {
    this.hasManualZoom.set(false);
    this.applyFitToWidthZoom();
    this.panOffset.set({ x: 0, y: 0 });
  }

  protected setOpacityFromEvent(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.mapOpacity.set(Math.min(100, Math.max(0, Math.round(value))));
  }

  protected setWindowFromEvent(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.updateWindowLevel('window', value);
  }

  protected setLevelFromEvent(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.updateWindowLevel('level', value);
  }

  protected setBackgroundMode(mode: BackgroundMode): void {
    this.backgroundMode.set(mode);
  }

  protected setWindowLevelTarget(target: WindowLevelTarget): void {
    this.windowLevelTarget.set(target);
  }

  protected applyAutoWindowLevel(): void {
    const source = this.windowLevelTarget() === 'map' ? this.overlaySlice() : this.backgroundSlice();
    if (!source) {
      return;
    }

    const sorted = Array.from(source.values).filter(Number.isFinite).sort((left, right) => left - right);
    if (!sorted.length) {
      return;
    }

    const low = sorted[Math.floor(sorted.length * 0.02)] ?? sorted[0];
    const high = sorted[Math.floor(sorted.length * 0.98)] ?? sorted[sorted.length - 1];
    const min = Number.isFinite(low) ? low : 0;
    const max = Number.isFinite(high) ? high : 1;
    const delta = Math.max(1e-9, max - min);

    const level = ((min + max) / 2 - min) / delta * 100;
    const window = 100;

    if (this.windowLevelTarget() === 'map') {
      this.mapWindowLevel.set({ window, level: Math.max(0, Math.min(100, level)) });
      return;
    }

    this.backgroundWindowLevel.set({ window, level: Math.max(0, Math.min(100, level)) });
  }

  protected onCanvasWheel(event: WheelEvent): void {
    event.preventDefault();
    if (event.shiftKey) {
      this.setSlice(this.currentSliceSignal() + (event.deltaY > 0 ? 1 : -1));
    }
  }

  protected onPointerDown(event: PointerEvent): void {
    const image = this.backgroundImageData();
    const canvas = this.canvasRef?.nativeElement;
    if (!image || !canvas) {
      return;
    }

    if (this.roiTool() === 'rectangle') {
      canvas.setPointerCapture(event.pointerId);
      const point = this.displayToDataPoint(
        this.eventToVoxelPoint(event, canvas, image.width, image.height),
        image.width,
        image.height,
      );
      this.roiDraft.set({ start: point, current: point, z: this.currentSliceSignal() });
      this.roiBounds.set(null);
      return;
    }

    if (this.roiTool() === 'polygon') {
      const point = this.displayToDataPoint(
        this.eventToVoxelPoint(event, canvas, image.width, image.height),
        image.width,
        image.height,
      );
      this.polygonClosed.set(false);
      this.polygonPoints.set([...this.polygonPoints(), point]);
      return;
    }
  }

  protected onPointerMove(event: PointerEvent): void {
    const image = this.backgroundImageData();
    const canvas = this.canvasRef?.nativeElement;
    if (!image || !canvas) {
      return;
    }

    if (this.roiTool() === 'rectangle' && this.roiDraft()) {
      const draft = this.roiDraft();
      if (!draft) {
        return;
      }

      this.roiDraft.set({
        ...draft,
        current: this.displayToDataPoint(
          this.eventToVoxelPoint(event, canvas, image.width, image.height),
          image.width,
          image.height,
        ),
      });
      return;
    }
  }

  protected onPointerUp(event: PointerEvent): void {
    const image = this.backgroundImageData();
    const canvas = this.canvasRef?.nativeElement;
    if (!image || !canvas) {
      return;
    }

    if (this.roiTool() === 'rectangle' && this.roiDraft()) {
      canvas.releasePointerCapture(event.pointerId);
      const draft = this.roiDraft();
      if (draft) {
        const current = this.displayToDataPoint(
          this.eventToVoxelPoint(event, canvas, image.width, image.height),
          image.width,
          image.height,
        );
        this.roiDraft.set(null);
        if (this.distance(draft.start, current) > 1) {
          const bounds = this.normalizeRoiBounds(draft.start, current, draft.z);
          this.roiBounds.set(bounds);
          this.emitRectangleRoiSummary(bounds);
          this.suppressNextClick = true;
        }
      }
    }
  }

  protected selectVoxelFromCanvas(event: MouseEvent): void {
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }

    if (this.roiTool() === 'polygon') {
      return;
    }

    const arrays = this.voxelArrays();
    const fit = this.fitArrays();
    const image = this.backgroundImageData();
    const canvas = this.canvasRef?.nativeElement;
    if (!arrays || !fit || !image || !canvas) {
      return;
    }

    const point = this.displayToDataPoint(
      this.eventToVoxelPoint(event, canvas, image.width, image.height),
      image.width,
      image.height,
    );
    const selection = this.buildVoxelSelection(point.x, point.y, this.currentSliceSignal(), arrays, fit);

    if (!selection) {
      this.selectedVoxel.set(null);
      this.voxelSelected.emit(null);
      return;
    }

    this.selectedVoxel.set({ x: point.x, y: point.y, z: this.currentSliceSignal() });
    this.voxelSelected.emit(selection);
  }

  protected finishPolygonRoi(): void {
    const points = this.polygonPoints();
    if (points.length < 3) {
      return;
    }

    this.polygonClosed.set(true);
    const summary = this.buildPolygonRoiSummary(points, this.currentSliceSignal());
    this.roiSelected.emit(summary);
    this.roiBounds.set(null);
  }

  protected clearSelection(): void {
    this.selectedVoxel.set(null);
    this.roiDraft.set(null);
    this.roiBounds.set(null);
    this.polygonPoints.set([]);
    this.polygonClosed.set(false);
    this.voxelSelected.emit(null);
    this.roiSelected.emit(null);
  }

  protected toggleMaskValid(): void {
    this.showValidMaskVoxels.update((value) => !value);
  }

  protected toggleMaskInvalid(): void {
    this.showInvalidMaskVoxels.update((value) => !value);
  }

  protected toggleMaskOutline(): void {
    this.showMaskOutline.update((value) => !value);
  }

  private activeWindowLevel(): WindowLevel {
    return this.windowLevelTarget() === 'map' ? this.mapWindowLevel() : this.backgroundWindowLevel();
  }

  private updateWindowLevel(field: 'window' | 'level', value: number): void {
    const clamped = field === 'window'
      ? Math.max(1, Math.min(200, Math.round(value)))
      : Math.max(0, Math.min(100, Math.round(value)));

    if (this.windowLevelTarget() === 'map') {
      this.mapWindowLevel.update((current) => ({ ...current, [field]: clamped }));
      return;
    }

    this.backgroundWindowLevel.update((current) => ({ ...current, [field]: clamped }));
  }

  private buildInferenceBackgroundSlice(): SliceGrayImage | null {
    const result = this.inferenceResult();
    if (result?.status === 'success' && result.referenceImage && this.backgroundMode() === 'volume') {
      const [width, height, depth] = result.metadata.imageShape;
      const z = Math.min(this.currentSliceSignal(), depth - 1);
      const decodedArray = new Float32Array(this.base64ToArrayBuffer(result.referenceImage.data));
      const sliceSize = width * height;
      const sliceOffset = z * sliceSize;
      if (decodedArray.length >= sliceOffset + sliceSize) {
        return {
          values: decodedArray.slice(sliceOffset, sliceOffset + sliceSize),
          width,
          height,
        };
      }
    }

    const fit = this.fitArrays();
    if (!fit) {
      return null;
    }

    const [width, height, depth, bCount] = fit.shape;
    const z = Math.min(this.currentSliceSignal(), depth - 1);

    if (width <= 0 || height <= 0 || depth <= 0 || bCount <= 0) {
      return null;
    }

    const values = new Float32Array(width * height);
    const volumeIndex = Math.min(this.currentVolumeSignal(), bCount - 1);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (this.backgroundMode() === 'mean') {
          let sum = 0;
          let count = 0;
          for (let b = 0; b < bCount; b++) {
            const v = fit.signals[this.getSignalIndex(x, y, z, b, fit.shape)];
            if (Number.isFinite(v)) {
              sum += v;
              count += 1;
            }
          }
          values[y * width + x] = count ? sum / count : 0;
        } else {
          const idx = this.getSignalIndex(x, y, z, volumeIndex, fit.shape);
          values[y * width + x] = fit.signals[idx];
        }
      }
    }

    return { values, width, height };
  }

  private buildMaskOverlay(
    source: SliceGrayImage,
    image: ImageData,
  ): ImageData {
    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        const sourceX = source.width - 1 - x;
        const sourceY = source.height - 1 - y;
        const value = source.values[sourceY * source.width + sourceX];
        const outIndex = (y * source.width + x) * 4;

        if (!Number.isFinite(value)) {
          image.data[outIndex + 3] = 0;
          continue;
        }

        if (value > 0) {
          if (!this.showValidMaskVoxels()) {
            image.data[outIndex + 3] = 0;
            continue;
          }
          image.data[outIndex] = 46;
          image.data[outIndex + 1] = 160;
          image.data[outIndex + 2] = 67;
          image.data[outIndex + 3] = 255;
        } else {
          if (!this.showInvalidMaskVoxels()) {
            image.data[outIndex + 3] = 0;
            continue;
          }
          image.data[outIndex] = 205;
          image.data[outIndex + 1] = 68;
          image.data[outIndex + 2] = 56;
          image.data[outIndex + 3] = 255;
        }
      }
    }

    if (this.showMaskOutline()) {
      this.applyMaskOutline(source, image);
    }

    return image;
  }

  private applyMaskOutline(
    source: SliceGrayImage,
    image: ImageData,
  ): void {
    const isMaskValid = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= source.width || y >= source.height) {
        return false;
      }
      const sourceX = source.width - 1 - x;
      const sourceY = source.height - 1 - y;
      const value = source.values[sourceY * source.width + sourceX];
      return Number.isFinite(value) && value > 0;
    };

    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        const current = isMaskValid(x, y);
        const hasDifferentNeighbour =
          current !== isMaskValid(x + 1, y) ||
          current !== isMaskValid(x - 1, y) ||
          current !== isMaskValid(x, y + 1) ||
          current !== isMaskValid(x, y - 1);

        if (!hasDifferentNeighbour) {
          continue;
        }

        const outIndex = (y * source.width + x) * 4;
        image.data[outIndex] = 255;
        image.data[outIndex + 1] = 255;
        image.data[outIndex + 2] = 255;
        image.data[outIndex + 3] = 230;
      }
    }
  }

  private emitRectangleRoiSummary(bounds: RoiBounds): void {
    const arrays = this.voxelArrays();
    const selected = this.selectedMapEntry();
    if (!arrays || !selected) {
      this.roiSelected.emit(null);
      return;
    }

    const stats = this.collectRoiStats((x, y) =>
      x >= bounds.xStart && x <= bounds.xEnd && y >= bounds.yStart && y <= bounds.yEnd,
      bounds.z,
      arrays,
      selected.key,
      selected.map.unit,
    );

    this.roiSelected.emit(stats);
  }

  private buildPolygonRoiSummary(points: readonly VoxelPoint[], z: number): RoiSummary | null {
    const arrays = this.voxelArrays();
    const selected = this.selectedMapEntry();
    if (!arrays || !selected) {
      return null;
    }

    return this.collectRoiStats(
      (x, y) => this.pointInPolygon({ x, y }, points),
      z,
      arrays,
      selected.key,
      selected.map.unit,
    );
  }

  private collectRoiStats(
    isInside: (x: number, y: number) => boolean,
    z: number,
    arrays: VoxelMapArrays,
    parameterKey: IvimParameterMapKey,
    parameterUnit: string,
  ): RoiSummary {
    const [width, height] = arrays.shape;
    const values: number[] = [];
    let xStart = Number.POSITIVE_INFINITY;
    let yStart = Number.POSITIVE_INFINITY;
    let xEnd = Number.NEGATIVE_INFINITY;
    let yEnd = Number.NEGATIVE_INFINITY;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!isInside(x, y)) {
          continue;
        }
        const index = this.getMapIndex(x, y, z, arrays.shape);
        const value = arrays[parameterKey][index];
        if (!Number.isFinite(value)) {
          continue;
        }

        values.push(value);
        xStart = Math.min(xStart, x);
        yStart = Math.min(yStart, y);
        xEnd = Math.max(xEnd, x);
        yEnd = Math.max(yEnd, y);
      }
    }

    const sorted = [...values].sort((left, right) => left - right);
    const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length
      ? (sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle])
      : 0;
    const variance = values.length
      ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
      : 0;

    return {
      bounds: {
        xStart: Number.isFinite(xStart) ? xStart : 0,
        yStart: Number.isFinite(yStart) ? yStart : 0,
        xEnd: Number.isFinite(xEnd) ? xEnd : 0,
        yEnd: Number.isFinite(yEnd) ? yEnd : 0,
        z,
      },
      D: { mean, median, standardDeviation: Math.sqrt(variance) },
      f: { mean, median, standardDeviation: Math.sqrt(variance) },
      Dstar: { mean, median, standardDeviation: Math.sqrt(variance) },
      validVoxelCount: values.length,
      selectedVoxelCount: values.length,
      minValue: sorted[0] ?? 0,
      maxValue: sorted.at(-1) ?? 0,
      standardDeviation: Math.sqrt(variance),
      sliceNumber: z,
      parameterKey,
      parameterUnit,
      meanAdjustedR2: 0,
    };
  }

  private buildVoxelSelection(
    x: number,
    y: number,
    z: number,
    arrays: VoxelMapArrays,
    fit: FitArrays,
  ): SelectedVoxelFit | null {
    const [width, height, depth] = arrays.shape;
    if (x < 0 || y < 0 || z < 0 || x >= width || y >= height || z >= depth) {
      return null;
    }

    const index = this.getMapIndex(x, y, z, arrays.shape);
    const D = arrays.D[index];
    const f = arrays.f[index];
    const Dstar = arrays.Dstar[index];
    const r2 = arrays.r2[index];
    if (![D, f, Dstar, r2].every(Number.isFinite)) {
      return null;
    }

    const measured = fit.bvalues.map((_, bIndex) => fit.signals[this.getSignalIndex(x, y, z, bIndex, fit.shape)]);
    const fitted = fit.bvalues.map((bvalue) => f * Math.exp(-bvalue * Dstar) + (1 - f) * Math.exp(-bvalue * D));
    const finiteResiduals = measured
      .map((value, i) => value - fitted[i])
      .filter(Number.isFinite);

    const residualRmse = finiteResiduals.length
      ? Math.sqrt(finiteResiduals.reduce((sum, value) => sum + value * value, 0) / finiteResiduals.length)
      : 0;

    return { x, y, z, D, f, Dstar, r2, residualRmse, bvalues: fit.bvalues, measured, fitted };
  }

  private eventToVoxelPoint(event: MouseEvent | PointerEvent, canvas: HTMLCanvasElement, width: number, height: number): VoxelPoint {
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(width - 1, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * width)));
    const y = Math.min(height - 1, Math.max(0, Math.floor(((event.clientY - rect.top) / rect.height) * height)));
    return { x, y };
  }

  private displayToDataPoint(point: VoxelPoint, width: number, height: number): VoxelPoint {
    return {
      x: width - 1 - point.x,
      y: height - 1 - point.y,
    };
  }

  private dataToDisplayPoint(point: VoxelPoint, width: number, height: number): VoxelPoint {
    return {
      x: width - 1 - point.x,
      y: height - 1 - point.y,
    };
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

  private pointInPolygon(point: VoxelPoint, polygon: readonly VoxelPoint[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;

      const intersects = ((yi > point.y) !== (yj > point.y))
        && (point.x < (xj - xi) * (point.y - yi) / ((yj - yi) || 1e-9) + xi);

      if (intersects) {
        inside = !inside;
      }
    }
    return inside;
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

      for (const key of this.mapKeys) {
        if (arrays[key].length !== expectedLength) {
          return {
            arrays: null,
            error: `Decoded ${key} map has ${arrays[key].length} voxels, expected ${expectedLength}.`,
          };
        }
      }

      return { arrays, error: null };
    } catch (error) {
      const message = error instanceof Error
        ? `Could not decode parameter map voxel data: ${error.message}`
        : 'Could not decode parameter map voxel data.';
      return { arrays: null, error: message };
    }
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  private getMapIndex(x: number, y: number, z: number, shape: [number, number, number]): number {
    return x * shape[1] * shape[2] + y * shape[2] + z;
  }

  private getSignalIndex(x: number, y: number, z: number, b: number, shape: [number, number, number, number]): number {
    return ((x * shape[1] + y) * shape[2] + z) * shape[3] + b;
  }

  private getPreviewSignalIndex(x: number, y: number, z: number, b: number, shape: [number, number, number, number]): number {
    return (((b * shape[2] + z) * shape[1] + y) * shape[0]) + x;
  }

  private renderBackgroundCanvas(): void {
    const imageData = this.backgroundImageData();
    const canvas = this.backgroundCanvasRef?.nativeElement;
    if (!imageData || !canvas) {
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    context.putImageData(imageData, 0, 0);
  }

  private renderOverlayCanvas(): void {
    const imageData = this.overlayImageData();
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!imageData) {
      return;
    }

    context.putImageData(imageData, 0, 0);
  }

  private resolveDisplayRange(values: Float32Array, windowLevel: WindowLevel): { min: number; max: number; delta: number } {
    let minValue = Number.POSITIVE_INFINITY;
    let maxValue = Number.NEGATIVE_INFINITY;

    for (const value of values) {
      if (!Number.isFinite(value)) {
        continue;
      }
      minValue = Math.min(minValue, value);
      maxValue = Math.max(maxValue, value);
    }

    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || minValue === maxValue) {
      return { min: 0, max: 1, delta: 1 };
    }

    const low = this.levelToValue(windowLevel.level - windowLevel.window / 2, minValue, maxValue);
    const high = this.levelToValue(windowLevel.level + windowLevel.window / 2, minValue, maxValue);
    const min = Math.min(low, high);
    const max = Math.max(low, high);

    return { min, max, delta: Math.max(1e-9, max - min) };
  }

  private levelToValue(level: number, min: number, max: number): number {
    return min + (Math.max(0, Math.min(100, level)) / 100) * (max - min);
  }

  private applyColorMap(normalized: number): RgbColor {
    const stops = [
      { p: 0, c: { r: 24, g: 33, b: 112 } },
      { p: 0.2, c: { r: 26, g: 110, b: 186 } },
      { p: 0.4, c: { r: 40, g: 174, b: 128 } },
      { p: 0.6, c: { r: 138, g: 205, b: 63 } },
      { p: 0.8, c: { r: 249, g: 188, b: 40 } },
      { p: 1, c: { r: 215, g: 48, b: 39 } },
    ];

    const clamped = Math.max(0, Math.min(1, normalized));
    for (let i = 0; i < stops.length - 1; i++) {
      const left = stops[i];
      const right = stops[i + 1];
      if (clamped <= right.p) {
        const section = right.p - left.p || 1;
        const t = (clamped - left.p) / section;
        return {
          r: Math.round(left.c.r + (right.c.r - left.c.r) * t),
          g: Math.round(left.c.g + (right.c.g - left.c.g) * t),
          b: Math.round(left.c.b + (right.c.b - left.c.b) * t),
        };
      }
    }

    return stops[stops.length - 1].c;
  }

  private distance(left: VoxelPoint, right: VoxelPoint): number {
    return Math.sqrt((left.x - right.x) ** 2 + (left.y - right.y) ** 2);
  }

  protected mapLabel(entry: { key: IvimParameterMapKey; map: IvimParameterMap }): string {
    if (entry.key === 'validMask') {
      return 'Valid mask';
    }
    return entry.map.displayName;
  }

  private applyFitToWidthZoom(): void {
    const image = this.backgroundImageData();
    const viewport = this.viewportRef?.nativeElement;
    if (!image || !viewport || image.width <= 0) {
      return;
    }

    const availableWidth = Math.max(0, viewport.clientWidth - 12);
    if (availableWidth <= 0) {
      return;
    }

    const fitPercent = Math.floor((availableWidth / image.width) * 100);
    const clamped = Math.min(500, Math.max(100, fitPercent));
    this.zoomPercent.set(clamped);
  }
}
