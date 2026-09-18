import { bindServices, observer, useService } from '@rabjs/react';
import { useEffect, useRef } from 'react';
import { OCR_DEFAULT_MODEL, docDisplayTitle, type LlmProvider } from '@inwit/dto';
import { UserAvatar } from '@/components/user-avatar';
import { Tag } from '@/components/tag';
import { formatDate, formatDateTime } from '@/lib/format';

/** 回收站摘要：单行截断。 */
function clipArchiveText(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  return chars.length <= max ? flat : `${chars.slice(0, max).join('')}…`;
}
import { THEME_OPTIONS, ThemeService, type ThemePreference } from '@/services/theme.service';
import {
  ACCESS_TOKEN_MAX_PER_USER,
  ACCESS_TOKEN_NAME_MAX,
  PROVIDER_LABELS,
  PROVIDERS,
  SettingsService,
  type SettingsSection,
} from './settings.service';

const THEME_SWATCH: Record<ThemePreference, string> = {
  light: 'linear-gradient(135deg,#f6f3ec,#fffdf8)',
  dark: 'linear-gradient(135deg,#1c1915,#26221c)',
  system: 'linear-gradient(90deg,#f6f3ec 50%,#1c1915 50%)',
};

const NAV: Array<{ id: SettingsSection; href: string; label: string }> = [
  { id: 'profile', href: '#profile', label: '个人资料' },
  { id: 'appearance', href: '#appearance', label: '外观' },
  { id: 'models', href: '#models', label: '模型配置' },
  { id: 'ocr', href: '#ocr', label: '文档解析' },
  { id: 'token', href: '#token', label: '接口令牌' },
  { id: 'archive', href: '#archive', label: '回收站' },
];

