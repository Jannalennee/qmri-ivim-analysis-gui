export function buildMatchMessage(volumeCount: number, bvalueCount: number): string {
  if (volumeCount === bvalueCount) {
    return 'Volumes and b-value entries match';
  }

  return `Mismatch: ${volumeCount} volumes and ${bvalueCount} b-value entries`;
}
