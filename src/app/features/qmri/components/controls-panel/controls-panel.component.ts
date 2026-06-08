import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { QmriModelId } from '../../domain/qmri-inference.model';

@Component({
  selector: 'app-controls-panel',
  templateUrl: './controls-panel.component.html',
  styleUrl: './controls-panel.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ControlsPanelComponent {
  readonly selectedModel = input.required<QmriModelId>();
  readonly confidenceThreshold = input.required<number>();
  readonly overlayOpacity = input.required<number>();
  readonly smoothingLevel = input.required<number>();
  readonly showAdvancedControls = input.required<boolean>();
  readonly showUncertaintyOverlay = input.required<boolean>();
  readonly ivimBMax = input.required<number>();
  readonly ivimRegularization = input.required<number>();
  readonly ncdeTimeSteps = input.required<number>();
  readonly ncdeHiddenSize = input.required<number>();

  readonly thresholdChange = output<number>();
  readonly opacityChange = output<number>();
  readonly smoothingChange = output<number>();
  readonly uncertaintyToggle = output<void>();
  readonly ivimBMaxChange = output<number>();
  readonly ivimRegularizationChange = output<number>();
  readonly ncdeTimeStepsChange = output<number>();
  readonly ncdeHiddenSizeChange = output<number>();
  readonly recommendedSettingsRequested = output<void>();

  protected onThresholdInput(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.thresholdChange.emit(value);
  }

  protected onOpacityInput(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.opacityChange.emit(value);
  }

  protected onSmoothingInput(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.smoothingChange.emit(value);
  }

  protected toggleUncertainty(): void {
    this.uncertaintyToggle.emit();
  }

  protected onIvimBMaxInput(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.ivimBMaxChange.emit(value);
  }

  protected onIvimRegularizationInput(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.ivimRegularizationChange.emit(value);
  }

  protected onNcdeTimeStepsInput(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.ncdeTimeStepsChange.emit(value);
  }

  protected onNcdeHiddenSizeInput(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.ncdeHiddenSizeChange.emit(value);
  }

  protected applyRecommendedSettings(): void {
    this.recommendedSettingsRequested.emit();
  }
}
