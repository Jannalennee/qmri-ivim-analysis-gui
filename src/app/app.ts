import { ChangeDetectionStrategy, Component } from '@angular/core';

import { QmriShellComponent } from './features/qmri/qmri-shell.component';

@Component({
  selector: 'app-root',
  imports: [QmriShellComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class App {}
