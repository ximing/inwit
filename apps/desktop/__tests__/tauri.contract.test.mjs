import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

describe('Tauri desktop contract', () => {
  const conf = JSON.parse(read('src-tauri/tauri.conf.json'));
  const cargo = read('src-tauri/Cargo.toml');
  const lib = read('src-tauri/src/lib.rs');
  const caps = JSON.parse(read('src-tauri/capabilities/default.json'));
  const pkg = JSON.parse(read('package.json'));

  it('wraps apps/web on 5190 with identifier plus.aimo.inwit', () => {
    assert.equal(conf.identifier, 'plus.aimo.inwit');
    assert.equal(conf.productName, 'Inwit');
    assert.equal(conf.build.devUrl, 'http://localhost:5190');
    assert.equal(conf.build.frontendDist, '../../web/dist');
  });

  it('uses a 1280x800 window, min 960x640, paper-light titlebar', () => {
    const win = conf.app.windows[0];
    assert.equal(win.label, 'main');
    assert.equal(win.width, 1280);
    assert.equal(win.height, 800);
    assert.equal(win.minWidth, 960);
    assert.equal(win.minHeight, 640);
    assert.equal(win.theme, 'Light');
    assert.equal(win.backgroundColor, '#F6F3EC');
  });

  it('registers plugin-http, plugin-store, window-state, notification, and global-shortcut', () => {
    assert.match(lib, /tauri_plugin_http::init/);
    assert.match(lib, /tauri_plugin_store::Builder/);
    assert.match(lib, /tauri_plugin_window_state::Builder/);
    assert.match(lib, /tauri_plugin_notification::init/);
    assert.match(lib, /tauri_plugin_global_shortcut/);
    assert.match(cargo, /tauri-plugin-http/);
    assert.match(cargo, /tauri-plugin-store/);
    assert.match(cargo, /tauri-plugin-window-state/);
    assert.match(cargo, /tauri-plugin-notification/);
    assert.match(cargo, /tauri-plugin-global-shortcut/);
    assert.match(cargo, /unsafe-headers/);
    assert.doesNotMatch(cargo, /features = \[[^\]]*cookies/);
  });

  it('registers a native menu with Cmd/Ctrl+R reload, screenshot capture, and edit shortcuts', () => {
    assert.match(lib, /\.menu\(build_menu\)/);
    assert.match(lib, /CmdOrCtrl\+R/);
    assert.match(lib, /重新加载/);
    assert.match(lib, /截图捕捉/);
    assert.match(lib, /window\.reload\(\)/);
    assert.match(lib, /PredefinedMenuItem::copy/);
    assert.match(lib, /PredefinedMenuItem::paste/);
    assert.match(lib, /PredefinedMenuItem::undo/);
    assert.match(lib, /PredefinedMenuItem::select_all/);
    assert.match(lib, /PredefinedMenuItem::quit/);
  });

  it('on macOS, the red close button hides instead of quitting', () => {
    assert.match(lib, /CloseRequested/);
    assert.match(lib, /prevent_close/);
    assert.match(lib, /window\.hide\(\)/);
    assert.match(lib, /RunEvent::Reopen/);
    assert.match(lib, /target_os = "macos"/);
    assert.match(lib, /StateFlags::VISIBLE/);
  });

  it('puts a template tray icon in the macOS menu bar', () => {
    assert.match(lib, /TrayIconBuilder/);
    assert.match(lib, /icon_as_template\(true\)/);
    assert.match(lib, /icons\/tray\.png/);
    assert.match(cargo, /tray-icon/);
    assert.match(cargo, /image-png/);
    assert.ok(read('src-tauri/icons/tray.png').length > 0);
  });

  it('allows native HTTP to the API and https (S3), and IPC from Vite', () => {
    const http = caps.permissions.find(
      (p) => typeof p === 'object' && p.identifier === 'http:default',
    );
    assert.ok(http);
    const urls = http.allow.map((a) => a.url);
    assert.ok(urls.includes('http://127.0.0.1:3020/*'));
    assert.ok(urls.includes('http://localhost:3020/*'));
    assert.ok(urls.some((u) => u.startsWith('https://')));
    assert.ok(caps.permissions.includes('store:default'));
    assert.ok(caps.permissions.includes('window-state:default'));
    assert.ok(caps.permissions.includes('notification:default'));
    assert.ok(caps.permissions.includes('global-shortcut:default'));
    assert.ok(caps.remote.urls.includes('http://localhost:5190/*'));
  });

  it('ad-hoc signs macOS bundles so Apple Silicon is not marked damaged', () => {
    assert.equal(conf.bundle.macOS.signingIdentity, '-');
  });

  it('bundles raster icons', () => {
    for (const icon of [
      'icons/16x16.png',
      'icons/32x32.png',
      'icons/128x128.png',
      'icons/128x128@2x.png',
      'icons/256x256.png',
      'icons/icon.png',
      'icons/icon.icns',
      'icons/icon.ico',
    ]) {
      assert.ok(conf.bundle.icon.includes(icon), icon);
    }
  });

  it('depends on the web workspace package and tauri plugins', () => {
    assert.equal(pkg.dependencies['@inwit/web'], 'workspace:*');
    assert.ok(pkg.dependencies['@tauri-apps/plugin-http']);
    assert.ok(pkg.dependencies['@tauri-apps/plugin-store']);
  });

  it('builds web workspace packages before bundling', () => {
    assert.match(conf.build.beforeBuildCommand, /@inwit\/web\.\.\./);
  });

  it('has a GitHub workflow that builds Windows, macOS, Linux, and an Android APK', () => {
    const workflow = read('../../.github/workflows/desktop-build.yml');
    assert.match(workflow, /windows-latest/);
    assert.match(workflow, /macos-latest/);
    assert.match(workflow, /ubuntu-22\.04/);
    assert.match(workflow, /tauri-apps\/tauri-action@v1/);
    assert.match(workflow, /projectPath: apps\/desktop/);
    assert.match(workflow, /VITE_TAURI_API_URL/);
    assert.match(workflow, /INWIT_API_URL/);
    assert.match(workflow, /EXPO_PUBLIC_API_BASE_URL/);
    assert.match(workflow, /inwit\.aimo\.plus/);
    assert.match(workflow, /\[platform\]-\[arch\]-\[bundle\]/);
    assert.match(workflow, /assembleRelease/);
    assert.match(workflow, /expo prebuild --platform android/);
  });

  it('has a GitHub workflow that pushes the server image to GHCR', () => {
    const workflow = read('../../.github/workflows/docker-build.yml');
    assert.match(workflow, /inwit-server/);
    assert.match(workflow, /apps\/server\/Dockerfile/);
    assert.match(workflow, /ghcr.io/);
  });
});
