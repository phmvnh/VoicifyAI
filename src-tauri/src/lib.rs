mod ai_summary;
mod audio_capture;
mod google_auth;
mod meeting_archive;

use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(audio_capture::CaptureManager::default())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().map_err(|error| {
                format!("Không xác định được thư mục dữ liệu ứng dụng: {error}")
            })?;
            app.manage(Arc::new(ai_summary::SummarySettingsStore::new(
                app_data_dir.clone(),
            )));
            app.manage(Arc::new(meeting_archive::MeetingArchiveStore::new(
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
            meeting_archive::open_archive_url,
        ])
        .run(tauri::generate_context!())
        .expect("không thể chạy ứng dụng VoicifyAI");
}
