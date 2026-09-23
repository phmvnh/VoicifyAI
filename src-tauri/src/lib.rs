mod ai_summary;
mod audio_capture;
mod google_auth;
mod meeting_archive;
mod meeting_history;

use std::sync::Arc;
use tauri::Manager;

#[cfg(all(not(debug_assertions), windows))]
use std::os::windows::process::CommandExt;
#[cfg(not(debug_assertions))]
use std::sync::Mutex;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::{process::CommandChild, ShellExt};

#[cfg(not(debug_assertions))]
struct BackendSidecar(Mutex<Option<CommandChild>>);

#[cfg(not(debug_assertions))]
fn stop_backend(child: CommandChild) {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let pid = child.pid().to_string();
        let stopped = std::process::Command::new("taskkill")
            .args(["/PID", &pid, "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .is_ok_and(|status| status.success());
        if stopped {
            return;
        }
    }

    let _ = child.kill();
}

#[cfg(not(debug_assertions))]
impl Drop for BackendSidecar {
    fn drop(&mut self) {
        if let Ok(mut backend) = self.0.lock() {
            if let Some(child) = backend.take() {
                stop_backend(child);
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(audio_capture::CaptureManager::default())
        .setup(|app| {
            // Khi chạy bản release, tự khởi động FastAPI sidecar.
            // Ở chế độ dev, scripts/dev-desktop.mjs vẫn quản lý FastAPI.
            #[cfg(not(debug_assertions))]
            {
                let command = app
                    .shell()
                    .sidecar("voicify-backend")
                    .map_err(|error| format!("Không tìm thấy backend sidecar: {error}"))?;

                let (mut events, child) = command
                    .spawn()
                    .map_err(|error| format!("Không thể khởi động backend sidecar: {error}"))?;

                app.manage(BackendSidecar(Mutex::new(Some(child))));

                // Luôn đọc event để pipe stdout/stderr của sidecar không bị đầy.
                tauri::async_runtime::spawn(async move { while events.recv().await.is_some() {} });
            }

            let app_data_dir = app.path().app_data_dir().map_err(|error| {
                format!("Không xác định được thư mục dữ liệu ứng dụng: {error}")
            })?;

            app.manage(Arc::new(ai_summary::SummarySettingsStore::new(
                app_data_dir.clone(),
            )));
            app.manage(Arc::new(meeting_archive::MeetingArchiveStore::new(
                app_data_dir.clone(),
            )));
            app.manage(Arc::new(meeting_history::MeetingHistoryStore::new(
                app_data_dir,
            )));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            audio_capture::list_microphones,
            audio_capture::start_capture,
            audio_capture::pause_capture,
            audio_capture::stop_capture,
            ai_summary::ai_summary_status,
            ai_summary::save_ai_summary_config,
            ai_summary::clear_ai_summary_config,
            ai_summary::generate_ai_summary,
            google_auth::google_auth_status,
            google_auth::google_sign_in,
            google_auth::google_cancel_sign_in,
            google_auth::google_sign_out,
            meeting_archive::archive_meeting,
            meeting_archive::prepare_archive_destinations,
            meeting_archive::archive_naming_settings,
            meeting_archive::save_archive_naming_settings,
            meeting_archive::open_archive_url,
            meeting_history::save_meeting_transcript,
            meeting_history::save_meeting_summary,
            meeting_history::list_meeting_transcripts,
            meeting_history::get_meeting_transcript,
        ])
        .build(tauri::generate_context!())
        .expect("không thể tạo ứng dụng VoicifyAI");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            #[cfg(not(debug_assertions))]
            {
                let backend = app_handle.state::<BackendSidecar>();

                let child = match backend.0.lock() {
                    Ok(mut slot) => slot.take(),
                    Err(_) => None,
                };

                if let Some(child) = child {
                    stop_backend(child);
                }
            }
        }
    });
}
