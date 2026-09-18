use crate::google_auth::{google_access_token, google_user_id};
use reqwest::{
    blocking::{Client, Response},
    StatusCode,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::State;
use url::Url;

const SETTINGS_FILE: &str = "meeting-archive.json";
const SPREADSHEET_NAME: &str = "Meeting Log";
const SHEET_NAME: &str = "Meeting archive";
const CALENDAR_NAME: &str = "Meeting Archive";
const DEFAULT_TIME_ZONE: &str = "Asia/Ho_Chi_Minh";
const DURATION_NUMBER_FORMAT_TYPE: &str = "NUMBER";
const HEADERS: [&str; 7] = [
    "Meeting Date",
    "Start time",
    "End time",
    "Duration",
    "Meeting Title",
    "Summary URL",
    "Calendar Event ID",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveMeetingInput {
    meeting_id: String,
    meeting_title: String,
    summary: String,
    meeting_date: String,
    start_time: String,
    end_time: String,
    start_date_time: String,
    end_date_time: String,
    time_zone: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MeetingRecord {
    document_id: Option<String>,
    summary_url: Option<String>,
    event_id: Option<String>,
    event_url: Option<String>,
    sheet_row_written: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveSettings {
    owner_google_user_id: Option<String>,
    spreadsheet_id: Option<String>,
    sheet_id: Option<i64>,
    calendar_id: Option<String>,
    meetings: HashMap<String, MeetingRecord>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveMeetingOutput {
    meeting_id: String,
    document_url: String,
    spreadsheet_url: String,
    calendar_url: String,
    calendar_event_url: String,
    event_id: String,
    reused: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveDestinationsOutput {
    spreadsheet_url: String,
    calendar_url: String,
}

pub struct MeetingArchiveStore {
    path: PathBuf,
    operation_lock: Mutex<()>,
}

impl MeetingArchiveStore {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            path: app_data_dir.join(SETTINGS_FILE),
            operation_lock: Mutex::new(()),
        }
    }

    fn load(&self) -> Result<ArchiveSettings, String> {
        match fs::read_to_string(&self.path) {
            Ok(json) => serde_json::from_str(&json)
                .map_err(|error| format!("Cấu hình Meeting Archive không hợp lệ: {error}")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(ArchiveSettings::default())
            }
            Err(error) => Err(format!("Không thể đọc cấu hình Meeting Archive: {error}")),
        }
    }

    fn save(&self, settings: &ArchiveSettings) -> Result<(), String> {
        let parent = self
            .path
            .parent()
            .ok_or("Đường dẫn Meeting Archive không hợp lệ.")?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Không thể tạo thư mục Meeting Archive: {error}"))?;
        let json = serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?;
        fs::write(&self.path, json)
            .map_err(|error| format!("Không thể lưu cấu hình Meeting Archive: {error}"))
    }
}

#[tauri::command]
pub async fn archive_meeting(
    input: ArchiveMeetingInput,
    store: State<'_, Arc<MeetingArchiveStore>>,
) -> Result<ArchiveMeetingOutput, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || archive(input, &store))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn prepare_archive_destinations(
    store: State<'_, Arc<MeetingArchiveStore>>,
) -> Result<ArchiveDestinationsOutput, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || prepare_destinations(&store))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn open_archive_url(url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|_| "URL Google không hợp lệ.".to_string())?;
    if !is_allowed_archive_url(&parsed) {
        return Err("Chỉ được mở liên kết Google Docs, Sheets hoặc Calendar.".to_string());
    }
    open::that(url).map_err(|error| format!("Không thể mở liên kết Google: {error}"))
}

fn archive(
    input: ArchiveMeetingInput,
    store: &MeetingArchiveStore,
) -> Result<ArchiveMeetingOutput, String> {
    validate_input(&input)?;
    let _guard = store
        .operation_lock
        .lock()
        .map_err(|_| "Khóa Meeting Archive đã bị lỗi.".to_string())?;
    let google_user_id = google_user_id()?;
    let token = google_access_token()?;
    let api = GoogleApi::new(token)?;
    let mut settings = store.load()?;
    if settings.owner_google_user_id.as_deref() != Some(&google_user_id) {
        settings = ArchiveSettings {
            owner_google_user_id: Some(google_user_id),
            ..ArchiveSettings::default()
        };
        store.save(&settings)?;
    }
    let was_complete = settings
        .meetings
        .get(&input.meeting_id)
        .is_some_and(|record| record.sheet_row_written);

    let record = settings
        .meetings
        .entry(input.meeting_id.clone())
        .or_default()
        .clone();
    let document = api.ensure_document(&input, record.document_id.as_deref())?;
    update_record(&mut settings, &input.meeting_id, |record| {
        record.document_id = Some(document.id.clone());
        record.summary_url = Some(document.url.clone());
    });
    store.save(&settings)?;

    let spreadsheet = api.ensure_spreadsheet(settings.spreadsheet_id.as_deref())?;
    settings.spreadsheet_id = Some(spreadsheet.id.clone());
    let sheet_id = api.ensure_archive_sheet(&spreadsheet.id, settings.sheet_id)?;
    settings.sheet_id = Some(sheet_id);
    store.save(&settings)?;

    let calendar = api.ensure_calendar(settings.calendar_id.as_deref())?;
    settings.calendar_id = Some(calendar.id.clone());
    store.save(&settings)?;

    let saved_event_id = settings
        .meetings
        .get(&input.meeting_id)
        .and_then(|record| record.event_id.as_deref());
    let event = api.ensure_event(&calendar.id, &input, &document.url, saved_event_id)?;
    update_record(&mut settings, &input.meeting_id, |record| {
        record.event_id = Some(event.id.clone());
        record.event_url = Some(event.url.clone());
    });
    store.save(&settings)?;

    api.ensure_sheet_row(&spreadsheet.id, &input, &document.url, &event.id)?;
    update_record(&mut settings, &input.meeting_id, |record| {
        record.sheet_row_written = true;
    });
    store.save(&settings)?;

    let calendar_url = calendar_view_url(
        &calendar.id,
        input.time_zone.as_deref().unwrap_or(DEFAULT_TIME_ZONE),
    );
    Ok(ArchiveMeetingOutput {
        meeting_id: input.meeting_id,
        document_url: document.url,
        spreadsheet_url: format!(
            "https://docs.google.com/spreadsheets/d/{}/edit#gid={sheet_id}",
            spreadsheet.id
        ),
        calendar_url,
        calendar_event_url: event.url,
        event_id: event.id,
        reused: was_complete,
    })
}

fn prepare_destinations(store: &MeetingArchiveStore) -> Result<ArchiveDestinationsOutput, String> {
    let _guard = store
        .operation_lock
        .lock()
        .map_err(|_| "Khóa Meeting Archive đã bị lỗi.".to_string())?;
    let google_user_id = google_user_id()?;
    let mut settings = store.load()?;
    if let Some(destinations) = stored_destinations(&settings, &google_user_id) {
        return Ok(destinations);
    }
    if settings.owner_google_user_id.as_deref() != Some(&google_user_id) {
        settings = ArchiveSettings {
            owner_google_user_id: Some(google_user_id),
            ..ArchiveSettings::default()
        };
    }
    let token = google_access_token()?;
    let api = GoogleApi::new(token)?;

    let spreadsheet = api.ensure_spreadsheet(settings.spreadsheet_id.as_deref())?;
    settings.spreadsheet_id = Some(spreadsheet.id.clone());
    let sheet_id = api.ensure_archive_sheet(&spreadsheet.id, settings.sheet_id)?;
    settings.sheet_id = Some(sheet_id);

    let calendar = api.ensure_calendar(settings.calendar_id.as_deref())?;
    settings.calendar_id = Some(calendar.id.clone());
    store.save(&settings)?;

    Ok(ArchiveDestinationsOutput {
        spreadsheet_url: format!(
            "https://docs.google.com/spreadsheets/d/{}/edit#gid={sheet_id}",
            spreadsheet.id
        ),
        calendar_url: calendar_view_url(&calendar.id, DEFAULT_TIME_ZONE),
    })
}

fn stored_destinations(
    settings: &ArchiveSettings,
    google_user_id: &str,
) -> Option<ArchiveDestinationsOutput> {
    if settings.owner_google_user_id.as_deref() != Some(google_user_id) {
        return None;
    }
    let spreadsheet_id = settings.spreadsheet_id.as_deref()?;
    let sheet_id = settings.sheet_id?;
    let calendar_id = settings.calendar_id.as_deref()?;
    Some(ArchiveDestinationsOutput {
        spreadsheet_url: format!(
            "https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit#gid={sheet_id}"
        ),
        calendar_url: calendar_view_url(calendar_id, DEFAULT_TIME_ZONE),
    })
}

fn calendar_view_url(calendar_id: &str, time_zone: &str) -> String {
    let mut url = Url::parse("https://calendar.google.com/calendar/embed")
        .expect("Google Calendar embed URL phải hợp lệ");
    url.query_pairs_mut()
        .append_pair("src", calendar_id)
        .append_pair("ctz", time_zone)
        .append_pair("mode", "AGENDA");
    url.to_string()
}

fn is_allowed_archive_url(url: &Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    match url.host_str().unwrap_or_default() {
        "docs.google.com" | "calendar.google.com" => true,
        "www.google.com" => url.path().starts_with("/calendar/"),
        _ => false,
    }
}

fn update_record(
    settings: &mut ArchiveSettings,
    meeting_id: &str,
    update: impl FnOnce(&mut MeetingRecord),
) {
    update(settings.meetings.entry(meeting_id.to_string()).or_default());
}

fn validate_input(input: &ArchiveMeetingInput) -> Result<(), String> {
    if input.meeting_id.trim().is_empty()
        || input.meeting_title.trim().is_empty()
        || input.summary.trim().is_empty()
        || input.meeting_date.trim().is_empty()
        || input.start_time.trim().is_empty()
        || input.end_time.trim().is_empty()
        || input.start_date_time.trim().is_empty()
        || input.end_date_time.trim().is_empty()
    {
        return Err("Dữ liệu meeting để lưu Google chưa đầy đủ.".to_string());
    }
    Ok(())
}

#[derive(Clone, Debug)]
struct Resource {
    id: String,
    url: String,
}

struct GoogleApi {
    client: Client,
    token: String,
}

impl GoogleApi {
    fn new(token: String) -> Result<Self, String> {
        let client = Client::builder()
            .timeout(Duration::from_secs(60))
            .user_agent("VoicifyAI/0.1")
            .build()
            .map_err(|error| error.to_string())?;
        Ok(Self { client, token })
    }

    fn json<T: DeserializeOwned>(&self, response: Response) -> Result<T, String> {
        let status = response.status();
        if !status.is_success() {
            let body = response.text().unwrap_or_default();
            return Err(format!("Google API trả về {status}: {body}"));
        }
        response
            .json()
            .map_err(|error| format!("Phản hồi Google API không hợp lệ: {error}"))
    }

    fn exists_or_missing(&self, response: Response) -> Result<bool, String> {
        if response.status().is_success() {
            return Ok(true);
        }
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(false);
        }
        let status = response.status();
        let body = response.text().unwrap_or_default();
        Err(format!("Google API trả về {status}: {body}"))
    }

    fn ensure_document(
        &self,
        input: &ArchiveMeetingInput,
        saved_id: Option<&str>,
    ) -> Result<Resource, String> {
        if let Some(id) = saved_id {
            let response = self
                .client
                .get(format!("https://www.googleapis.com/drive/v3/files/{id}"))
                .bearer_auth(&self.token)
                .query(&[("fields", "id")])
                .send()
                .map_err(api_network_error)?;
            if self.exists_or_missing(response)? {
                return Ok(Resource {
                    id: id.to_string(),
                    url: format!("https://docs.google.com/document/d/{id}/edit"),
                });
            }
        }
        let query = format!(
            "appProperties has {{ key='meetingId' and value='{}' }} and mimeType='application/vnd.google-apps.document' and trashed=false",
            drive_query_value(&input.meeting_id)
        );
        let response: DriveFileList = self.json(
            self.client
                .get("https://www.googleapis.com/drive/v3/files")
                .bearer_auth(&self.token)
                .query(&[("q", query.as_str()), ("fields", "files(id,webViewLink)")])
                .send()
                .map_err(api_network_error)?,
        )?;
        if let Some(file) = first_drive_file(response.files) {
            return Ok(Resource {
                url: file.web_view_link.unwrap_or_else(|| {
                    format!("https://docs.google.com/document/d/{}/edit", file.id)
                }),
                id: file.id,
            });
        }
        let title = format!("{} — {}", input.meeting_title.trim(), input.meeting_date);
        let file: DriveFile = self.json(
            self.client
                .post("https://www.googleapis.com/drive/v3/files")
                .bearer_auth(&self.token)
                .query(&[("fields", "id,webViewLink")])
                .json(&json!({
                    "name": title,
                    "mimeType": "application/vnd.google-apps.document",
                    "appProperties": { "meetingId": input.meeting_id }
                }))
                .send()
                .map_err(api_network_error)?,
        )?;
        let body = format!(
            "{}\n{} {} – {}\n\n{}",
            input.meeting_title.trim(),
            input.meeting_date,
            input.start_time,
            input.end_time,
            input.summary.trim()
        );
        let _: Value = self.json(
            self.client
                .post(format!(
                    "https://docs.googleapis.com/v1/documents/{}:batchUpdate",
                    file.id
                ))
                .bearer_auth(&self.token)
                .json(&json!({"requests": [{"insertText": {"location": {"index": 1}, "text": body}}]}))
                .send()
                .map_err(api_network_error)?,
        )?;
        Ok(Resource {
            url: file
                .web_view_link
                .unwrap_or_else(|| format!("https://docs.google.com/document/d/{}/edit", file.id)),
            id: file.id,
        })
    }

    fn ensure_spreadsheet(&self, saved_id: Option<&str>) -> Result<Resource, String> {
        if let Some(id) = saved_id {
            let response = self
                .client
                .get(format!("https://www.googleapis.com/drive/v3/files/{id}"))
                .bearer_auth(&self.token)
                .query(&[("fields", "id")])
                .send()
                .map_err(api_network_error)?;
            if self.exists_or_missing(response)? {
                return Ok(Resource {
                    id: id.to_string(),
                    url: format!("https://docs.google.com/spreadsheets/d/{id}/edit"),
                });
            }
        }
        let query = format!(
            "name='{}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
            drive_query_value(SPREADSHEET_NAME)
        );
        let list: DriveFileList = self.json(
            self.client
                .get("https://www.googleapis.com/drive/v3/files")
                .bearer_auth(&self.token)
                .query(&[
                    ("q", query.as_str()),
                    ("orderBy", "createdTime desc"),
                    ("pageSize", "10"),
                    ("fields", "files(id,webViewLink)"),
                ])
                .send()
                .map_err(api_network_error)?,
        )?;
        if let Some(file) = first_drive_file(list.files) {
            return Ok(Resource {
                url: file.web_view_link.unwrap_or_else(|| {
                    format!("https://docs.google.com/spreadsheets/d/{}/edit", file.id)
                }),
                id: file.id,
            });
        }
        let file: DriveFile = self.json(
            self.client
                .post("https://www.googleapis.com/drive/v3/files")
                .bearer_auth(&self.token)
                .query(&[("fields", "id,webViewLink")])
                .json(&json!({
                    "name": SPREADSHEET_NAME,
                    "mimeType": "application/vnd.google-apps.spreadsheet"
                }))
                .send()
                .map_err(api_network_error)?,
        )?;
        Ok(Resource {
            url: file.web_view_link.unwrap_or_else(|| {
                format!("https://docs.google.com/spreadsheets/d/{}/edit", file.id)
            }),
            id: file.id,
        })
    }

    fn ensure_archive_sheet(
        &self,
        spreadsheet_id: &str,
        saved_sheet_id: Option<i64>,
    ) -> Result<i64, String> {
        let spreadsheet: Spreadsheet = self.json(
            self.client
                .get(format!(
                    "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}"
                ))
                .bearer_auth(&self.token)
                .query(&[("fields", "sheets(properties(sheetId,title,index))")])
                .send()
                .map_err(api_network_error)?,
        )?;
        let (sheet_id, needs_rename) = choose_archive_sheet(&spreadsheet.sheets, saved_sheet_id)
            .ok_or("Spreadsheet không có tab nào để sử dụng.")?;
        if needs_rename {
            let _: Value = self.json(
                self.client
                    .post(format!(
                        "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}:batchUpdate"
                    ))
                    .bearer_auth(&self.token)
                    .json(&json!({"requests": [{"updateSheetProperties": {
                        "properties": {"sheetId": sheet_id, "title": SHEET_NAME},
                        "fields": "title"
                    }}]}))
                    .send()
                    .map_err(api_network_error)?,
            )?;
        }
        let range = format!("'{}'!A1:G1", SHEET_NAME.replace('\'', "''"));
        let _: Value = self.json(
            self.client
                .put(format!(
                    "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/{range}"
                ))
                .bearer_auth(&self.token)
                .query(&[("valueInputOption", "RAW")])
                .json(&json!({"values": [HEADERS]}))
                .send()
                .map_err(api_network_error)?,
        )?;
        let _: Value = self.json(
            self.client
                .post(format!(
                    "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}:batchUpdate"
                ))
                .bearer_auth(&self.token)
                .json(&json!({"requests": [
                    {"repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 1, "startColumnIndex": 0, "endColumnIndex": 1},
                        "cell": {"userEnteredFormat": {"numberFormat": {"type": "DATE", "pattern": "yyyy-mm-dd"}}},
                        "fields": "userEnteredFormat.numberFormat"
                    }},
                    {"repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 1, "startColumnIndex": 1, "endColumnIndex": 3},
                        "cell": {"userEnteredFormat": {"numberFormat": {"type": "TIME", "pattern": "hh:mm:ss"}}},
                        "fields": "userEnteredFormat.numberFormat"
                    }},
                    {"repeatCell": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 1, "startColumnIndex": 3, "endColumnIndex": 4},
                        "cell": {"userEnteredFormat": {"numberFormat": {"type": DURATION_NUMBER_FORMAT_TYPE, "pattern": "[h]:mm:ss"}}},
                        "fields": "userEnteredFormat.numberFormat"
                    }}
                ]}))
                .send()
                .map_err(api_network_error)?,
        )?;
        Ok(sheet_id)
    }

    fn ensure_calendar(&self, saved_id: Option<&str>) -> Result<Resource, String> {
        if let Some(id) = saved_id {
            let response = self
                .client
                .get(format!(
                    "https://www.googleapis.com/calendar/v3/calendars/{id}"
                ))
                .bearer_auth(&self.token)
                .send()
                .map_err(api_network_error)?;
            if self.exists_or_missing(response)? {
                return Ok(Resource {
                    id: id.to_string(),
                    url: "https://calendar.google.com/calendar/u/0/r".to_string(),
                });
            }
        }
        let list: CalendarList = self.json(
            self.client
                .get("https://www.googleapis.com/calendar/v3/users/me/calendarList")
                .bearer_auth(&self.token)
                .query(&[("maxResults", "250")])
                .send()
                .map_err(api_network_error)?,
        )?;
        if let Some(calendar) = find_calendar(list.items, CALENDAR_NAME) {
            return Ok(Resource {
                id: calendar.id,
                url: "https://calendar.google.com/calendar/u/0/r".to_string(),
            });
        }
        let calendar: CalendarItem = self.json(
            self.client
                .post("https://www.googleapis.com/calendar/v3/calendars")
                .bearer_auth(&self.token)
                .json(&json!({"summary": CALENDAR_NAME, "timeZone": DEFAULT_TIME_ZONE}))
                .send()
                .map_err(api_network_error)?,
        )?;
        Ok(Resource {
            id: calendar.id,
            url: "https://calendar.google.com/calendar/u/0/r".to_string(),
        })
    }

    fn ensure_event(
        &self,
        calendar_id: &str,
        input: &ArchiveMeetingInput,
        summary_url: &str,
        saved_event_id: Option<&str>,
    ) -> Result<Resource, String> {
        if let Some(id) = saved_event_id {
            let response = self
                .client
                .get(format!(
                    "https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events/{id}"
                ))
                .bearer_auth(&self.token)
                .send()
                .map_err(api_network_error)?;
            if response.status().is_success() {
                let event: CalendarEvent = response
                    .json()
                    .map_err(|error| format!("Phản hồi Google API không hợp lệ: {error}"))?;
                return Ok(Resource {
                    id: event.id,
                    url: event.html_link.unwrap_or_else(|| {
                        "https://calendar.google.com/calendar/u/0/r".to_string()
                    }),
                });
            }
            if response.status() != StatusCode::NOT_FOUND {
                let status = response.status();
                let body = response.text().unwrap_or_default();
                return Err(format!("Google API trả về {status}: {body}"));
            }
        }
        let private_property = format!("meetingId={}", input.meeting_id);
        let list: EventList = self.json(
            self.client
                .get(format!(
                    "https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events"
                ))
                .bearer_auth(&self.token)
                .query(&[
                    ("privateExtendedProperty", private_property.as_str()),
                    ("singleEvents", "true"),
                    ("maxResults", "1"),
                ])
                .send()
                .map_err(api_network_error)?,
        )?;
        if let Some(event) = list.items.into_iter().next() {
            return Ok(Resource {
                id: event.id,
                url: event
                    .html_link
                    .unwrap_or_else(|| "https://calendar.google.com/calendar/u/0/r".to_string()),
            });
        }
        let time_zone = input.time_zone.as_deref().unwrap_or(DEFAULT_TIME_ZONE);
        let event: CalendarEvent = self.json(
            self.client
                .post(format!(
                    "https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events"
                ))
                .bearer_auth(&self.token)
                .json(&json!({
                    "summary": input.meeting_title.trim(),
                    "description": format!("Summary: {summary_url}"),
                    "start": {"dateTime": input.start_date_time, "timeZone": time_zone},
                    "end": {"dateTime": input.end_date_time, "timeZone": time_zone},
                    "extendedProperties": {"private": {"meetingId": input.meeting_id}}
                }))
                .send()
                .map_err(api_network_error)?,
        )?;
        Ok(Resource {
            id: event.id,
            url: event
                .html_link
                .unwrap_or_else(|| "https://calendar.google.com/calendar/u/0/r".to_string()),
        })
    }

    fn ensure_sheet_row(
        &self,
        spreadsheet_id: &str,
        input: &ArchiveMeetingInput,
        summary_url: &str,
        event_id: &str,
    ) -> Result<(), String> {
        let range = format!("'{}'!A:G", SHEET_NAME.replace('\'', "''"));
        let existing: ValueRange = self.json(
            self.client
                .get(format!(
                    "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/{range}"
                ))
                .bearer_auth(&self.token)
                .send()
                .map_err(api_network_error)?,
        )?;
        if let Some(row) = find_event_row(&existing.values, event_id) {
            self.write_duration_formula(spreadsheet_id, row)?;
            return Ok(());
        }
        let row = existing.values.len().max(1) + 1;
        let row_range = format!("'{}'!A{row}:G{row}", SHEET_NAME.replace('\'', "''"));
        let duration_formula = duration_formula(row);
        let _: Value = self.json(
            self.client
                .put(format!(
                    "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/{row_range}"
                ))
                .bearer_auth(&self.token)
                .query(&[("valueInputOption", "USER_ENTERED")])
                .json(&json!({"values": [[
                    input.meeting_date,
                    input.start_time,
                    input.end_time,
                    duration_formula,
                    input.meeting_title.trim(),
                    summary_url,
                    event_id
                ]]}))
                .send()
                .map_err(api_network_error)?,
        )?;
        Ok(())
    }

    fn write_duration_formula(&self, spreadsheet_id: &str, row: usize) -> Result<(), String> {
        let range = format!("'{}'!D{row}", SHEET_NAME.replace('\'', "''"));
        let _: Value = self.json(
            self.client
                .put(format!(
                    "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/{range}"
                ))
                .bearer_auth(&self.token)
                .query(&[("valueInputOption", "USER_ENTERED")])
                .json(&json!({"values": [[duration_formula(row)]]}))
                .send()
                .map_err(api_network_error)?,
        )?;
        Ok(())
    }
}

