import { Service } from '@rabjs/react';

/**
 * 正文引擎是否就绪，以及加载失败的文案。
 * 不改 contentGen、entityGen、正文或可编辑状态；那些仍由 ReaderService 和页面编排。
 */
export class ReaderEngineService extends Service {
  engineReady = false;
  engineError: string | null = null;
}
