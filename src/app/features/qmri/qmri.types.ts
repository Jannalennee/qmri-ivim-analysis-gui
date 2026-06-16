export interface IvimValidationState {
  status: 'empty' | 'pending' | 'valid' | 'invalid';
  message: string;
  volumeCount?: number;
  bvalueCount?: number;
}
