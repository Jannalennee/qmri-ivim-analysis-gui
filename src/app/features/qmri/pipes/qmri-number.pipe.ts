import { Pipe, PipeTransform } from '@angular/core';

import { formatPercent, formatSummaryNumber } from '../utils/number-format.util';

@Pipe({
  name: 'qmriNumber',
})
export class QmriNumberPipe implements PipeTransform {
  transform(value: number | null | undefined, mode: 'value' | 'percent' = 'value', decimals = 3): string {
    if (mode === 'percent') {
      return formatPercent(value, decimals);
    }

    return formatSummaryNumber(value, { decimals });
  }
}
