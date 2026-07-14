import { IvimParameterMapKey, RoiToolMode } from './domain/qmri-inference.model';

export type FileSelectionStatus = 'not-selected' | 'loaded' | 'invalid-file-type' | 'validation-error';

export interface DatasetFileState {
  fileName: string | null;
  status: FileSelectionStatus;
  message: string;
}

export interface UniqueBvalueSummary {
  values: readonly number[];
  countsByValue: Readonly<Record<string, number>>;
}

export interface IvimValidationState {
  status: 'empty' | 'pending' | 'valid' | 'invalid';
  message: string;
  volumeCount?: number;
  bvalueCount?: number;
  uniqueBvalueCount?: number;
  uniqueBvalues?: readonly number[];
  uniqueBvalueSummary?: UniqueBvalueSummary;
  imageDimensions?: [number, number, number];
  numberOfSlices?: number;
  voxelSpacing?: [number, number, number] | null;
  fileFormat?: string;
  fileSizeBytes?: number;
  uploadTimeIso?: string;
  filesMatch?: boolean;
}

export interface ViewerState {
  selectedMap: IvimParameterMapKey | null;
  selectedBackgroundMode: 'volume' | 'mean';
  selectedBackgroundVolumeIndex: number;
  currentSlice: number;
  currentVolumeIndex: number;
  zoomPercent: number;
  panX: number;
  panY: number;
  window: number;
  level: number;
  overlayOpacityPercent: number;
  roiTool: RoiToolMode;
}

export interface DiffusionPreviewDataset {
  shape: [number, number, number, number];
  values: Float32Array;
  bvalues: readonly number[];
  voxelSpacing: [number, number, number] | null;
  orientationLabels: {
    x: string;
    y: string;
    z: string;
  } | null;
  defaultB0VolumeIndex: number;
}

export interface ExportAvailabilityState {
  canExportParameterMaps: boolean;
  canExportValidMask: boolean;
  canExportRoiMask: boolean;
  canExportSelectedVoxelCsv: boolean;
  canExportGraph: boolean;
  canExportReport: boolean;
}
