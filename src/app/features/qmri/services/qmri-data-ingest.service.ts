import { Injectable } from '@angular/core';

import { IngestedScan, ScanFormat } from '../domain/qmri-inference.model';

interface DataIngestResult {
  ok: boolean;
  scan?: IngestedScan;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class QmriDataIngestService {
  private readonly maxAllowedSizeMb = 1500;

  ingest(file: File | null): DataIngestResult {
    if (!file) {
      return {
        ok: false,
        message: 'No file selected. Choose a .nii or .nii.gz file.'
      };
    }

    const format = this.getScanFormat(file.name);
    if (!format) {
      return {
        ok: false,
        message: 'Unsupported format. Use .nii or .nii.gz.'
      };
    }

    const sizeMb = Number((file.size / (1024 * 1024)).toFixed(2));
    if (sizeMb > this.maxAllowedSizeMb) {
      return {
        ok: false,
        message: `File exceeds ${this.maxAllowedSizeMb} MB limit for this prototype.`
      };
    }

    return {
      ok: true,
      message: `Loaded ${file.name} (${sizeMb} MB).`,
      scan: {
        fileName: file.name,
        format,
        sizeMb,
        uploadedAtIso: new Date().toISOString()
      }
    };
  }

  private getScanFormat(fileName: string): ScanFormat | null {
    const normalized = fileName.toLowerCase();
    if (normalized.endsWith('.nii') || normalized.endsWith('.nii.gz')) {
      return 'nifti';
    }

    return null;
  }
}
