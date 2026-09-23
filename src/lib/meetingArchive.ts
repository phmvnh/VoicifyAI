import { invoke } from "@tauri-apps/api/core";

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
  return invoke<ArchiveMeetingOutput>("archive_meeting", { input });
}

export function prepareArchiveDestinations(): Promise<ArchiveDestinationsOutput> {
  return invoke<ArchiveDestinationsOutput>("prepare_archive_destinations");
}

export function getArchiveNamingSettings(): Promise<ArchiveNamingSettings> {
  return invoke<ArchiveNamingSettings>("archive_naming_settings");
}

export function saveArchiveNamingSettings(input: ArchiveNamingSettings): Promise<ArchiveNamingSettings> {
  return invoke<ArchiveNamingSettings>("save_archive_naming_settings", { input });
}

export function openArchiveUrl(url: string): Promise<void> {
  return invoke("open_archive_url", { url });
}
