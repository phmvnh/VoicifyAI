use crate::google_auth::current_google_user_id;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::State;

const HISTORY_FILE: &str = "meeting-history.json";
const MAX_TRANSCRIPT_CHARS: usize = 500_000;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredMeeting {
    id: String,
    title: String,
    owner_google_user_id: Option<String>,
    started_at: String,
    ended_at: String,
    transcript: String,
    language: String,
    duration: f64,
    summary_text: Option<String>,
    summary_provider: Option<String>,
    summary_model: Option<String>,
    summary_status: String,
    summary_error: Option<String>,
    updated_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMeetingTranscriptInput {
    id: String,
    title: String,
    started_at: String,
    ended_at: String,
    transcript: String,
    language: String,
    duration: f64,
    updated_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMeetingSummaryInput {
    meeting_id: String,
    title: String,
    status: String,
    text: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    error: Option<String>,
    updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingPreview {
    id: String,
    title: String,
    summary_status: String,
    updated_at: String,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MeetingHistory {
    meetings: HashMap<String, StoredMeeting>,
}

pub struct MeetingHistoryStore {
    path: PathBuf,
    operation_lock: Mutex<()>,
}

impl MeetingHistoryStore {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            path: app_data_dir.join(HISTORY_FILE),
            operation_lock: Mutex::new(()),
        }
    }

    fn load(&self) -> Result<MeetingHistory, String> {
        match fs::read_to_string(&self.path) {
            Ok(json) => serde_json::from_str(&json)
                .map_err(|error| format!("Dữ liệu transcript đã lưu không hợp lệ: {error}")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(MeetingHistory::default())
            }
            Err(error) => Err(format!("Không thể đọc transcript đã lưu: {error}")),
        }
    }

    fn save(&self, history: &MeetingHistory) -> Result<(), String> {
        let parent = self
            .path
            .parent()
            .ok_or("Đường dẫn lưu transcript không hợp lệ.")?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Không thể tạo thư mục lưu transcript: {error}"))?;
        let json = serde_json::to_vec_pretty(history).map_err(|error| error.to_string())?;
        fs::write(&self.path, json).map_err(|error| format!("Không thể lưu transcript: {error}"))
    }
}

fn validate_text(value: &str, field: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{field} không được để trống."));
    }
    Ok(())
}

fn is_owned_by(meeting: &StoredMeeting, owner: &Option<String>) -> bool {
    &meeting.owner_google_user_id == owner
}

#[tauri::command]
pub fn save_meeting_transcript(
    input: SaveMeetingTranscriptInput,
    store: State<'_, Arc<MeetingHistoryStore>>,
) -> Result<StoredMeeting, String> {
    validate_text(&input.id, "Meeting ID")?;
    validate_text(&input.transcript, "Transcript")?;
    if input.transcript.chars().count() > MAX_TRANSCRIPT_CHARS {
        return Err(format!(
            "Transcript vượt quá giới hạn {MAX_TRANSCRIPT_CHARS} ký tự."
        ));
    }
    if !input.duration.is_finite() || input.duration < 0.0 {
        return Err("Thời lượng transcript không hợp lệ.".to_string());
    }

    let owner = current_google_user_id();
    let _guard = store
        .operation_lock
        .lock()
        .map_err(|_| "Kho transcript đang ở trạng thái không hợp lệ.".to_string())?;
    let mut history = store.load()?;
    if let Some(existing) = history.meetings.get(&input.id) {
        if !is_owned_by(existing, &owner) {
            return Err("Transcript này thuộc tài khoản khác.".to_string());
        }
    }

    let previous = history.meetings.get(&input.id);
    let meeting = StoredMeeting {
        id: input.id.clone(),
        title: input.title.trim().to_string(),
        owner_google_user_id: owner,
        started_at: input.started_at,
        ended_at: input.ended_at,
        transcript: input.transcript.trim().to_string(),
        language: input.language,
        duration: input.duration,
        summary_text: previous.and_then(|item| item.summary_text.clone()),
        summary_provider: previous.and_then(|item| item.summary_provider.clone()),
        summary_model: previous.and_then(|item| item.summary_model.clone()),
        summary_status: previous
            .map(|item| item.summary_status.clone())
            .unwrap_or_else(|| "pending".to_string()),
        summary_error: previous.and_then(|item| item.summary_error.clone()),
        updated_at: input.updated_at,
    };
    history.meetings.insert(input.id, meeting.clone());
    store.save(&history)?;
    Ok(meeting)
}

#[tauri::command]
pub fn save_meeting_summary(
    input: SaveMeetingSummaryInput,
    store: State<'_, Arc<MeetingHistoryStore>>,
) -> Result<StoredMeeting, String> {
    if !matches!(input.status.as_str(), "pending" | "completed" | "failed") {
        return Err("Trạng thái AI Summary không hợp lệ.".to_string());
    }
    let owner = current_google_user_id();
    let _guard = store
        .operation_lock
        .lock()
        .map_err(|_| "Kho transcript đang ở trạng thái không hợp lệ.".to_string())?;
    let mut history = store.load()?;
    let meeting = history
        .meetings
        .get_mut(&input.meeting_id)
        .ok_or("Không tìm thấy transcript đã lưu cho phiên này.".to_string())?;
    if !is_owned_by(meeting, &owner) {
        return Err("Transcript này thuộc tài khoản khác.".to_string());
    }

    meeting.title = input.title.trim().to_string();
    meeting.summary_status = input.status;
    meeting.summary_text = input.text;
    meeting.summary_provider = input.provider;
    meeting.summary_model = input.model;
    meeting.summary_error = input.error;
    meeting.updated_at = input.updated_at;
    let output = meeting.clone();
    store.save(&history)?;
    Ok(output)
}

#[tauri::command]
pub fn list_meeting_transcripts(
    store: State<'_, Arc<MeetingHistoryStore>>,
) -> Result<Vec<MeetingPreview>, String> {
    let owner = current_google_user_id();
    let _guard = store
        .operation_lock
        .lock()
        .map_err(|_| "Kho transcript đang ở trạng thái không hợp lệ.".to_string())?;
    let history = store.load()?;
    let mut meetings: Vec<_> = history
        .meetings
        .values()
        .filter(|meeting| is_owned_by(meeting, &owner))
        .map(|meeting| MeetingPreview {
            id: meeting.id.clone(),
            title: meeting.title.clone(),
            summary_status: meeting.summary_status.clone(),
            updated_at: meeting.updated_at.clone(),
        })
        .collect();
    meetings.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(meetings)
}

#[tauri::command]
pub fn get_meeting_transcript(
    meeting_id: String,
    store: State<'_, Arc<MeetingHistoryStore>>,
) -> Result<StoredMeeting, String> {
    let owner = current_google_user_id();
    let _guard = store
        .operation_lock
        .lock()
        .map_err(|_| "Kho transcript đang ở trạng thái không hợp lệ.".to_string())?;
    let history = store.load()?;
    let meeting = history
        .meetings
        .get(&meeting_id)
        .ok_or("Không tìm thấy transcript đã lưu.".to_string())?;
    if !is_owned_by(meeting, &owner) {
        return Err("Transcript này thuộc tài khoản khác.".to_string());
    }
    Ok(meeting.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_store() -> MeetingHistoryStore {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        MeetingHistoryStore::new(std::env::temp_dir().join(format!(
            "voicifyai-meeting-history-{}-{unique}",
            std::process::id()
        )))
    }

    fn sample_meeting(owner: Option<&str>) -> StoredMeeting {
        StoredMeeting {
            id: "meeting-1".to_string(),
            title: "Kiểm thử".to_string(),
            owner_google_user_id: owner.map(str::to_string),
            started_at: "2026-09-18T09:00:00Z".to_string(),
            ended_at: "2026-09-18T09:01:00Z".to_string(),
            transcript: "Nội dung cần được giữ lại.".to_string(),
            language: "vi".to_string(),
            duration: 60.0,
            summary_text: None,
            summary_provider: Some("gemini".to_string()),
            summary_model: Some("gemini-flash-latest".to_string()),
            summary_status: "failed".to_string(),
            summary_error: Some("Quá tải".to_string()),
            updated_at: "2026-09-18T09:01:00Z".to_string(),
        }
    }

    #[test]
    fn transcript_and_failed_summary_survive_store_reload() {
        let store = temp_store();
        let meeting = sample_meeting(Some("user-1"));
        let mut history = MeetingHistory::default();
        history.meetings.insert(meeting.id.clone(), meeting);
        store.save(&history).unwrap();

        let reloaded = store.load().unwrap();
        let saved = reloaded.meetings.get("meeting-1").unwrap();
        assert_eq!(saved.transcript, "Nội dung cần được giữ lại.");
        assert_eq!(saved.summary_status, "failed");
        assert_eq!(saved.summary_error.as_deref(), Some("Quá tải"));
        assert!(is_owned_by(saved, &Some("user-1".to_string())));
        assert!(!is_owned_by(saved, &Some("user-2".to_string())));

        fs::remove_dir_all(store.path.parent().unwrap()).unwrap();
    }
}
