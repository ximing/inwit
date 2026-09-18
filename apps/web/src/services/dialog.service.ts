import { Service } from '@rabjs/react';

export type DialogKind = 'alert' | 'confirm' | 'prompt';

export type DialogRequest = {
  kind: DialogKind;
  title: string;
  message: string;
  ok: string;
  cancel: string;
  danger: boolean;
  defaultValue: string;
  placeholder: string;
};

type Pending = {
  request: DialogRequest;
  resolve: (value: unknown) => void;
};

export type ConfirmOptions = {
  title?: string;
  ok?: string;
  cancel?: string;
  danger?: boolean;
};

export type PromptOptions = {
  title?: string;
  ok?: string;
  cancel?: string;
  placeholder?: string;
};

export type AlertOptions = {
  title?: string;
  ok?: string;
};

/** Global replacement for window.alert / confirm / prompt. */
export class DialogService extends Service {
  current: DialogRequest | null = null;
  inputValue = '';
  private pending: Pending | null = null;
  private queue: Pending[] = [];

  alert(message: string, options?: AlertOptions): Promise<void> {
    return this.open({
      kind: 'alert',
      title: options?.title ?? '提示',
      message,
      ok: options?.ok ?? '确定',
      cancel: '',
      danger: false,
      defaultValue: '',
      placeholder: '',
    }) as Promise<void>;
  }

  confirm(message: string, options?: ConfirmOptions): Promise<boolean> {
    return this.open({
      kind: 'confirm',
      title: options?.title ?? '请确认',
      message,
      ok: options?.ok ?? '确定',
      cancel: options?.cancel ?? '取消',
      danger: options?.danger ?? false,
      defaultValue: '',
      placeholder: '',
    }) as Promise<boolean>;
  }

  prompt(message: string, defaultValue = '', options?: PromptOptions): Promise<string | null> {
    const customTitle = options?.title?.trim() ?? '';
    return this.open({
      kind: 'prompt',
      title: customTitle.length > 0 ? customTitle : message,
      message: customTitle.length > 0 ? message : '',
      ok: options?.ok ?? '确定',
      cancel: options?.cancel ?? '取消',
      danger: false,
      defaultValue,
      placeholder: options?.placeholder ?? '',
    }) as Promise<string | null>;
  }

  setInputValue(value: string): void {
    this.inputValue = value;
  }

  submit(): void {
    if (!this.pending) return;
    const { request, resolve } = this.pending;
    if (request.kind === 'confirm') resolve(true);
    else if (request.kind === 'prompt') resolve(this.inputValue);
    else resolve(undefined);
    this.advance();
  }

  cancel(): void {
    if (!this.pending) return;
    const { request, resolve } = this.pending;
    if (request.kind === 'confirm') resolve(false);
    else if (request.kind === 'prompt') resolve(null);
    else resolve(undefined);
    this.advance();
  }

  override destroy(): void {
    const all = this.pending ? [this.pending, ...this.queue] : [...this.queue];
    this.pending = null;
    this.queue = [];
    this.current = null;
    this.inputValue = '';
    for (const item of all) {
      if (item.request.kind === 'confirm') item.resolve(false);
      else if (item.request.kind === 'prompt') item.resolve(null);
      else item.resolve(undefined);
    }
    super.destroy();
  }

  private open(request: DialogRequest): Promise<unknown> {
    return new Promise((resolve) => {
      const item: Pending = { request, resolve };
      if (this.pending) this.queue.push(item);
      else this.show(item);
    });
  }

  private show(item: Pending): void {
    this.pending = item;
    this.current = item.request;
    this.inputValue = item.request.defaultValue;
  }

  private advance(): void {
    this.pending = null;
    this.current = null;
    this.inputValue = '';
    const next = this.queue.shift();
    if (next) this.show(next);
  }
}
