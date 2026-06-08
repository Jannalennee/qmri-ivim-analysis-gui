import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-transparency-panel',
  templateUrl: './transparency-panel.component.html',
  styleUrl: './transparency-panel.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TransparencyPanelComponent {
  readonly workflowStep = input.required<string>();
}
