export type ScanFormat = 'dicom' | 'nifti';

export type QmriModelId = 'ivimnet' | 'ncde-qmri';

export interface QmriModelOption {
  id: QmriModelId;
  label: string;
}

export const QMRI_MODEL_OPTIONS: readonly QmriModelOption[] = [
  { id: 'ivimnet', label: 'IVIMNET (AMC)' },
  { id: 'ncde-qmri', label: 'NCDE-QMRI (AMC)' }
] as const;

export interface IngestedScan {
  fileName: string;
  format: ScanFormat;
  sizeMb: number;
  uploadedAtIso: string;
}

export interface QuantitativeMapSummary {
  label: string;
  mean: number;
  unit: string;
}

export interface QmriInferenceResult {
  modelName: string;
  generatedAtIso: string;
  confidenceScore: number;
  maps: readonly QuantitativeMapSummary[];
  warnings: readonly string[];
}

export type QmriInferenceStatus = 'idle' | 'running' | 'completed' | 'error';
