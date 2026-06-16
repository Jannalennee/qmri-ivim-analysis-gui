export type ScanFormat = 'nifti';

export interface IngestedScan {
  fileName: string;
  format: ScanFormat;
  sizeMb: number;
  uploadedAtIso: string;
  bvalFileName?: string;
  volumeCount?: number;
  bvalueCount?: number;
}

export type IvimParameterMapKey = 'D' | 'f' | 'Dstar' | 'r2' | 'validMask';

export interface IvimParameterMap {
  displayName: string;
  unit: string;
  minValue: number;
  maxValue: number;
  meanValue: number;
  data: string;
  encoding: 'base64-float32';
}

export interface IvimParameterMaps {
  D: IvimParameterMap;
  f: IvimParameterMap;
  Dstar: IvimParameterMap;
  r2: IvimParameterMap;
  validMask: IvimParameterMap;
}

export interface IvimMetadata {
  imageShape: [number, number, number];
  numberOfSlices: number;
  numberOfBValues: number;
  bValues: readonly number[];
}

export interface IvimQcMetrics {
  meanAdjustedR2: number;
  validVoxelPercentage: number;
  failedVoxelCount: number;
}

export interface VoxelMapArrays {
  D: Float32Array;
  f: Float32Array;
  Dstar: Float32Array;
  r2: Float32Array;
  validMask: Float32Array;
  shape: [number, number, number];
}

export interface IvimVoxelFitData {
  shape: [number, number, number, number];
  signals: string;
  encoding: 'base64-float32';
}

export interface SelectedVoxelFit {
  x: number;
  y: number;
  z: number;
  D: number;
  f: number;
  Dstar: number;
  r2: number;
  residualRmse: number;
  bvalues: readonly number[];
  measured: readonly number[];
  fitted: readonly number[];
}

export interface RoiBounds {
  xStart: number;
  yStart: number;
  xEnd: number;
  yEnd: number;
  z: number;
}

export interface RoiParameterStats {
  mean: number;
  median: number;
  standardDeviation: number;
}

export interface RoiSummary {
  bounds: RoiBounds;
  D: RoiParameterStats;
  f: RoiParameterStats;
  Dstar: RoiParameterStats;
  validVoxelCount: number;
  meanAdjustedR2: number;
}

export interface QmriInferenceResult {
  status: 'success' | 'error';
  message: string;
  metadata: IvimMetadata;
  parameterMaps: IvimParameterMaps;
  qc: IvimQcMetrics;
  voxelFitSupport: boolean;
  voxelFit: IvimVoxelFitData | null;
}

export type QmriInferenceStatus = 'idle' | 'running' | 'completed' | 'error';
