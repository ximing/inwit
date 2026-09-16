use arboard::Clipboard;
use base64::Engine;
use std::path::PathBuf;
use std::process::Command;

fn tmp_png() -> PathBuf {
    std::env::temp_dir().join(format!("inwit-shot-{}.png", std::process::id()))
}

fn read_png_file(path: &PathBuf) -> Result<Option<Vec<u8>>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(path).map_err(|err| err.to_string())?;
    let _ = std::fs::remove_file(path);
    if bytes.is_empty() {
        return Ok(None);
    }
    Ok(Some(bytes))
}

fn rgba_to_png(width: usize, height: usize, bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width as u32, height as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|err| err.to_string())?;
        writer
            .write_image_data(bytes)
            .map_err(|err| err.to_string())?;
        writer.finish().map_err(|err| err.to_string())?;
    }
    Ok(out)
}

fn clipboard_png() -> Result<Option<Vec<u8>>, String> {
    let mut clip = Clipboard::new().map_err(|err| err.to_string())?;
    match clip.get_image() {
        Ok(img) => rgba_to_png(img.width, img.height, img.bytes.as_ref()).map(Some),
        Err(_) => Ok(None),
    }
}

#[cfg(target_os = "macos")]
fn capture_region_os() -> Result<Option<Vec<u8>>, String> {
    let path = tmp_png();
    let status = Command::new("screencapture")
        .args(["-i", "-x", path.to_str().ok_or("bad temp path")?])
        .status()
        .map_err(|err| err.to_string())?;
    if !status.success() {
        let _ = std::fs::remove_file(&path);
        return Ok(None);
    }
    read_png_file(&path)
}

#[cfg(target_os = "windows")]
fn capture_region_os() -> Result<Option<Vec<u8>>, String> {
    use std::time::{Duration, Instant};

    let mut clip = Clipboard::new().map_err(|err| err.to_string())?;
    let before = clip.get_image().ok().map(|img| img.bytes.to_vec());
    let _ = Command::new("explorer")
        .arg("ms-screenclip:")
        .status()
        .map_err(|err| err.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(60);
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(250));
        if let Ok(img) = clip.get_image() {
            let bytes = img.bytes.to_vec();
            if before.as_ref() != Some(&bytes) {
                return rgba_to_png(img.width, img.height, &bytes).map(Some);
            }
        }
    }
    Ok(None)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn which(bin: &str) -> bool {
    Command::new("which")
        .arg(bin)
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn capture_region_os() -> Result<Option<Vec<u8>>, String> {
    let path = tmp_png();
    let path_str = path.to_str().ok_or("bad temp path")?;
    if which("slurp") && which("grim") {
        let geom = Command::new("slurp")
            .output()
            .map_err(|err| err.to_string())?;
        if !geom.status.success() {
            return Ok(None);
        }
        let region = String::from_utf8_lossy(&geom.stdout).trim().to_string();
        if region.is_empty() {
            return Ok(None);
        }
        let status = Command::new("grim")
            .args(["-g", &region, path_str])
            .status()
            .map_err(|err| err.to_string())?;
        if !status.success() {
            let _ = std::fs::remove_file(&path);
            return Ok(None);
        }
        return read_png_file(&path);
    }
    if which("maim") {
        let status = Command::new("maim")
            .args(["-s", path_str])
            .status()
            .map_err(|err| err.to_string())?;
        if !status.success() {
            let _ = std::fs::remove_file(&path);
            return Ok(None);
        }
        return read_png_file(&path);
    }
    if which("gnome-screenshot") {
        let status = Command::new("gnome-screenshot")
            .args(["-a", "-f", path_str])
            .status()
            .map_err(|err| err.to_string())?;
        if !status.success() {
            let _ = std::fs::remove_file(&path);
            return Ok(None);
        }
        return read_png_file(&path);
    }
    Err("未找到截图工具（grim+slurp / maim / gnome-screenshot），可用「从剪贴板捕捉」".into())
}

pub fn encode_png(bytes: Vec<u8>) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

pub fn capture_region_png() -> Result<Option<Vec<u8>>, String> {
    capture_region_os()
}

pub fn clipboard_png_bytes() -> Result<Option<Vec<u8>>, String> {
    clipboard_png()
}
