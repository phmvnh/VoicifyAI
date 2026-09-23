import { invoke } from "@tauri-apps/api/core";

export type StoredSummaryStatus = "pending" | "completed" | "failed";

export interface StoredMeeting {
  id: string;
  title: string;
  ownerGoogleUserId: string | null;
  startedAt: string;
  endedAt: string;
  transcript: string;
  language: string;
  duration: number;
  summaryText: string | null;
  summaryProvider: string | null;
  summaryModel: string | null;
  summaryStatus: StoredSummaryStatus;
  summaryError: string | null;
  updatedAt: string;
}

export interface MeetingPreview {
  id: string;
  title: string;
  summaryStatus: StoredSummaryStatus;
  updatedAt: string;
}

export interface SaveMeetingTranscriptInput {
  id: string;
  title: string;
  startedAt: string;
  endedAt: string;
  transcript: string;
  language: string;
  duration: number;
  updatedAt: string;
}

export interface SaveMeetingSummaryInput {
  meetingId: string;
  title: string;
  status: StoredSummaryStatus;
  text: string | null;
  provider: string | null;
  model: string | null;
  error: string | null;
  updatedAt: string;
}

export const saveMeetingTranscript = (input: SaveMeetingTranscriptInput) =>
  invoke<StoredMeeting>("save_meeting_transcript", { input });

export const saveMeetingSummary = (input: SaveMeetingSummaryInput) =>
  invoke<StoredMeeting>("save_meeting_summary", { input });

export const listMeetingTranscripts = () =>
  invoke<MeetingPreview[]>("list_meeting_transcripts");

export const getMeetingTranscript = (meetingId: string) =>
  invoke<StoredMeeting>("get_meeting_transcript", { meetingId });
