import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

const PERMISSIONS = [
  'core:event:allow-listen',
  'core:event:allow-unlisten',
  'core:window:allow-set-theme',
  'core:window:allow-set-background-color',
];

describe('Tauri desktop contract', () => {
  const conf = JSON.parse(read('src-tauri/tauri.conf.json'));
  const cargo = read('src-tauri/Cargo.toml');
  const lib = read('src-tauri/src/lib.rs');
  const caps = JSON.parse(read('src-tauri/capabilities/default.json'));
  const pkg = JSON.parse(read('package.json'));
  const native = read('../web/src/platform/native.ts');

  it('loads the dev server and the remote production site', () => {
    assert.equal(conf.identifier, 'plus.aimo.inwit');
    assert.equal(conf.productName, 'Inwit');
    assert.equal(conf.build.devUrl, 'http://localhost:5190');
    assert.equal(conf.build.frontendDist, 'https://inwit.aimo.plus');
    assert.equal(conf.build.beforeBuildCommand, undefined);
    assert.equal(conf.build.beforeDevCommand, 'node scripts/before-dev.mjs');
    assert.equal(conf.app.withGlobalTauri, false);
  });

  it('uses a 1280x800 window, min 960x640, and the default system titlebar', () => {
    const win = conf.app.windows[0];
    assert.equal(win.label, 'main');
    assert.equal(win.create, false);
    assert.equal(win.width, 1280);
    assert.equal(win.height, 800);
    assert.equal(win.minWidth, 960);
    assert.equal(win.minHeight, 640);
    assert.equal(win.theme, undefined);
    assert.equal(win.backgroundColor, undefined);
    assert.notEqual(win.decorations, false);
    assert.notEqual(win.titleBarStyle, 'Overlay');
    assert.notEqual(win.hiddenTitle, true);
  });

  it('keeps window-state, global-shortcut, and tray-icon, and drops bearer plugins', () => {
    for (const name of [
      'tauri-plugin-http',
      'tauri_plugin_http',
      'tauri-plugin-store',
      'tauri_plugin_store',
      'tauri-plugin-notification',
      'tauri_plugin_notification',
      'unsafe-headers',
    ]) {
      assert.doesNotMatch(lib, new RegExp(name));
      assert.doesNotMatch(cargo, new RegExp(name));
    }
    assert.match(lib, /tauri_plugin_window_state::Builder/);
    assert.match(lib, /tauri_plugin_global_shortcut/);
    assert.match(cargo, /tauri-plugin-window-state/);
    assert.match(cargo, /tauri-plugin-global-shortcut/);
    assert.match(cargo, /tray-icon/);
    assert.match(lib, /TrayIconBuilder/);
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

  it('allows only listen, unlisten, and titlebar theme on the local app URL', () => {
    assert.equal(caps.local, true);
    assert.equal(caps.remote, undefined);
    assert.deepEqual(caps.permissions, PERMISSIONS);
    const serialized = JSON.stringify(caps);
    for (const forbidden of [
      'core:default',
      'window-state:default',
      'global-shortcut:default',
      'store:default',
      'notification:default',
      'http:default',
      'https://*/*',
      'allow-capture-region',
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
    assert.equal(existsSync(path.join(root, 'src-tauri/permissions')), false);
  });

  it('allows http and https navigation, and opens external windows only from on_new_window', () => {
    const navStart = lib.indexOf('fn navigation_allowed');
    const navEnd = lib.indexOf('fn app_home');
    assert.ok(navStart >= 0 && navEnd > navStart);
    const nav = lib.slice(navStart, navEnd);
    assert.match(nav, /url\.scheme\(\) == "tauri"/);
    assert.match(nav, /tauri\.localhost/);
    assert.match(nav, /return false/);
    assert.match(nav, /url\.scheme\(\) == "http"/);
    assert.match(nav, /url\.scheme\(\) == "https"/);
    assert.match(nav, /about:blank/);
    assert.doesNotMatch(nav, /open::that/);

    const onNav = lib.slice(lib.indexOf('.on_navigation'), lib.indexOf('.on_new_window'));
    assert.match(onNav, /navigation_allowed/);
    assert.doesNotMatch(onNav, /open::that/);
    assert.equal(lib.split('open::that').length - 1, 1);
    assert.ok(lib.indexOf('open::that') > lib.indexOf('on_new_window'));
    assert.match(lib, /NewWindowResponse::Deny/);

    assert.match(lib, /cfg!\(dev\)/);
    assert.match(lib, /dev_url/);
    assert.match(lib, /frontend_dist/);
    assert.match(lib, /window\.navigate/);
    assert.doesNotMatch(lib, /cfg!\(debug_assertions\)/);
    assert.doesNotMatch(lib, /cfg\(debug_assertions\)/);
  });

  it('shares screenshot command and event names with the web native adapter', () => {
    for (const name of [
      'capture_region',
      'clipboard_image',
      'screenshot-captured',
      'screenshot-failed',
    ]) {
      assert.match(native, new RegExp(name));
      assert.match(lib, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(lib, /剪贴板里没有图片/);
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

  it('does not depend on the web package or the bearer plugins', () => {
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    assert.equal(deps['@inwit/web'], undefined);
    assert.equal(deps['@tauri-apps/api'], undefined);
    assert.equal(deps['@tauri-apps/plugin-http'], undefined);
    assert.equal(deps['@tauri-apps/plugin-store'], undefined);
    assert.equal(deps['@tauri-apps/plugin-notification'], undefined);
    assert.equal(deps['@tauri-apps/plugin-global-shortcut'], undefined);
    assert.equal(deps['@tauri-apps/plugin-window-state'], undefined);
    assert.ok(pkg.devDependencies['@tauri-apps/cli']);
    assert.doesNotMatch(pkg.description ?? '', /VITE_TAURI_API_URL/);
    assert.doesNotMatch(pkg.description ?? '', /Bearer/);
  });

  it('has a GitHub workflow that builds Windows, macOS, Linux, and an Android APK', () => {
    const workflow = read('../../.github/workflows/desktop-build.yml');
    const desktopJob = workflow.slice(
      workflow.indexOf('  build-desktop:'),
      workflow.indexOf('  build-android:'),
    );
    assert.match(workflow, /windows-latest/);
    assert.match(workflow, /macos-latest/);
    assert.match(workflow, /ubuntu-22\.04/);
    assert.match(workflow, /tauri-apps\/tauri-action@v1/);
    assert.match(workflow, /projectPath: apps\/desktop/);
    assert.match(workflow, /secrets\.VITE_TAURI_API_URL/);
    assert.match(workflow, /vars\.VITE_TAURI_API_URL/);
    assert.doesNotMatch(desktopJob, /VITE_TAURI_API_URL/);
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
