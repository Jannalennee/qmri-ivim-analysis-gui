export type ScanFormat = 'nifti';

export interface IngestedScan {
  fileName: string;
  format: ScanFormat;
  sizeMb: number;
  sizeBytes: number;
  uploadedAtIso: string;
  bvalFileName?: string;
  volumeCount?: number;
  bvalueCount?: number;
  uniqueBvalueCount?: number;
  uniqueBvalues?: readonly number[];
  imageDimensions?: [number, number, number];
  numberOfSlices?: number;
  voxelSpacing?: [number, number, number] | null;
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
  uniqueBValues?: readonly number[];
  voxelSpacing?: [number, number, number] | null;
  affine?: readonly number[];
  orientationLabels?: {
    x: string;
    y: string;
    z: string;
  } | null;
  sourceFileName?: string;
  sourceBvalFileName?: string | null;
}

export interface IvimQcMetrics {
  meanAdjustedR2: number;
  validVoxelPercentage: number;
  failedVoxelCount: number;
  validVoxelCount?: number;
  evaluatedVoxelCount?: number;
}

export interface MaskSummary {
  validVoxelCount: number;
  invalidVoxelCount: number;
  totalEvaluatedVoxelCount: number;
  validPercentage: number;
  invalidPercentage: number;
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

export interface SelectedVoxelGraphModel {
  title: string;
  xAxisLabel: string;
  yAxisLabel: string;
  ticks: readonly number[];
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
  selectedVoxelCount?: number;
  minValue?: number;
  maxValue?: number;
  standardDeviation?: number;
  sliceNumber?: number;
  parameterKey?: IvimParameterMapKey;
  parameterUnit?: string;
  meanAdjustedR2: number;
}

export type RoiToolMode = 'voxel' | 'rectangle' | 'polygon';

export interface RoiPolygonPoint {
  x: number;
  y: number;
}

export interface RoiSelection {
  tool: RoiToolMode;
  slice: number;
  bounds?: RoiBounds;
  polygon?: readonly RoiPolygonPoint[];
}

export interface AnalysisRunInfo {
  modelName?: string;
  runStartIso?: string;
  runDurationMs?: number;
  softwareVersion?: string;
  backendConfig?: Readonly<Record<string, unknown>>;
}

export interface ExportReportModel {
  exportedAtIso: string;
  inputFiles: {
    niftiFileName: string | null;
    bvalueFileName: string | null;
  };
  image: {
    dimensions: [number, number, number] | null;
    voxelSpacing: [number, number, number] | null;
  };
  bvalues: {
    totalCount: number | null;
    uniqueCount: number | null;
    uniqueValues: readonly number[];
  };
  display: {
    selectedBackgroundImage: string | null;
    selectedParameterMap: IvimParameterMapKey | null;
  };
  analysis: {
    status: QmriInferenceStatus;
    startedAtIso: string | null;
    durationMs: number | null;
    softwareVersion: string | null;
  };
  mask: MaskSummary | null;
  selectedVoxel: SelectedVoxelFit | null;
  selectedRoi: RoiSummary | null;
  appVersion: string;
}

export interface QmriInferenceResult {
  status: 'success' | 'error';
  message: string;
  metadata: IvimMetadata;
  parameterMaps: IvimParameterMaps;
  qc: IvimQcMetrics;
  analysisInfo?: AnalysisRunInfo;
  voxelFitSupport: boolean;
  voxelFit: IvimVoxelFitData | null;
  referenceImage?: {
    data: string;
    encoding: 'base64-float32';
  } | null;
}

export type QmriInferenceStatus = 'idle' | 'running' | 'completed' | 'error';
