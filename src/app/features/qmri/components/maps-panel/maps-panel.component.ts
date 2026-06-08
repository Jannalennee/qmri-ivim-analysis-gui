import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';

import { QmriInferenceResult } from '../../domain/qmri-inference.model';

@Component({
  selector: 'app-maps-panel',
  imports: [DatePipe],
  templateUrl: './maps-panel.component.html',
  styleUrl: './maps-panel.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MapsPanelComponent {
  readonly showUncertaintyOverlay = input.required<boolean>();
  readonly inferenceResult = input<QmriInferenceResult | null>(null);
}
