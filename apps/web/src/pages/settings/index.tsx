import { bindServices, observer, useService } from '@rabjs/react';
import { useEffect } from 'react';
import type { LlmProvider } from '@inwit/dto';
import { THEME_OPTIONS, ThemeService } from '@/services/theme.service';
import { PROVIDER_LABELS, PROVIDERS, SettingsService } from './settings.service';

const SettingsPageContent = observer(function SettingsPageContent() {
  const service = useService(SettingsService);
  const theme = useService(ThemeService);

  useEffect(() => {
    void service.load();
  }, [service]);

  return (
    <section className="page-plain">
      <header className="page-head">
        <h1>设置</h1>
        <p className="lede">浅色是白日书桌，深色是灯下夜读。</p>
      </header>

      <div className="panel">
        <h2>外观</h2>
        <div className="theme-options" role="radiogroup" aria-label="主题">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={theme.preference === option.id}
              className={theme.preference === option.id ? 'btn-secondary is-on' : 'btn-secondary'}
              onClick={() => theme.setPreference(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <h2 className="subhead">模型配置</h2>
      <p className="lede">自带密钥（BYOK）。完整密钥只在新增时提交一次，列表里只显示掩码。</p>

      {service.error ? (
        <p className="banner-error" role="alert">
          {service.error}
        </p>
      ) : null}

      <form
        className="stack-form panel"
        onSubmit={(event) => {
          event.preventDefault();
          void service.add();
        }}
      >
        <h2>新增配置</h2>
        <label>
          供应商
          <select
            name="provider"
            value={service.provider}
            onChange={(event) => service.setProvider(event.target.value as LlmProvider)}
          >
            {PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>
                {PROVIDER_LABELS[provider]}
              </option>
            ))}
          </select>
        </label>
        <label>
          模型
          <input
            name="model"
            value={service.model}
            onChange={(event) => service.setModel(event.target.value)}
            required
          />
        </label>
        <label>
          API Key
          <input
            type="password"
            name="apiKey"
            autoComplete="off"
            value={service.apiKey}
            onChange={(event) => service.setApiKey(event.target.value)}
            required
          />
        </label>
        <label>
          Base URL（可选）
          <input
            name="baseUrl"
            inputMode="url"
            placeholder="https://…"
            value={service.baseUrl}
            onChange={(event) => service.setBaseUrl(event.target.value)}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={service.isDefault}
            onChange={(event) => service.setIsDefault(event.target.checked)}
          />
          设为默认
        </label>
        {service.formError ? (
          <p className="banner-error" role="alert">
            {service.formError}
          </p>
        ) : null}
        <button type="submit" className="btn-primary" disabled={service.$model.add.loading}>
          {service.$model.add.loading ? '保存中…' : '新增'}
        </button>
      </form>

      <h2 className="subhead">已保存</h2>
      {service.$model.load.loading && service.configs.length === 0 ? <p className="empty">读取配置…</p> : null}
      {service.configs.length === 0 && !service.$model.load.loading ? (
        <p className="empty">还没有自己的模型。现在会走系统通义——想换的话在上面加一条。</p>
      ) : null}

      <ul className="config-list">
        {service.configs.map((config) => {
          const result = service.testResults[config.id];
          return (
            <li key={config.id} className="config-row">
              <div>
                <p className="config-title">
                  {PROVIDER_LABELS[config.provider]}
                  <span className="mono">{config.model}</span>
                  {config.isDefault ? <span className="badge">默认</span> : null}
                </p>
                <p className="meta">
                  密钥 <span className="mono">{config.apiKeyPreview}</span>
                  {config.baseUrl ? ` · ${config.baseUrl}` : ''}
                </p>
                {result ? (
                  <p className={result.ok ? 'ok-line' : 'banner-error'} role="status">
                    {result.ok ? '连通正常' : `不通：${result.error}`}
                  </p>
                ) : null}
              </div>
              <div className="row-actions">
                {!config.isDefault ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={service.busyId === config.id}
                    onClick={() => void service.makeDefault(config.id)}
                  >
                    设为默认
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={service.testingId === config.id}
                  onClick={() => void service.test(config.id)}
                >
                  {service.testingId === config.id ? '测试中…' : '测试连通'}
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  disabled={service.busyId === config.id}
                  onClick={() => {
                    if (window.confirm('删除这个模型配置？')) void service.remove(config.id);
                  }}
                >
                  删除
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
});

export const SettingsPage = bindServices(SettingsPageContent, [SettingsService]);
