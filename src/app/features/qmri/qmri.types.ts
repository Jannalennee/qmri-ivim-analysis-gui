export type UserRole = 'clinician' | 'researcher' | 'developer';

export interface QmriControlValues {
  confidenceThreshold: number;
  overlayOpacity: number;
  smoothingLevel: number;
  showUncertaintyOverlay: boolean;
}

export interface QmriModelControlValues {
  ivimBMax: number;
  ivimRegularization: number;
  ncdeTimeSteps: number;
  ncdeHiddenSize: number;
}
