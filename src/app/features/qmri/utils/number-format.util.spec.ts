import { describe, expect, it } from 'vitest';

import { formatCompactList, formatPercent, formatSummaryNumber } from './number-format.util';

describe('number-format util', () => {
  it('formats summary values to readable precision', () => {
    expect(formatSummaryNumber(0.068893)).toBe('0.069');
    expect(formatSummaryNumber(1.23456, { decimals: 2 })).toBe('1.23');
  });

  it('uses scientific notation for very small finite values', () => {
    expect(formatSummaryNumber(0.0000009)).toContain('e-');
  });

  it('formats percentages with one decimal by default', () => {
    expect(formatPercent(42.34)).toBe('42.3%');
  });

  it('formats compact lists for b-values', () => {
    expect(formatCompactList([0, 10, 20])).toBe('0.00, 10, 20');
  });
});
