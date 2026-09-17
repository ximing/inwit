import { Service } from '@rabjs/react';

const TOAST_MS = 3200;

export class ToastService extends Service {
  message: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  show(message: string, ms = TOAST_MS): void {
    this.message = message;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.message = null;
      this.timer = null;
    }, ms);
  }

  override destroy(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    super.destroy();
  }
}
