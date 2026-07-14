import { describe, expect, it } from 'vitest';

import { buildMatchMessage } from './validation.util';

describe('validation util', () => {
  it('returns explicit match message', () => {
    expect(buildMatchMessage(104, 104)).toBe('Volumes and b-value entries match');
  });

  it('returns explicit mismatch message', () => {
    expect(buildMatchMessage(104, 103)).toBe('Mismatch: 104 volumes and 103 b-value entries');
  });
});
