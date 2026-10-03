import { observer, useService } from '@rabjs/react';
import type { StorageFileKind } from '@inwit/dto';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { Tag } from '@/components/tag';
import { formatDateTime } from '@/lib/format';
import { SettingsService } from './settings.service';
import { FilesService } from './files.service';
import {
  FILE_KIND_LABEL,
  FILE_REF_LABEL,
  fileIsArchived,
  filePrimaryLabel,
  fileRefHref,
  formatFileSize,
} from './files-view';

const KIND_FILTERS: Array<{ id: 'all' | StorageFileKind; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'source', label: '原文' },
  { id: 'media', label: '正文媒体' },
  { id: 'excerpt', label: '摘录' },
  { id: 'avatar', label: '头像' },
];

export const FilesSection = observer(function FilesSection() {
  const settings = useService(SettingsService);
  const files = useService(FilesService);
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (settings.section === 'files') {
      files.ensureLoaded();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) files.ensureLoaded();
      },
      { rootMargin: '240px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [settings.section, files]);

  const showList = files.ready && files.configured && files.summary.totalCount > 0;

  return (
    <section className="section" id="files" ref={rootRef}>
      <div className="section-title">文件</div>
      <div className="section-lede">
        这个账号放在对象存储里的原文、正文图片和视频、摘录图、头像。这里只查看，不删除。
      </div>

      {files.error ? (
        <p className="banner-error" role="alert">
          {files.error}
        </p>
      ) : null}

      {!files.ready && !files.error ? <p className="empty compact">正在读取文件…</p> : null}

      {files.ready && !files.configured ? (
        <p className="empty compact">暂时读不到文件。对象存储还没有配置。</p>
      ) : null}

      {files.ready && files.configured && files.summary.totalCount === 0 ? (
        <p className="empty compact">还没有上传过文件。</p>
      ) : null}

      {showList ? (
        <>
          <div className="file-summary">
            <button
              type="button"
              className={files.kind === 'all' ? 'is-on' : undefined}
              onClick={() => files.setKind('all')}
            >
              <span className="file-stat-label">全部</span>
              <strong>{files.summary.totalCount}</strong>
              <em>{formatFileSize(files.summary.totalBytes)}</em>
            </button>
            {KIND_FILTERS.filter((item) => item.id !== 'all').map((item) => {
              const kind = item.id as StorageFileKind;
              const stat = files.summary.byKind[kind];
              return (
                <button
                  key={item.id}
                  type="button"
                  className={files.kind === kind ? 'is-on' : undefined}
                  onClick={() => files.setKind(kind)}
                >
                  <span className="file-stat-label">{item.label}</span>
                  <strong>{stat.count}</strong>
                  <em>{formatFileSize(stat.bytes)}</em>
                </button>
              );
            })}
          </div>

          <div className="file-toolbar">
            <label className="check">
              <input
                type="checkbox"
                checked={files.unusedOnly}
                onChange={(event) => files.setUnusedOnly(event.target.checked)}
              />
              只看未使用
            </label>
            <label className="file-sort">
              排序
              <select
                value={files.sort}
                onChange={(event) => files.setSort(event.target.value === 'size' ? 'size' : 'modified')}
              >
                <option value="modified">最近修改</option>
                <option value="size">体积从大到小</option>
              </select>
            </label>
            <button type="button" className="btn btn-ghost" onClick={() => files.refresh()}>
              刷新
            </button>
          </div>

          {files.truncated ? (
            <p className="settings-hint">文件较多，这次没有列全。</p>
          ) : null}

          {files.loading && files.items.length === 0 ? (
            <p className="empty compact">正在读取文件…</p>
          ) : null}

          {files.items.length === 0 && !files.loading ? (
            <p className="empty compact">没有符合条件的文件。</p>
          ) : null}

          <div className="file-list">
            {files.items.map((item) => {
              const open = files.selectedKey === item.key;
              const label = filePrimaryLabel(item);
              return (
                <div key={item.key} className="file-item">
                  <button
                    type="button"
                    className={open ? 'file-row is-on' : 'file-row'}
                    aria-expanded={open}
                    onClick={() => files.toggleSelected(item.key)}
                  >
                    <span className="file-thumb">
                      {item.preview === 'image' && item.previewUrl ? (
                        <img src={item.previewUrl} alt="" />
                      ) : (
                        <span>{item.preview === 'video' ? '视频' : item.ext.toUpperCase() || '文件'}</span>
                      )}
                    </span>
                    <span className="file-copy">
                      <span className="file-name">{label}</span>
                      <span className="file-meta">
                        {FILE_KIND_LABEL[item.kind]} · {formatFileSize(item.sizeBytes)} ·{' '}
                        {item.modifiedAt ? formatDateTime(item.modifiedAt) : '—'}
                      </span>
                    </span>
                    <span className="file-tags">
                      {item.unused ? <Tag>未使用</Tag> : null}
                      {fileIsArchived(item) ? <Tag tone="busy">回收站</Tag> : null}
                    </span>
                  </button>
                  {open ? (
                    <div className="file-detail">
                      {item.preview === 'image' && item.previewUrl ? (
                        <div className="file-preview">
                          <img src={item.previewUrl} alt={label} />
                        </div>
                      ) : null}
                      {item.preview === 'video' && item.previewUrl ? (
                        <div className="file-preview">
                          <video src={item.previewUrl} controls preload="metadata" />
                        </div>
                      ) : null}
                      <dl className="file-meta-list">
                        <div>
                          <dt>类型</dt>
                          <dd>
                            {FILE_KIND_LABEL[item.kind]}
                            {item.ext ? ` · ${item.ext.toUpperCase()}` : ''}
                          </dd>
                        </div>
                        <div>
                          <dt>大小</dt>
                          <dd>{formatFileSize(item.sizeBytes)}</dd>
                        </div>
                        <div>
                          <dt>修改时间</dt>
                          <dd>{item.modifiedAt ? formatDateTime(item.modifiedAt) : '—'}</dd>
                        </div>
                        <div>
                          <dt>对象键</dt>
                          <dd className="file-key">{item.key}</dd>
                        </div>
                      </dl>
                      {item.refs.length === 0 ? (
                        <p className="settings-hint">没有文档、卡片或头像引用这个文件。</p>
                      ) : (
                        <ul className="file-refs">
                          {item.refs.map((ref) => {
                            const href = fileRefHref(ref);
                            const text = `${FILE_REF_LABEL[ref.type]} · ${ref.title}`;
                            return (
                              <li key={`${ref.type}:${ref.id}`}>
                                {href ? <Link to={href}>{text}</Link> : <span>{text}</span>}
                                {ref.archived ? <Tag tone="busy">回收站</Tag> : null}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {files.total > 0 ? (
            <div className="hist-pager">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!files.hasPrev || files.loading}
                onClick={() => files.loadPage(files.page - 1)}
              >
                上一页
              </button>
              <span>
                {files.page} / {files.pageCount}
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!files.hasNext || files.loading}
                onClick={() => files.loadPage(files.page + 1)}
              >
                下一页
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
});
