export interface NumberFormatOptions {
  decimals?: number;
  scientificThreshold?: number;
}

const DEFAULT_DECIMALS = 3;
const DEFAULT_SCIENTIFIC_THRESHOLD = 1e-4;

export function formatSummaryNumber(value: number | null | undefined, options?: NumberFormatOptions): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'Not available';
  }

  const decimals = options?.decimals ?? DEFAULT_DECIMALS;
  const threshold = options?.scientificThreshold ?? DEFAULT_SCIENTIFIC_THRESHOLD;
  const absolute = Math.abs(value);

  if (absolute > 0 && absolute < threshold) {
    return value.toExponential(2);
  }

  return value.toFixed(decimals);
}

export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'Not available';
  }
  return `${value.toFixed(decimals)}%`;
}

export function formatCompactList(values: readonly number[]): string {
  if (!values.length) {
    return 'Not available';
  }

  return values
    .map((value) => formatSummaryNumber(value, { decimals: value < 10 ? 2 : 0 }))
    .join(', ');
}
