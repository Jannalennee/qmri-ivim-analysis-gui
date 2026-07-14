export type OrientationConvention = 'radiological' | 'neurological';

export interface OrientationTransform {
  flipX: boolean;
  flipY: boolean;
}

export interface OrientationLabels {
  left: string;
  right: string;
  top: string;
  bottom: string;
}

export function resolveOrientationTransform(
  orientationLabels: { x: string; y: string } | null | undefined,
  convention: OrientationConvention = 'radiological',
): OrientationTransform {
  if (!orientationLabels) {
    return { flipX: convention === 'radiological', flipY: false };
  }

  const xAxis = orientationLabels.x.toUpperCase();
  const yAxis = orientationLabels.y.toUpperCase();

  const xIsRight = xAxis === 'R';
  const yIsAnterior = yAxis === 'A';

  return {
    flipX: convention === 'radiological' ? xIsRight : !xIsRight,
    flipY: yIsAnterior,
  };
}

export function resolveOrientationLabels(
  orientationLabels: { x: string; y: string } | null | undefined,
  convention: OrientationConvention = 'radiological',
): OrientationLabels {
  const transform = resolveOrientationTransform(orientationLabels, convention);
  return {
    left: transform.flipX ? 'R' : 'L',
    right: transform.flipX ? 'L' : 'R',
    top: transform.flipY ? 'P' : 'A',
    bottom: transform.flipY ? 'A' : 'P',
  };
}
