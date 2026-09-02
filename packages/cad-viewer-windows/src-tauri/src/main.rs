#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
    sync::Mutex,
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::{ipc::Response, AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct DesktopState {
    initial_file: Mutex<Option<String>>,
}

fn normalize_cad_path(path: impl AsRef<Path>) -> Option<String> {
    let path = path.as_ref();
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().ok()?.join(path)
    };

    if !absolute.is_file() {
        return None;
    }

    let extension = absolute
        .extension()
        .and_then(OsStr::to_str)
        .map(str::to_ascii_lowercase)?;

    if extension != "dwg" && extension != "dxf" {
        return None;
    }

    Some(absolute.to_string_lossy().into_owned())
}

fn cad_path_from_args<I, S>(args: I) -> Option<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    args.into_iter()
        .find_map(|value| normalize_cad_path(PathBuf::from(value.as_ref())))
}

#[tauri::command]
fn desktop_pick_cad_file() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Open CAD drawing")
        .add_filter("CAD drawings", &["dwg", "dxf"])
        .pick_file()
        .and_then(normalize_cad_path)
}

#[tauri::command]
fn desktop_initial_cad_file(state: State<'_, DesktopState>) -> Option<String> {
    state.initial_file.lock().ok()?.take()
}

#[tauri::command]
fn desktop_read_cad_file(path: String) -> Result<Response, String> {
    let path = normalize_cad_path(path)
        .ok_or_else(|| "CAD file does not exist or is not a DWG/DXF drawing".to_string())?;
    let bytes = std::fs::read(&path).map_err(|error| format!("Failed to read {path}: {error}"))?;
    Ok(Response::new(bytes))
}

#[tauri::command]
fn desktop_save_export_file(
    default_name: String,
    extension: String,
    data_base64: String,
) -> Result<Option<String>, String> {
    let extension = extension.trim_start_matches('.').to_ascii_lowercase();
    let filter_name = match extension.as_str() {
        "pdf" => "PDF document",
        "svg" => "SVG image",
        "html" | "htm" => "HTML document",
        _ => return Err(format!("Unsupported export format: {extension}")),
    };

    let safe_name = Path::new(&default_name)
        .file_name()
        .and_then(OsStr::to_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("export");

    let mut path = match rfd::FileDialog::new()
        .set_title("Save exported drawing")
        .add_filter(filter_name, &[extension.as_str()])
        .set_file_name(safe_name)
        .save_file()
    {
        Some(path) => path,
        None => return Ok(None),
    };

    let has_expected_extension = path
        .extension()
        .and_then(OsStr::to_str)
        .map(|value| value.eq_ignore_ascii_case(&extension))
        .unwrap_or(false);
    if !has_expected_extension {
        path.set_extension(&extension);
    }

    let bytes = STANDARD
        .decode(data_base64)
        .map_err(|error| format!("Failed to decode exported {extension} data: {error}"))?;

    std::fs::write(&path, bytes)
        .map_err(|error| format!("Failed to save {}: {error}", path.display()))?;

    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
fn desktop_set_window_title(app: AppHandle, title: String) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window is not available".to_string())?;

    window
        .set_title(&title)
        .map_err(|error| format!("Failed to set window title: {error}"))
}

fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn main() {
    let initial_file = cad_path_from_args(std::env::args_os().skip(1));

    tauri::Builder::default()
        // Keep this first: Tauri requires the single-instance plugin to be
        // registered before other plugins so forwarded Explorer opens are
        // delivered reliably to the already-running process.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            focus_main_window(app);

            if let Some(path) = cad_path_from_args(args.iter().skip(1)) {
                let _ = app.emit("desktop-open-file", path);
            }
        }))
        .manage(DesktopState {
            initial_file: Mutex::new(initial_file),
        })
        .invoke_handler(tauri::generate_handler![
            desktop_pick_cad_file,
            desktop_initial_cad_file,
            desktop_read_cad_file,
            desktop_save_export_file,
            desktop_set_window_title
        ])
        .run(tauri::generate_context!())
        .expect("error while running CAD Viewer for Windows");
}
