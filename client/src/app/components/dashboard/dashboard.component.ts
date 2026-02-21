import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="dashboard">
      <h1>Budget App</h1>
      <p>Dashboard — coming soon</p>
      @if (apiStatus(); as status) {
        <p class="api-status" [class.connected]="status === 'ok'">
          API: {{ status }}
        </p>
      }
    </div>
  `,
  styles: [`
    .dashboard {
      padding: 2rem;
      font-family: system-ui, sans-serif;
    }
    .api-status {
      color: #666;
      font-size: 0.9rem;
    }
    .api-status.connected {
      color: #22c55e;
    }
  `],
})
export class DashboardComponent {
  apiStatus = signal<string | null>(null);

  constructor(private api: ApiService) {
    this.api.get<{ status: string }>('/health').subscribe({
      next: (res) => this.apiStatus.set(res.status),
      error: () => this.apiStatus.set('error'),
    });
  }
}
