import { Injectable } from '@angular/core';

import { QmriControlValues, QmriModelControlValues } from '../qmri.types';
import { IngestedScan, QmriInferenceResult, QmriModelId } from '../domain/qmri-inference.model';

@Injectable({ providedIn: 'root' })
export class QmriInferenceService {
  runMockInference(
    model: QmriModelId,
    scan: IngestedScan,
    controls: QmriControlValues,
    modelControls: QmriModelControlValues
  ): QmriInferenceResult {
    const fileSignal = this.getFileSignal(scan.fileName);
    const modelFactor = model === 'ivimnet' ? 1 : 1.08;
    const ivimBoost = modelControls.ivimRegularization * 0.03;
    const ncdeBoost = (modelControls.ncdeTimeSteps / 64 + modelControls.ncdeHiddenSize / 128) * 0.02;
    const confidence = this.clamp(
      controls.confidenceThreshold + (fileSignal % 7) * 0.01 + (model === 'ncde-qmri' ? 0.01 + ncdeBoost : ivimBoost),
      0.5,
      0.99
    );

    const ivimShift = modelControls.ivimBMax / 200;
    const ncdeShift = (modelControls.ncdeTimeSteps / 16 + modelControls.ncdeHiddenSize / 32) * 0.8;

    const t1Mean = (940 + fileSignal * 0.8 - controls.smoothingLevel * 6 + (model === 'ivimnet' ? ivimShift : ncdeShift)) * modelFactor;
    const t2Mean = (74 + fileSignal * 0.06 - controls.smoothingLevel * 0.8 + (model === 'ivimnet' ? ivimShift * 0.05 : ncdeShift * 0.06)) * modelFactor;
    const pdMean = 0.86 + (controls.overlayOpacity / 100) * 0.1;

    const warnings: string[] = [];
    warnings.push(this.getModelWarning(model));

    if (scan.format === 'dicom') {
      warnings.push('DICOM import pathway active: verify sequence harmonization before reporting.');
    }

    if (controls.confidenceThreshold > 0.9) {
      warnings.push('High confidence threshold may hide borderline voxels.');
    }

    return {
      modelName: this.getModelName(model),
      generatedAtIso: new Date().toISOString(),
      confidenceScore: Number(confidence.toFixed(2)),
      maps: [
        { label: 'T1', mean: Number(t1Mean.toFixed(1)), unit: 'ms' },
        { label: 'T2', mean: Number(t2Mean.toFixed(1)), unit: 'ms' },
        { label: 'PD', mean: Number(pdMean.toFixed(2)), unit: 'fraction' },
        {
          label: 'Uncertainty',
          mean: Number((1 - confidence + controls.smoothingLevel * 0.01).toFixed(2)),
          unit: 'score'
        }
      ],
      warnings
    };
  }

  private getModelName(model: QmriModelId): string {
    return model === 'ivimnet' ? 'IVIMNET (AMC)' : 'NCDE-QMRI (AMC)';
  }

  private getModelWarning(model: QmriModelId): string {
    return model === 'ivimnet'
      ? 'IVIMNET selected: review b-value and regularization settings before final reporting.'
      : 'NCDE-QMRI selected: review sequence timestep and hidden size settings before final reporting.';
  }

  private getFileSignal(fileName: string): number {
    return Array.from(fileName).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 100;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }
}
