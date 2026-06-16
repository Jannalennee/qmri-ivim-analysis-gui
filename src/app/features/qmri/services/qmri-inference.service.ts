import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { QmriInferenceResult } from '../domain/qmri-inference.model';

@Injectable({ providedIn: 'root' })
export class QmriInferenceService {
  private readonly httpClient = inject(HttpClient);
  private readonly inferenceEndpoint = 'http://localhost:8000/api/inference/run';

  async runInference(
    scanFile: File,
    bvalFile: File | null,
  ): Promise<QmriInferenceResult> {
    const formData = new FormData();
    formData.append('file', scanFile, scanFile.name);
    if (bvalFile) {
      formData.append('bvalFile', bvalFile, bvalFile.name);
    }
    formData.append('maxVoxels', '30000');

    try {
      return await firstValueFrom(
        this.httpClient.post<QmriInferenceResult>(this.inferenceEndpoint, formData)
      );
    } catch (error) {
      if (error instanceof HttpErrorResponse && this.isQmriInferenceResult(error.error)) {
        return error.error;
      }
      if (error instanceof HttpErrorResponse) {
        throw new Error(this.describeHttpError(error));
      }
      throw error;
    }
  }

  private isQmriInferenceResult(value: unknown): value is QmriInferenceResult {
    return typeof value === 'object' && value !== null && 'status' in value && 'parameterMaps' in value;
  }

  private describeHttpError(error: HttpErrorResponse): string {
    if (error.status === 0) {
      return 'IVIM backend is not reachable at http://localhost:8000. Start the FastAPI backend and try again.';
    }

    if (typeof error.error === 'string' && error.error.trim()) {
      return error.error;
    }

    if (typeof error.error?.detail === 'string') {
      return error.error.detail;
    }

    return `IVIM backend request failed with HTTP ${error.status}.`;
  }
}
