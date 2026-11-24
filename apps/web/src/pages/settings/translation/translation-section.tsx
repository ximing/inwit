import { Link, useLocation } from 'react-router';
import { docsPath } from '@/routes.js';
import { Select } from '@/components/select/select.js';
import { bindServices, observer, useService } from '@rabjs/react';
import { LLM_PROVIDERS, PROVIDER_LABELS, type LlmProvider } from '@inwit/dto';
import { useEffect } from 'react';
import { TranslationSettingsService } from './translation-settings.service.js';
const Content = observer(function TranslationSection() {
  const location = useLocation();
  const returnId = (location.state as { fromPdfDocumentId?: string } | null)?.fromPdfDocumentId;
  const s = useService(TranslationSettingsService);
  useEffect(() => {
    void s.load();
  }, [s]);
  return (
    <section className="section" id="translation">
      <div className="section-title">论文翻译</div>
      {returnId ? <Link to={docsPath(returnId)}>返回论文阅读</Link> : null}
      <div className="section-lede">
        点击 PDF 段落时使用此模型。已保存译文可反复查看，聊天配置独立维护。
      </div>
      <div className="panel translation-copy-panel">
        <div className="field">
          <label htmlFor="translation-copy">从已有配置复制</label>
          <Select
            id="translation-copy"
            ariaLabel="从已有配置复制"
            value={s.copyId}
            options={[
              { value: '', label: '选择聊天配置' },
              ...s.configs.map((c) => ({
                value: c.id,
                label: `${PROVIDER_LABELS[c.provider]} · ${c.model}`,
              })),
            ]}
            onChange={(value) => {
              s.copyId = value;
            }}
          />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!s.copyId || s.busy}
            onClick={() => void s.copy()}
          >
            复制并保存
          </button>
          <p className="settings-hint">复制后两处编辑、删除互不影响，密钥不会返回浏览器。</p>
        </div>
      </div>
      <form
        className="panel translation-config-panel"
        onSubmit={(e) => {
          e.preventDefault();
          void s.save();
        }}
      >
        <div className="field">
          <label htmlFor="translation-provider">供应商</label>
          <Select
            id="translation-provider"
            ariaLabel="供应商"
            value={s.provider}
            options={LLM_PROVIDERS.map((provider) => ({
              value: provider,
              label: PROVIDER_LABELS[provider],
            }))}
            onChange={(value) => {
              s.provider = value as LlmProvider;
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="translation-model">模型</label>
          <input
            id="translation-model"
            required
            value={s.model}
            onChange={(e) => {
              s.model = e.target.value;
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="translation-key">API Key</label>
          <input
            id="translation-key"
            type="password"
            autoComplete="new-password"
            required={!s.saved}
            value={s.apiKey}
            placeholder={s.saved ? '已保存，留空保持原密钥' : ''}
            onChange={(e) => {
              s.apiKey = e.target.value;
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="translation-base">Base URL（可选）</label>
          <input
            id="translation-base"
            type="url"
            value={s.baseUrl}
            placeholder="留空使用供应商默认地址"
            onChange={(e) => {
              s.baseUrl = e.target.value;
            }}
          />
        </div>
        <div className="row-actions translation-settings-actions">
          <button type="submit" className="btn btn-primary" disabled={s.busy}>
            {s.$model.save.loading ? '保存中…' : '保存翻译配置'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!s.saved || s.busy}
            onClick={() => void s.test()}
          >
            {s.$model.test.loading ? '测试中…' : '测试连接'}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={!s.saved || s.busy}
            onClick={() => void s.remove()}
          >
            删除翻译配置
          </button>
        </div>
        <p className="settings-hint">
          测试连接会调用已保存的模型并产生用量；保存本身不会调用模型。
        </p>
        {s.message ? (
          <p
            className={
              s.messageKind === 'error'
                ? 'banner-error'
                : s.messageKind === 'success'
                  ? 'ok-line'
                  : 'settings-hint'
            }
            role={s.messageKind === 'error' ? 'alert' : 'status'}
          >
            {s.message}
          </p>
        ) : null}
      </form>
    </section>
  );
});
export const TranslationSection = bindServices(Content, [TranslationSettingsService]);
