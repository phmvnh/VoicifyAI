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

export function archiveMeeting(input: ArchiveMeetingInput): Promise<ArchiveMeetingOutput> {
  return invoke<ArchiveMeetingOutput>("archive_meeting", { input });
}

export function prepareArchiveDestinations(): Promise<ArchiveDestinationsOutput> {
  return invoke<ArchiveDestinationsOutput>("prepare_archive_destinations");
}

export function openArchiveUrl(url: string): Promise<void> {
  return invoke("open_archive_url", { url });
}
