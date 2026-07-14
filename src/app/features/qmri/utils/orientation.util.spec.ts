import { describe, expect, it } from 'vitest';

import { resolveOrientationLabels, resolveOrientationTransform } from './orientation.util';

describe('orientation util', () => {
  it('provides deterministic transforms for radiological convention', () => {
    expect(resolveOrientationTransform({ x: 'R', y: 'A' }, 'radiological')).toEqual({
      flipX: true,
      flipY: true,
    });
  });

  it('computes visible orientation labels from transform', () => {
    expect(resolveOrientationLabels({ x: 'L', y: 'P' }, 'radiological')).toEqual({
      left: 'L',
      right: 'R',
      top: 'A',
      bottom: 'P',
    });
  });
});
