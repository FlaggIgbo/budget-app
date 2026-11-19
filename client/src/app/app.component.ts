import { Component, computed } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { OfflineQueueService } from './services/offline-queue.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, MatButtonModule, MatIconModule],
  templateUrl: './app.component.html',
  styles: [
    `
      .offline-queue-banner {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.65rem;
        padding: 0.55rem 1rem;
        font-size: 0.85rem;
        font-weight: 500;
        background: #fffbeb;
        border-bottom: 1px solid #fde68a;
        color: #92400e;
        flex-wrap: wrap;
      }
      .offline-queue-banner.is-syncing {
        background: #eff6ff;
        border-bottom-color: #bfdbfe;
        color: #1e40af;
      }
      .offline-queue-banner mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
      .btn-flush-queue {
        height: 28px !important;
        line-height: 26px !important;
        font-size: 0.78rem !important;
        border-color: rgba(146, 64, 14, 0.35) !important;
        color: #92400e !important;
      }
    `,
  ],
})
export class AppComponent {
  isOnline = computed(() => this.offlineQueue.isOnline());
  pendingCount = computed(() => this.offlineQueue.pendingCount());
  syncing = computed(() => this.offlineQueue.syncing());
  showOfflineBanner = computed(() => !this.isOnline() || this.pendingCount() > 0);

  constructor(private offlineQueue: OfflineQueueService) {}

  syncQueuedNow() {
    void this.offlineQueue.flushQueue();
  }
}
