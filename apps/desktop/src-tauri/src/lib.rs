mod capture;

use tauri::Emitter;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    let mods = Modifiers::META.union(Modifiers::SHIFT);
    #[cfg(not(target_os = "macos"))]
    let mods = Modifiers::CONTROL.union(Modifiers::SHIFT);
    let shortcut = Shortcut::new(Some(mods), Code::Digit2);
    let shortcut_for_handler = shortcut;

    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, sc, event| {
                    if event.state == ShortcutState::Pressed && *sc == shortcut_for_handler {
                        spawn_capture(app, "screenshot-captured");
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![capture_region, clipboard_image])
        .menu(build_menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "reload" => reload_main(app),
            "screenshot" => spawn_capture(app, "screenshot-captured"),
            "clipboard" => spawn_clipboard(app),
            _ => {}
        })
        .setup(move |app| {
            install_tray(app)?;
            app.global_shortcut().register(shortcut)?;
            Ok(())
        })
        .on_window_event(on_window_event)
        .build(tauri::generate_context!())
        .expect("error while running Inwit")
        .run(on_run_event);
}

#[tauri::command]
async fn capture_region(app: tauri::AppHandle) -> Result<Option<String>, String> {
    hide_main(&app);
    std::thread::sleep(std::time::Duration::from_millis(120));
    let result = tauri::async_runtime::spawn_blocking(capture::capture_region_png)
        .await
        .map_err(|err| err.to_string())?;
    show_main(&app);
    result.map(|bytes| bytes.map(capture::encode_png))
}

#[tauri::command]
async fn clipboard_image() -> Result<Option<String>, String> {
    let result = tauri::async_runtime::spawn_blocking(capture::clipboard_png_bytes)
        .await
        .map_err(|err| err.to_string())?;
    result.map(|bytes| bytes.map(capture::encode_png))
}

fn spawn_capture(app: &tauri::AppHandle, event: &'static str) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match capture_region(app.clone()).await {
            Ok(Some(b64)) => {
                let _ = app.emit(event, b64);
            }
            Ok(None) => {}
            Err(err) => {
                let _ = app.emit("screenshot-failed", err);
            }
        }
    });
}

fn spawn_clipboard(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match clipboard_image().await {
            Ok(Some(b64)) => {
                let _ = app.emit("screenshot-captured", b64);
            }
            Ok(None) => {
                let _ = app.emit("screenshot-failed", "剪贴板里没有图片");
            }
            Err(err) => {
                let _ = app.emit("screenshot-failed", err);
            }
        }
    });
}

fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    #[cfg(target_os = "macos")]
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (window, event);
}

fn on_run_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
    #[cfg(target_os = "macos")]
    if let tauri::RunEvent::Reopen {
        has_visible_windows,
        ..
    } = event
    {
        if !has_visible_windows {
            show_main(app);
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, event);
}

fn hide_main(app: &tauri::AppHandle) {
    if let Some(window) = tauri::Manager::get_webview_window(app, "main") {
        let _ = window.hide();
    }
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = tauri::Manager::get_webview_window(app, "main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn reload_main(app: &tauri::AppHandle) {
    if let Some(window) = tauri::Manager::get_webview_window(app, "main") {
        let _ = window.reload();
    }
}

fn build_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};

    let about = AboutMetadata {
        name: Some("Inwit".into()),
        ..Default::default()
    };
    let reload = MenuItem::with_id(app, "reload", "重新加载", true, Some("CmdOrCtrl+R"))?;
    let screenshot = MenuItem::with_id(
        app,
        "screenshot",
        "截图捕捉",
        true,
        Some("CmdOrCtrl+Shift+2"),
    )?;
    let clipboard = MenuItem::with_id(app, "clipboard", "从剪贴板捕捉", true, None::<&str>)?;
    let edit = Submenu::with_items(
        app,
        "编辑",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("撤销"))?,
            &PredefinedMenuItem::redo(app, Some("重做"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("剪切"))?,
            &PredefinedMenuItem::copy(app, Some("复制"))?,
            &PredefinedMenuItem::paste(app, Some("粘贴"))?,
            &PredefinedMenuItem::select_all(app, Some("全选"))?,
        ],
    )?;
    let capture = Submenu::with_items(app, "捕捉", true, &[&screenshot, &clipboard])?;
    let view = Submenu::with_items(
        app,
        "显示",
        true,
        &[
            &reload,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, Some("全屏"))?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "窗口",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("最小化"))?,
            &PredefinedMenuItem::maximize(app, Some("缩放"))?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some("关闭窗口"))?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    {
        let app_menu = Submenu::with_items(
            app,
            "Inwit",
            true,
            &[
                &PredefinedMenuItem::about(app, Some("关于 Inwit"), Some(about))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::services(app, Some("服务"))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, Some("隐藏 Inwit"))?,
                &PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?,
                &PredefinedMenuItem::show_all(app, Some("全部显示"))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, Some("退出 Inwit"))?,
            ],
        )?;
        return Menu::with_items(app, &[&app_menu, &capture, &edit, &view, &window]);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let file = Submenu::with_items(
            app,
            "文件",
            true,
            &[
                &PredefinedMenuItem::close_window(app, Some("关闭窗口"))?,
                &PredefinedMenuItem::quit(app, Some("退出"))?,
            ],
        )?;
        let help = Submenu::with_items(
            app,
            "帮助",
            true,
            &[&PredefinedMenuItem::about(
                app,
                Some("关于 Inwit"),
                Some(about),
            )?],
        )?;
        Menu::with_items(app, &[&file, &capture, &edit, &view, &window, &help])
    }
}

fn install_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::image::Image;
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::Manager;

    let show = MenuItem::with_id(app, "show", "打开 Inwit", true, None::<&str>)?;
    let screenshot = MenuItem::with_id(app, "screenshot", "截图捕捉", true, None::<&str>)?;
    let clipboard = MenuItem::with_id(app, "clipboard", "从剪贴板捕捉", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &screenshot, &clipboard, &quit])?;
    let icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    let tray = TrayIconBuilder::with_id("tray")
        .icon(icon)
        .icon_as_template(true)
        .tooltip("Inwit")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main(app),
            "screenshot" => spawn_capture(app, "screenshot-captured"),
            "clipboard" => spawn_clipboard(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    app.manage(tray);
    Ok(())
}
