import { isTauriRuntime } from "./runtime";

export interface ArchiveMeetingInput {
  meetingId: string;
  meetingTitle: string;
  summary: string;
  meetingDate: string;
  startTime: string;
  endTime: string;
  startDateTime: string;
  endDateTime: string;
  timeZone: string;
}

export interface ArchiveMeetingOutput {
  meetingId: string;
  documentUrl: string;
  spreadsheetUrl: string;
  calendarUrl: string;
  calendarEventUrl: string;
  eventId: string;
  reused: boolean;
}

export interface ArchiveDestinationsOutput {
  spreadsheetUrl: string;
  calendarUrl: string;
}

export interface ArchiveNamingSettings {
  spreadsheetName: string;
  calendarName: string;
}

export function archiveMeeting(input: ArchiveMeetingInput): Promise<ArchiveMeetingOutput> {
  return tauriOnly<ArchiveMeetingOutput>("archive_meeting", { input });
}

export function prepareArchiveDestinations(): Promise<ArchiveDestinationsOutput> {
  return tauriOnly<ArchiveDestinationsOutput>("prepare_archive_destinations");
}

export function getArchiveNamingSettings(): Promise<ArchiveNamingSettings> {
  return tauriOnly<ArchiveNamingSettings>("archive_naming_settings");
}

export function saveArchiveNamingSettings(input: ArchiveNamingSettings): Promise<ArchiveNamingSettings> {
  return tauriOnly<ArchiveNamingSettings>("save_archive_naming_settings", { input });
}

export function openArchiveUrl(url: string): Promise<void> {
  if (!isTauriRuntime()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return Promise.resolve();
  }
  return tauriOnly<void>("open_archive_url", { url });
}

async function tauriOnly<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) throw new Error("Google Archive chưa được cấu hình cho bản web.");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}
