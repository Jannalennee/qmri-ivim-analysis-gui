import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { UpperCasePipe } from '@angular/common';

import { IngestedScan } from '../../domain/qmri-inference.model';

@Component({
  selector: 'app-data-ingest-panel',
  imports: [UpperCasePipe],
  templateUrl: './data-ingest-panel.component.html',
  styleUrl: './data-ingest-panel.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DataIngestPanelComponent {
  readonly selectedScan = input<IngestedScan | null>(null);
  readonly ingestMessage = input.required<string>();

  readonly fileSelected = output<File | null>();

  protected onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.fileSelected.emit(file);
  }
}
