#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod disk;
mod agent;
mod settings;
mod chatgpt;
mod updater;
mod debugger;
mod html_preview;
mod previews;
mod launch;
use disk::together;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

#[derive(Default)]
struct ClosePermission {
    allowed: AtomicBool,
    ready: AtomicBool,
}

#[tauri::command]
fn enable_close_guard(permission: tauri::State<ClosePermission>) {
    permission.ready.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn finish_close(app: tauri::AppHandle, allowed: tauri::State<ClosePermission>) -> Result<(), String> {
    allowed.allowed.store(true, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("main") {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn chat_link_url(target: &str) -> Result<&'static str, String> {
    match target {
        "billing" => Ok("https://platform.openai.com/settings/organization/billing/overview"),
        "students" => Ok("https://chatgpt.com/codex/offers/students"),
        "usage" => Ok("https://chatgpt.com/settings/usage"),
        "account" => Ok("https://chatgpt.com/#settings"),
        _ => Err("Unknown ChatLGBT link.".into()),
    }
}

#[tauri::command]
fn open_chat_link(target: String) -> Result<(), String> {
    let url = chat_link_url(&target)?;
    open_browser(url)
}

fn open_browser(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        // Callers validate fixed HTTPS links or authorized HTML file URLs.
        #[link(name = "shell32")]
        extern "system" {
            fn ShellExecuteW(hwnd: *mut std::ffi::c_void, operation: *const u16, file: *const u16,
                parameters: *const u16, directory: *const u16, show: i32) -> isize;
        }
        let operation: Vec<u16> = "open\0".encode_utf16().collect();
        let address: Vec<u16> = url.encode_utf16().chain(std::iter::once(0)).collect();
        let result = unsafe { ShellExecuteW(std::ptr::null_mut(), operation.as_ptr(), address.as_ptr(),
            std::ptr::null(), std::ptr::null(), 1) };
        if result <= 32 { return Err("Windows could not open the default browser.".into()); }
        Ok(())
    }
    #[cfg(not(windows))]
    { let _ = url; Err("Opening external links is supported in the Windows app.".into()) }
}

#[cfg(test)]
mod link_tests {
    #[test]
    fn only_known_chat_links_can_be_opened() {
        assert_eq!(super::chat_link_url("billing").unwrap(), "https://platform.openai.com/settings/organization/billing/overview");
        assert_eq!(super::chat_link_url("students").unwrap(), "https://chatgpt.com/codex/offers/students");
        for target in ["https://example.com", "file:///C:/Windows", "billing&calc", "", "Students"] {
            assert!(super::chat_link_url(target).is_err());
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app,args,cwd| {
            launch::enqueue(app,args,std::path::Path::new(&cwd));
            if let Some(window)=app.get_webview_window("main"){let _=window.unminimize();let _=window.show();let _=window.set_focus();}
        }))
        .manage(ClosePermission::default())
        .manage(agent::AgentState::default())
        .manage(together::TogetherState::default())
        .manage(updater::UpdateState::default())
        .manage(previews::PreviewState::default())
        .manage(launch::LaunchState::default())
        .setup(|app| {
            let config = app.path().app_config_dir()?;
            app.manage(settings::SettingsState { path: config.join("settings.json"), writes: std::sync::Mutex::new(()) });
            app.manage(chatgpt::ChatGptState::new(config.join("chatgpt-accounts.dpapi")));
            app.manage(disk::DiskState::load(config));
            launch::enqueue(app.handle(),std::env::args().collect(),&std::env::current_dir().unwrap_or_default());
            app.manage(debugger::DebuggerState::new(app.path().app_config_dir()?.join("debugger")));
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed=event {window.state::<debugger::DebuggerState>().shutdown();window.state::<previews::PreviewState>().shutdown();}
            if let tauri::WindowEvent::DragDrop(drop) = event {
                match drop {
                    tauri::DragDropEvent::Enter { .. } => { let _=window.emit("bluegay-file-drag",true); }
                    tauri::DragDropEvent::Leave => { let _=window.emit("bluegay-file-drag",false); }
                    tauri::DragDropEvent::Drop { paths, .. } => {
                        let _=window.emit("bluegay-file-drag",false);
                        match window.state::<disk::DiskState>().queue_drop(paths) {
                            Ok(id) => { let _=window.emit("bluegay-files-dropped",id); }
                            Err(error) => { let _=window.emit("bluegay-drop-error",error); }
                        }
                    }
                    _ => {}
                }
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let permission = window.state::<ClosePermission>();
                if permission.ready.load(Ordering::SeqCst) && !permission.allowed.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.emit("bluegay-close-requested", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            disk::open_folder, disk::open_files, disk::open_dropped_paths, disk::read_document,
            disk::save_document, disk::save_document_as, disk::create_folder,
            disk::rename_document, disk::trash_document, disk::export_bytes,
            disk::refresh_workspace, disk::trash_folder,
            enable_close_guard, finish_close, open_chat_link,
            settings::load_settings, settings::save_settings,
            debugger::debugger_request,
            html_preview::open_html, html_preview::open_html_preview,
            previews::preview_workspace, previews::close_preview, previews::read_preview_asset,
            launch::take_launch_requests,
            updater::update_info, updater::update_source, updater::update_check,
            updater::update_prepare, updater::update_install,
            together::together_start, together::together_stop,
            together::together_permissions, together::together_request,
            together::together_host_poll,
            agent::agent_status, agent::agent_set_key, agent::agent_delete_key,
            agent::agent_respond, agent::agent_cancel
            ,chatgpt::chatgpt_status, chatgpt::chatgpt_login, chatgpt::chatgpt_cancel,
            chatgpt::chatgpt_select, chatgpt::chatgpt_logout, chatgpt::chatgpt_models
        ])
        .run(tauri::generate_context!())
        .expect("Could not start BlueGay");
}
