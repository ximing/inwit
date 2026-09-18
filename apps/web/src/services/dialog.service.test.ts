import { describe, expect, it } from 'vitest';
import { DialogService } from './dialog.service';

describe('DialogService', () => {
  it('resolves alert on submit and cancel', async () => {
    const dialog = new DialogService();
    const submitted = dialog.alert('已保存');
    expect(dialog.current?.kind).toBe('alert');
    expect(dialog.current?.message).toBe('已保存');
    dialog.submit();
    await expect(submitted).resolves.toBeUndefined();

    const cancelled = dialog.alert('还在');
    dialog.cancel();
    await expect(cancelled).resolves.toBeUndefined();
  });

  it('resolves confirm true/false', async () => {
    const dialog = new DialogService();
    const ok = dialog.confirm('删除？', { title: '删除', danger: true, ok: '删除' });
    expect(dialog.current?.title).toBe('删除');
    expect(dialog.current?.danger).toBe(true);
    dialog.submit();
    await expect(ok).resolves.toBe(true);

    const no = dialog.confirm('删除？');
    dialog.cancel();
    await expect(no).resolves.toBe(false);
  });

  it('returns prompt value or null', async () => {
    const dialog = new DialogService();
    const typed = dialog.prompt('链接地址', 'https://');
    expect(dialog.current?.kind).toBe('prompt');
    expect(dialog.inputValue).toBe('https://');
    dialog.setInputValue('https://inwit.app');
    dialog.submit();
    await expect(typed).resolves.toBe('https://inwit.app');

    const aborted = dialog.prompt('链接地址');
    dialog.cancel();
    await expect(aborted).resolves.toBeNull();
  });

  it('queues a second dialog until the first closes', async () => {
    const dialog = new DialogService();
    const first = dialog.confirm('一');
    const second = dialog.confirm('二');
    expect(dialog.current?.message).toBe('一');
    dialog.submit();
    await expect(first).resolves.toBe(true);
    expect(dialog.current?.message).toBe('二');
    dialog.cancel();
    await expect(second).resolves.toBe(false);
    expect(dialog.current).toBeNull();
  });

  it('rejects pending dialogs on destroy', async () => {
    const dialog = new DialogService();
    const confirm = dialog.confirm('还开着');
    const prompt = dialog.prompt('输入');
    dialog.destroy();
    await expect(confirm).resolves.toBe(false);
    await expect(prompt).resolves.toBeNull();
    expect(dialog.current).toBeNull();
  });
});