fn api_network_error(error: reqwest::Error) -> String {
    format!("Không thể kết nối Google API: {error}")
}

fn drive_query_value(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "\\'")
}

fn first_drive_file(mut files: Vec<DriveFile>) -> Option<DriveFile> {
    if files.is_empty() {
        None
    } else {
        Some(files.remove(0))
    }
}

fn find_calendar(mut calendars: Vec<CalendarItem>, name: &str) -> Option<CalendarItem> {
    calendars
        .drain(..)
        .find(|calendar| calendar.summary == name)
}

fn choose_archive_sheet(sheets: &[Sheet], saved_id: Option<i64>) -> Option<(i64, bool)> {
    if let Some(sheet) = sheets
        .iter()
        .find(|sheet| sheet.properties.title == SHEET_NAME)
    {
        return Some((sheet.properties.sheet_id, false));
    }
    if let Some(saved_id) = saved_id {
        if let Some(sheet) = sheets
            .iter()
            .find(|sheet| sheet.properties.sheet_id == saved_id)
        {
            return Some((sheet.properties.sheet_id, true));
        }
    }
    sheets
        .iter()
        .max_by_key(|sheet| sheet.properties.index)
        .map(|sheet| (sheet.properties.sheet_id, true))
}

fn find_event_row(rows: &[Vec<Value>], event_id: &str) -> Option<usize> {
    rows.iter().enumerate().skip(1).find_map(|(index, row)| {
        row.get(6)
            .and_then(Value::as_str)
            .is_some_and(|value| value == event_id)
            .then_some(index + 1)
    })
}

