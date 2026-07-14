import { Injectable } from '@angular/core';
import * as nifti from 'nifti-reader-js';

import { DiffusionPreviewDataset, UniqueBvalueSummary } from '../qmri.types';

@Injectable({ providedIn: 'root' })
export class QmriPreviewService {
  async parsePreview(scanFile: File, bvalueSummary: { values: readonly number[]; unique: UniqueBvalueSummary }): Promise<DiffusionPreviewDataset> {
    const arrayBuffer = await scanFile.arrayBuffer();
    const normalizedBuffer = this.ensureUncompressed(arrayBuffer);

    if (!nifti.isNIFTI(normalizedBuffer)) {
      throw new Error('The selected diffusion file is not a valid NIfTI image.');
    }

    const header = nifti.readHeader(normalizedBuffer);
    if (!header) {
      throw new Error('Could not parse the NIfTI header for preview.');
    }

    const imageData = nifti.readImage(header, normalizedBuffer);
    const dims = header.dims;
    const x = dims[1] ?? 0;
    const y = dims[2] ?? 0;
    const z = dims[3] ?? 0;
    const v = dims[4] ?? 0;

    if (x <= 0 || y <= 0 || z <= 0 || v <= 0) {
      throw new Error('Expected a 4D diffusion dataset for preview.');
    }

    const values = this.toFloat32Array(header.datatypeCode, imageData);
    const expectedLength = x * y * z * v;
    if (values.length !== expectedLength) {
      throw new Error(`Preview data length mismatch: ${values.length}, expected ${expectedLength}.`);
    }

    const bvalues = bvalueSummary.values;
    const defaultB0VolumeIndex = this.resolveDefaultB0VolumeIndex(bvalues);

    return {
      shape: [x, y, z, v],
      values,
      bvalues,
      voxelSpacing: this.resolveVoxelSpacing(header),
      orientationLabels: null,
      defaultB0VolumeIndex,
    };
  }

  private ensureUncompressed(arrayBuffer: ArrayBuffer): ArrayBuffer {
    if (nifti.isCompressed(arrayBuffer)) {
      const decompressed = nifti.decompress(arrayBuffer);
      const source = new Uint8Array(decompressed);
      const copy = new Uint8Array(source.byteLength);
      copy.set(source);
      return copy.buffer;
    }
    return arrayBuffer;
  }

  private toFloat32Array(datatypeCode: number, imageData: ArrayBuffer): Float32Array {
    switch (datatypeCode) {
      case nifti.NIFTI1.TYPE_UINT8:
        return Float32Array.from(new Uint8Array(imageData));
      case nifti.NIFTI1.TYPE_INT16:
        return Float32Array.from(new Int16Array(imageData));
      case nifti.NIFTI1.TYPE_INT32:
        return Float32Array.from(new Int32Array(imageData));
      case nifti.NIFTI1.TYPE_FLOAT32:
        return new Float32Array(imageData);
      case nifti.NIFTI1.TYPE_FLOAT64:
        return Float32Array.from(new Float64Array(imageData));
      case nifti.NIFTI1.TYPE_INT8:
        return Float32Array.from(new Int8Array(imageData));
      case nifti.NIFTI1.TYPE_UINT16:
        return Float32Array.from(new Uint16Array(imageData));
      case nifti.NIFTI1.TYPE_UINT32:
        return Float32Array.from(new Uint32Array(imageData));
      default:
        throw new Error(`Unsupported NIfTI datatype for preview: ${datatypeCode}.`);
    }
  }

  private resolveDefaultB0VolumeIndex(bvalues: readonly number[]): number {
    if (!bvalues.length) {
      return 0;
    }

    let selectedIndex = 0;
    for (let index = 0; index < bvalues.length; index++) {
      if (bvalues[index] === 0) {
        return index;
      }
      if (bvalues[index] < bvalues[selectedIndex]) {
        selectedIndex = index;
      }
    }

    return selectedIndex;
  }

  private resolveVoxelSpacing(header: nifti.NIFTI1 | nifti.NIFTI2): [number, number, number] | null {
    const x = header.pixDims[1];
    const y = header.pixDims[2];
    const z = header.pixDims[3];
    if ([x, y, z].every((value) => Number.isFinite(value) && value > 0)) {
      return [x, y, z];
    }
    return null;
  }
}