const SettingsPageContent = observer(function SettingsPageContent() {
  const service = useService(SettingsService);
  const theme = useService(ThemeService);
  const avatarInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    service.applyHash();
    void service.load();
  }, [service]);

  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="设置分节">
        {NAV.map((item) => (
          <a
            key={item.id}
            href={item.href}
            className={service.section === item.id ? 'is-on' : undefined}
            onClick={(event) => {
              event.preventDefault();
              service.setSection(item.id);
            }}
          >
            {item.label}
          </a>
        ))}
      </nav>

      <div>
        <div className="section" id="profile">
          <div className="section-title">个人资料</div>
          <div className="section-lede">头像、用户名和登录邮箱。</div>
          <div className="panel">
            <div className="profile-row">
              <UserAvatar fallback="icon" className="profile-avatar" />
              <div className="profile-avatar-actions">
                <input
                  ref={avatarInput}
                  id="settings-avatar"
                  className="sr-only"
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void service.uploadAvatar(file);
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={service.$model.uploadAvatar.loading}
                  onClick={() => avatarInput.current?.click()}
                >
                  {service.$model.uploadAvatar.loading ? '上传中…' : '更换头像'}
                </button>
                {service.avatarError ? (
                  <p className="banner-error" role="alert">
                    {service.avatarError}
                  </p>
                ) : null}
              </div>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void service.saveProfile();
              }}
            >
              <div className="field">
                <label htmlFor="settings-display-name">用户名</label>
                <input
                  id="settings-display-name"
                  name="displayName"
                  maxLength={64}
                  autoComplete="nickname"
                  placeholder="怎么称呼你"
                  value={service.displayName}
                  onChange={(event) => service.setDisplayName(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="settings-email">邮箱</label>
                <input
                  id="settings-email"
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  value={service.email}
                  onChange={(event) => service.setEmail(event.target.value)}
                />
              </div>
              {service.profileError ? (
                <p className="banner-error" role="alert">
                  {service.profileError}
                </p>
              ) : null}
              <button
                type="submit"
                className="btn btn-primary"
                disabled={service.$model.saveProfile.loading}
              >
                {service.$model.saveProfile.loading ? '保存中…' : '保存'}
              </button>
            </form>
          </div>
        </div>

        <div className="section" id="appearance">
          <div className="section-title">外观</div>
          <div className="section-lede">浅色是白日书桌，深色是灯下夜读。</div>
          <div className="theme-opts" role="radiogroup" aria-label="主题">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={theme.preference === option.id}
                className={`theme-opt${theme.preference === option.id ? ' is-on' : ''}`}
                onClick={() => theme.setPreference(option.id)}
              >
                <div className="theme-swatch" style={{ background: THEME_SWATCH[option.id] }} />
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="section" id="models">
          <div className="section-title">模型配置</div>
          <div className="section-lede">自带密钥（BYOK）。完整密钥只在新增时提交一次，列表里只显示掩码。</div>

          {service.error ? (
            <p className="banner-error" role="alert">
              {service.error}
            </p>
          ) : null}

          <form
            className="panel"
            onSubmit={(event) => {
              event.preventDefault();
              void service.add();
            }}
          >
            <div className="field">
              <label htmlFor="settings-provider">供应商</label>
              <select
                id="settings-provider"
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
            </div>
            <div className="field">
              <label htmlFor="settings-model">模型</label>
              <input
                id="settings-model"
                name="model"
                value={service.model}
                onChange={(event) => service.setModel(event.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="settings-key">API Key</label>
              <input
                id="settings-key"
                type="password"
                name="apiKey"
                autoComplete="off"
                placeholder="sk-…"
                value={service.apiKey}
                onChange={(event) => service.setApiKey(event.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="settings-base">Base URL（可选）</label>
              <input
                id="settings-base"
                name="baseUrl"
                inputMode="url"
                placeholder="https://…"
                value={service.baseUrl}
                onChange={(event) => service.setBaseUrl(event.target.value)}
              />
            </div>
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
            <button type="submit" className="btn btn-primary" disabled={service.$model.add.loading}>
              {service.$model.add.loading ? '保存中…' : '新增配置'}
            </button>
          </form>

          {service.$model.load.loading && service.configs.length === 0 ? (
            <p className="empty compact">读取配置…</p>
          ) : null}
          {service.configs.length === 0 && !service.$model.load.loading ? (
            <p className="settings-hint">还没有自己的模型，现在会走系统通义 —— 想换的话在上面加一条。</p>
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
                        className="btn btn-ghost"
                        disabled={service.busyId === config.id}
                        onClick={() => void service.makeDefault(config.id)}
                      >
                        设为默认
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={service.testingId === config.id}
                      onClick={() => void service.test(config.id)}
                    >
                      {service.testingId === config.id ? '测试中…' : '测试连通'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
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
        </div>

        <div className="section" id="ocr">
          <div className="section-title">文档解析（OCR）</div>
          <div className="section-lede">
            用于扫描版 PDF 文字提取，计费走用户自己的百炼账户。
          </div>
          <form
            className="panel"
            onSubmit={(event) => {
              event.preventDefault();
              void service.saveOcr();
            }}
          >
            <div className="field">
              <label htmlFor="settings-ocr-key">API Key</label>
              <input
                id="settings-ocr-key"
                type="password"
                name="ocrApiKey"
                autoComplete="off"
                placeholder={service.ocrConfig?.apiKeyPreview || 'sk-…'}
                value={service.ocrApiKey}
                onChange={(event) => service.setOcrApiKey(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="settings-ocr-model">模型</label>
              <input
                id="settings-ocr-model"
                name="ocrModel"
                value={service.ocrModel}
                onChange={(event) => service.setOcrModel(event.target.value)}
                placeholder={OCR_DEFAULT_MODEL}
              />
            </div>
            <div className="field">
              <label htmlFor="settings-ocr-base">Base URL（可选）</label>
              <input
                id="settings-ocr-base"
                name="ocrBaseUrl"
                inputMode="url"
                placeholder="https://…"
                value={service.ocrBaseUrl}
                onChange={(event) => service.setOcrBaseUrl(event.target.value)}
              />
            </div>
            {service.ocrFormError ? (
              <p className="banner-error" role="alert">
                {service.ocrFormError}
              </p>
            ) : null}
            {service.ocrTestResult ? (
              <p className={service.ocrTestResult.ok ? 'ok-line' : 'banner-error'} role="status">
                {service.ocrTestResult.ok ? '连通正常' : `不通：${service.ocrTestResult.error}`}
              </p>
            ) : null}
            <div className="row-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={service.$model.saveOcr.loading}
              >
                {service.$model.saveOcr.loading ? '保存中…' : '保存'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={service.$model.testOcr.loading}
                onClick={() => void service.testOcr()}
              >
                {service.$model.testOcr.loading ? '测试中…' : '测试'}
              </button>
            </div>
          </form>
        </div>

        <div className="section" id="token">
          <div className="section-title">接口令牌</div>
          <div className="section-lede">
            用于脚本或自动化调用接口。生成后永久有效，不会过期，也不会被删除。请求头{' '}
            <span className="mono">Authorization: Bearer &lt;token&gt;</span>。
          </div>
          <div className="settings-tabs" role="tablist" aria-label="接口令牌">
            <button
              type="button"
              role="tab"
              aria-selected={service.tokenPane === 'list'}
              className={service.tokenPane === 'list' ? 'is-on' : undefined}
              onClick={() => service.setTokenPane('list')}
            >
              令牌
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={service.tokenPane === 'logs'}
              className={service.tokenPane === 'logs' ? 'is-on' : undefined}
              onClick={() => service.setTokenPane('logs')}
            >
              调用日志
            </button>
          </div>

          {service.tokenPane === 'list' ? (
            <>
              <form
                className="panel"
                onSubmit={(event) => {
                  event.preventDefault();
                  void service.generateAccessToken();
                }}
              >
                <div className="field">
                  <label htmlFor="settings-token-name">名称</label>
                  <input
                    id="settings-token-name"
                    name="tokenName"
                    maxLength={ACCESS_TOKEN_NAME_MAX}
                    autoComplete="off"
                    placeholder="例如：本地脚本"
                    value={service.tokenName}
                    onChange={(event) => service.setTokenName(event.target.value)}
                    required
                  />
                </div>
                {service.accessTokenError ? (
                  <p className="banner-error" role="alert">
                    {service.accessTokenError}
                  </p>
                ) : null}
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={
                    service.$model.generateAccessToken.loading ||
                    service.accessTokens.length >= ACCESS_TOKEN_MAX_PER_USER
                  }
                >
                  {service.$model.generateAccessToken.loading ? '生成中…' : '生成令牌'}
                </button>
                {service.accessTokens.length >= ACCESS_TOKEN_MAX_PER_USER ? (
                  <p className="settings-hint">已达到 {ACCESS_TOKEN_MAX_PER_USER} 个上限。</p>
                ) : null}
              </form>

              {service.accessTokens.length === 0 ? (
                <p className="settings-hint">还没有令牌。生成后可在脚本里调用接口。</p>
              ) : (
                <ul className="config-list">
                  {service.accessTokens.map((token) => (
                    <li key={token.id} className="config-row">
                      <div>
                        <p className="config-title">{token.name}</p>
                        <p className="meta">
                          <span className="mono">{token.preview}</span>
                          {` · ${formatDate(token.createdAt)} 生成`}
                        </p>
                      </div>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={service.copyingId === token.id}
                          onClick={() => void service.copyAccessToken(token.id)}
                        >
                          {service.copyingId === token.id ? '复制中…' : '复制'}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <div className="panel token-log-panel">
              <p className="settings-hint token-log-lede">仅记录以接口令牌发起的请求，保留 7 天。</p>
              {service.accessTokenLogsError ? (
                <p className="banner-error" role="alert">
                  {service.accessTokenLogsError}
                </p>
              ) : null}
              {service.$model.loadAccessTokenLogs.loading && service.accessTokenLogs.length === 0 ? (
                <p className="empty compact">读取日志…</p>
              ) : null}
              {!service.$model.loadAccessTokenLogs.loading && service.accessTokenLogs.length === 0 ? (
                <p className="empty compact">近 7 天没有调用记录。</p>
              ) : null}
              {service.accessTokenLogs.length > 0 ? (
                <div className="token-log-wrap">
                  <table className="hist-table">
                    <thead>
                      <tr>
                        <th>时间</th>
                        <th>令牌</th>
                        <th>方法</th>
                        <th>路径</th>
                        <th>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {service.accessTokenLogs.map((log) => (
                        <tr key={log.id}>
                          <td>{formatDateTime(log.createdAt)}</td>
                          <td>{log.tokenName}</td>
                          <td className="mono">{log.method}</td>
                          <td className="mono">{log.path}</td>
                          <td>
                            <Tag
                              tone={
                                log.status >= 500
                                  ? 'fail'
                                  : log.status >= 400
                                    ? 'fail'
                                    : log.status >= 200 && log.status < 300
                                      ? 'done'
                                      : 'topic'
                              }
                            >
                              {log.status}
                            </Tag>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {service.accessTokenLogsTotal > 0 ? (
                <div className="hist-pager">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={!service.accessTokenLogsHasPrev}
                    onClick={() => void service.loadAccessTokenLogs(service.accessTokenLogsPage - 1)}
                  >
                    上一页
                  </button>
                  <span>
                    {service.accessTokenLogsPage} /{' '}
                    {Math.max(
                      1,
                      Math.ceil(service.accessTokenLogsTotal / service.accessTokenLogsLimit),
                    )}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={!service.accessTokenLogsHasNext}
                    onClick={() => void service.loadAccessTokenLogs(service.accessTokenLogsPage + 1)}
                  >
                    下一页
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="section" id="archive">
          <div className="section-title">回收站</div>
          <div className="section-lede">
            删除的文档、卡片和批注会先到这里，可以恢复；文档在 30 天后自动彻底删除，彻底删除后无法找回。
          </div>

          <div className="archive-group">
            <div className="archive-group-title">文档 · {service.archivedDocumentsTotal}</div>
            {service.archivedDocumentsError ? (
              <p className="banner-error" role="alert">
                {service.archivedDocumentsError}
              </p>
            ) : null}
            {!service.$model.loadArchivedDocuments.loading &&
            service.archivedDocuments.length === 0 ? (
              <p className="empty compact">回收站里没有文档。</p>
            ) : null}
            {service.archivedDocuments.length > 0 ? (
              <table className="hist-table">
                <thead>
                  <tr>
                    <th>标题</th>
                    <th>删除时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {service.archivedDocuments.map((doc) => (
                    <tr key={doc.id}>
                      <td>{clipArchiveText(docDisplayTitle(doc))}</td>
                      <td>{doc.deletedAt ? formatDateTime(doc.deletedAt) : '—'}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void service.restoreArchivedDocument(doc.id)}
                          >
                            恢复
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => {
                              if (
                                window.confirm(
                                  '彻底删除后文档、批注和原始文件都会被移除，无法恢复，确定吗？',
                                )
                              ) {
                                void service.destroyArchivedDocument(doc.id);
                              }
                            }}
                          >
                            彻底删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {service.archivedDocumentsTotal > 0 ? (
              <div className="hist-pager">
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={!service.archivedDocumentsHasPrev}
                  onClick={() =>
                    void service.loadArchivedDocuments(service.archivedDocumentsPage - 1)
                  }
                >
                  上一页
                </button>
                <span>
                  {service.archivedDocumentsPage} /{' '}
                  {Math.max(
                    1,
                    Math.ceil(service.archivedDocumentsTotal / service.archivedDocumentsLimit),
                  )}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={!service.archivedDocumentsHasNext}
                  onClick={() =>
                    void service.loadArchivedDocuments(service.archivedDocumentsPage + 1)
                  }
                >
                  下一页
                </button>
              </div>
            ) : null}
          </div>

          <div className="archive-group">
            <div className="archive-group-title">卡片 · {service.archivedCardsTotal}</div>
            {service.archivedCardsError ? (
              <p className="banner-error" role="alert">
                {service.archivedCardsError}
              </p>
            ) : null}
            {!service.$model.loadArchivedCards.loading && service.archivedCards.length === 0 ? (
              <p className="empty compact">回收站里没有卡片。</p>
            ) : null}
            {service.archivedCards.length > 0 ? (
              <table className="hist-table">
                <thead>
                  <tr>
                    <th>概念</th>
                    <th>来源文档</th>
                    <th>删除时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {service.archivedCards.map((card) => (
                    <tr key={card.id}>
                      <td>{clipArchiveText(card.concept)}</td>
                      <td>{card.documentTitle ?? '（文档已删除）'}</td>
                      <td>{card.deletedAt ? formatDateTime(card.deletedAt) : '—'}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void service.restoreArchivedCard(card.id)}
                          >
                            恢复
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => {
                              if (window.confirm('彻底删除后无法恢复，确定吗？')) {
                                void service.destroyArchivedCard(card.id);
                              }
                            }}
                          >
                            彻底删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {service.archivedCardsTotal > 0 ? (
              <div className="hist-pager">
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={!service.archivedCardsHasPrev}
                  onClick={() => void service.loadArchivedCards(service.archivedCardsPage - 1)}
                >
                  上一页
                </button>
                <span>
                  {service.archivedCardsPage} /{' '}
                  {Math.max(1, Math.ceil(service.archivedCardsTotal / service.archivedCardsLimit))}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={!service.archivedCardsHasNext}
                  onClick={() => void service.loadArchivedCards(service.archivedCardsPage + 1)}
                >
                  下一页
                </button>
              </div>
            ) : null}
          </div>

          <div className="archive-group">
            <div className="archive-group-title">批注 · {service.archivedAnnotationsTotal}</div>
            {service.archivedAnnotationsError ? (
              <p className="banner-error" role="alert">
                {service.archivedAnnotationsError}
              </p>
            ) : null}
            {!service.$model.loadArchivedAnnotations.loading &&
            service.archivedAnnotations.length === 0 ? (
              <p className="empty compact">回收站里没有批注。</p>
            ) : null}
            {service.archivedAnnotations.length > 0 ? (
              <table className="hist-table">
                <thead>
                  <tr>
                    <th>内容</th>
                    <th>来源文档</th>
                    <th>删除时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {service.archivedAnnotations.map((item) => (
                    <tr key={item.id}>
                      <td>{clipArchiveText(item.note.trim() || item.quote)}</td>
                      <td>{item.documentTitle ?? '（文档已删除）'}</td>
                      <td>{item.deletedAt ? formatDateTime(item.deletedAt) : '—'}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void service.restoreArchivedAnnotation(item.id)}
                          >
                            恢复
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => {
                              if (window.confirm('彻底删除后无法恢复，确定吗？')) {
                                void service.destroyArchivedAnnotation(item.id);
                              }
                            }}
                          >
                            彻底删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {service.archivedAnnotationsTotal > 0 ? (
              <div className="hist-pager">
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={!service.archivedAnnotationsHasPrev}
                  onClick={() =>
                    void service.loadArchivedAnnotations(service.archivedAnnotationsPage - 1)
                  }
                >
                  上一页
                </button>
                <span>
                  {service.archivedAnnotationsPage} /{' '}
                  {Math.max(
                    1,
                    Math.ceil(service.archivedAnnotationsTotal / service.archivedAnnotationsLimit),
                  )}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={!service.archivedAnnotationsHasNext}
                  onClick={() =>
                    void service.loadArchivedAnnotations(service.archivedAnnotationsPage + 1)
                  }
                >
                  下一页
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {service.toast ? (
        <p className="toast" role="status">
          {service.toast}
        </p>
      ) : null}
    </div>
  );
});

export const SettingsPage = bindServices(SettingsPageContent, [SettingsService]);
