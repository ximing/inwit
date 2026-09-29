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
  extra: string;
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

/** Resolved when a prompt's extra action is chosen. Distinct from a typed value and from cancel. */
export const PROMPT_EXTRA: unique symbol = Symbol('inwit.prompt.extra');

export type PromptOptions = {
  title?: string;
  ok?: string;
  cancel?: string;
  placeholder?: string;
  /** Extra action label. Shown only when non-empty. Choosing it resolves `PROMPT_EXTRA`. */
  extra?: string;
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
      extra: '',
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
      extra: '',
    }) as Promise<boolean>;
  }

  prompt(message: string, defaultValue?: string, options?: Omit<PromptOptions, 'extra'>): Promise<string | null>;
  prompt(
    message: string,
    defaultValue: string | undefined,
    options: PromptOptions & { extra: string },
  ): Promise<string | null | typeof PROMPT_EXTRA>;
  prompt(
    message: string,
    defaultValue = '',
    options?: PromptOptions,
  ): Promise<string | null | typeof PROMPT_EXTRA> {
    const customTitle = options?.title?.trim() ?? '';
    const extra = options?.extra?.trim() ?? '';
    return this.open({
      kind: 'prompt',
      title: customTitle.length > 0 ? customTitle : message,
      message: customTitle.length > 0 ? message : '',
      ok: options?.ok ?? '确定',
      cancel: options?.cancel ?? '取消',
      danger: false,
      defaultValue,
      placeholder: options?.placeholder ?? '',
      extra,
    }) as Promise<string | null | typeof PROMPT_EXTRA>;
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

  /** Resolves the open prompt with `PROMPT_EXTRA`. No-op unless that prompt declared an extra action. */
  chooseExtra(): void {
    if (!this.pending) return;
    const { request, resolve } = this.pending;
    if (request.kind !== 'prompt' || request.extra.length === 0) return;
    resolve(PROMPT_EXTRA);
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
