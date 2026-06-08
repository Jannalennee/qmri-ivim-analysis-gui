import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { UserRole } from '../../qmri.types';

@Component({
  selector: 'app-role-selector',
  templateUrl: './role-selector.component.html',
  styleUrl: './role-selector.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RoleSelectorComponent {
  readonly selectedRole = input.required<UserRole>();
  readonly roleDescription = input.required<string>();

  readonly roleChange = output<UserRole>();

  protected selectRole(role: UserRole): void {
    this.roleChange.emit(role);
  }
}
