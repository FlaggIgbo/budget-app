import { Injectable, signal } from '@angular/core';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

// Manages PWA installability (beforeinstallprompt) and standalone display-mode detection
@Injectable({ providedIn: 'root' })
export class PwaService {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private canInstallSignal = signal(false);
  private isInstalledSignal = signal(this.detectStandaloneMode());

  canInstall = this.canInstallSignal.asReadonly();
  isInstalled = this.isInstalledSignal.asReadonly();

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeinstallprompt', (event: Event) => {
        event.preventDefault();
        this.deferredPrompt = event as BeforeInstallPromptEvent;
        this.canInstallSignal.set(true);
      });

      window.addEventListener('appinstalled', () => {
        this.deferredPrompt = null;
        this.canInstallSignal.set(false);
        this.isInstalledSignal.set(true);
      });
    }
  }

  private detectStandaloneMode(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    const standaloneMedia =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches;
    const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
    return standaloneMedia || iosStandalone;
  }

  // Trigger the browser's native PWA install prompt when available
  async promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    if (!this.deferredPrompt) {
      return 'unavailable';
    }
    await this.deferredPrompt.prompt();
    const choice = await this.deferredPrompt.userChoice;
    this.deferredPrompt = null;
    this.canInstallSignal.set(false);
    if (choice.outcome === 'accepted') {
      this.isInstalledSignal.set(true);
    }
    return choice.outcome;
  }
}