fn duration_formula(row: usize) -> String {
    format!("=C{row}-B{row}+(C{row}<B{row})")
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveFile {
    id: String,
    web_view_link: Option<String>,
}

#[derive(Deserialize)]
struct DriveFileList {
    #[serde(default)]
    files: Vec<DriveFile>,
}

#[derive(Clone, Debug, Deserialize)]
struct SheetProperties {
    #[serde(rename = "sheetId")]
    sheet_id: i64,
    title: String,
    index: i64,
}

#[derive(Clone, Debug, Deserialize)]
struct Sheet {
    properties: SheetProperties,
}

#[derive(Deserialize)]
struct Spreadsheet {
    #[serde(default)]
    sheets: Vec<Sheet>,
}

#[derive(Deserialize)]
struct CalendarItem {
    id: String,
    summary: String,
}

#[derive(Deserialize)]
struct CalendarList {
    #[serde(default)]
    items: Vec<CalendarItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CalendarEvent {
    id: String,
    html_link: Option<String>,
}

#[derive(Deserialize)]
struct EventList {
    #[serde(default)]
    items: Vec<CalendarEvent>,
}

#[derive(Default, Deserialize)]
struct ValueRange {
    #[serde(default)]
    values: Vec<Vec<Value>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sheet(id: i64, title: &str, index: i64) -> Sheet {
        Sheet {
            properties: SheetProperties {
                sheet_id: id,
                title: title.to_string(),
                index,
            },
        }
    }

    #[test]
    fn reuses_existing_archive_sheet() {
        let sheets = vec![sheet(1, "Sheet1", 0), sheet(7, SHEET_NAME, 1)];
        assert_eq!(choose_archive_sheet(&sheets, None), Some((7, false)));
    }

    #[test]
    fn reuses_existing_meeting_log_spreadsheet() {
        let files = vec![DriveFile {
            id: "spreadsheet-1".to_string(),
            web_view_link: Some(
                "https://docs.google.com/spreadsheets/d/spreadsheet-1/edit".to_string(),
            ),
        }];
        assert_eq!(
            first_drive_file(files).map(|file| file.id),
            Some("spreadsheet-1".to_string())
        );
        assert!(first_drive_file(Vec::new()).is_none());
    }

    #[test]
    fn reuses_existing_meeting_archive_calendar() {
        let calendars = vec![
            CalendarItem {
                id: "other".to_string(),
                summary: "Personal".to_string(),
            },
            CalendarItem {
                id: "archive".to_string(),
                summary: CALENDAR_NAME.to_string(),
            },
        ];
        assert_eq!(
            find_calendar(calendars, CALENDAR_NAME).map(|calendar| calendar.id),
            Some("archive".to_string())
        );
    }

    #[test]
    fn missing_resources_trigger_creation_paths() {
        assert!(first_drive_file(Vec::new()).is_none());
        assert!(find_calendar(Vec::new(), CALENDAR_NAME).is_none());
    }

    #[test]
    fn calendar_button_url_selects_only_meeting_archive_calendar() {
        let url = Url::parse(&calendar_view_url(
            "archive-id@group.calendar.google.com",
            DEFAULT_TIME_ZONE,
        ))
        .unwrap();
        let query: HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(url.host_str(), Some("calendar.google.com"));
        assert_eq!(url.path(), "/calendar/embed");
        assert_eq!(
            query.get("src").map(String::as_str),
            Some("archive-id@group.calendar.google.com")
        );
        assert_eq!(
            query.get("ctz").map(String::as_str),
            Some(DEFAULT_TIME_ZONE)
        );
        assert_eq!(query.get("mode").map(String::as_str), Some("AGENDA"));
    }

    #[test]
    fn archive_url_validation_accepts_official_calendar_event_links() {
        assert!(is_allowed_archive_url(
            &Url::parse("https://calendar.google.com/calendar/embed?src=archive").unwrap()
        ));
        assert!(is_allowed_archive_url(
            &Url::parse("https://www.google.com/calendar/event?eid=abc").unwrap()
        ));
        assert!(!is_allowed_archive_url(
            &Url::parse("https://www.google.com/search?q=calendar").unwrap()
        ));
    }

    #[test]
    fn renames_newest_tab_when_archive_sheet_is_missing() {
        let sheets = vec![sheet(1, "Old", 0), sheet(9, "Newest", 4)];
        assert_eq!(choose_archive_sheet(&sheets, None), Some((9, true)));
    }

    #[test]
    fn saved_sheet_id_is_reused_before_renaming_another_tab() {
        let sheets = vec![sheet(3, "Previous name", 0), sheet(9, "Newest", 4)];
        assert_eq!(choose_archive_sheet(&sheets, Some(3)), Some((3, true)));
    }

    #[test]
    fn duplicate_sheet_row_is_detected_by_calendar_event_id() {
        let rows = vec![
            HEADERS.iter().map(|value| json!(value)).collect(),
            vec![
                json!("2026-09-18"),
                json!(""),
                json!(""),
                json!(""),
                json!("Title"),
                json!("url"),
                json!("event-123"),
            ],
        ];
        assert_eq!(find_event_row(&rows, "event-123"), Some(2));
        assert_eq!(find_event_row(&rows, "event-456"), None);
    }

    #[test]
    fn duration_formula_is_locale_independent_and_handles_midnight() {
        assert_eq!(duration_formula(2), "=C2-B2+(C2<B2)");
        assert!(!duration_formula(2).contains(','));
        assert!(!duration_formula(2).contains(';'));
        assert_eq!(DURATION_NUMBER_FORMAT_TYPE, "NUMBER");
    }

    #[test]
    fn existing_destinations_can_be_opened_without_google_api_writes() {
        let settings = ArchiveSettings {
            owner_google_user_id: Some("user-1".to_string()),
            spreadsheet_id: Some("spreadsheet-1".to_string()),
            sheet_id: Some(42),
            calendar_id: Some("calendar-1".to_string()),
            ..ArchiveSettings::default()
        };
        let destinations = stored_destinations(&settings, "user-1").unwrap();
        assert!(destinations.spreadsheet_url.contains("spreadsheet-1"));
        assert!(destinations.spreadsheet_url.ends_with("gid=42"));
        assert!(destinations.calendar_url.contains("calendar-1"));
        assert!(stored_destinations(&settings, "another-user").is_none());
    }

    #[test]
    fn completed_meeting_record_is_reused_by_meeting_id() {
        let mut settings = ArchiveSettings::default();
        settings.meetings.insert(
            "meeting-1".to_string(),
            MeetingRecord {
                event_id: Some("event-1".to_string()),
                sheet_row_written: true,
                ..MeetingRecord::default()
            },
        );
        assert!(settings
            .meetings
            .get("meeting-1")
            .is_some_and(|record| record.sheet_row_written));
    }
}
