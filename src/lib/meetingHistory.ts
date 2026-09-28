import { isTauriRuntime } from "./runtime";

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

const WEB_HISTORY_KEY = "voicifyai-web-meeting-history-v1";

function readWebHistory(): Record<string, StoredMeeting> {
  try {
    return JSON.parse(localStorage.getItem(WEB_HISTORY_KEY) ?? "{}") as Record<string, StoredMeeting>;
  } catch {
    return {};
  }
}

function writeWebHistory(history: Record<string, StoredMeeting>) {
  localStorage.setItem(WEB_HISTORY_KEY, JSON.stringify(history));
}

async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export async function saveMeetingTranscript(input: SaveMeetingTranscriptInput): Promise<StoredMeeting> {
  if (isTauriRuntime()) return tauriInvoke<StoredMeeting>("save_meeting_transcript", { input });
  const history = readWebHistory();
  const existing = history[input.id];
  const meeting: StoredMeeting = {
    id: input.id,
    title: input.title,
    ownerGoogleUserId: null,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    transcript: input.transcript,
    language: input.language,
    duration: input.duration,
    summaryText: existing?.summaryText ?? null,
    summaryProvider: existing?.summaryProvider ?? null,
    summaryModel: existing?.summaryModel ?? null,
    summaryStatus: existing?.summaryStatus ?? "pending",
    summaryError: existing?.summaryError ?? null,
    updatedAt: input.updatedAt,
  };
  history[input.id] = meeting;
  writeWebHistory(history);
  return meeting;
}

export async function saveMeetingSummary(input: SaveMeetingSummaryInput): Promise<StoredMeeting> {
  if (isTauriRuntime()) return tauriInvoke<StoredMeeting>("save_meeting_summary", { input });
  const history = readWebHistory();
  const meeting = history[input.meetingId];
  if (!meeting) throw new Error("Không tìm thấy transcript để lưu tóm tắt.");
  const updated: StoredMeeting = {
    ...meeting,
    title: input.title,
    summaryText: input.text,
    summaryProvider: input.provider,
    summaryModel: input.model,
    summaryStatus: input.status,
    summaryError: input.error,
    updatedAt: input.updatedAt,
  };
  history[input.meetingId] = updated;
  writeWebHistory(history);
  return updated;
}

export async function listMeetingTranscripts(): Promise<MeetingPreview[]> {
  if (isTauriRuntime()) return tauriInvoke<MeetingPreview[]>("list_meeting_transcripts");
  return Object.values(readWebHistory())
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map(({ id, title, summaryStatus, updatedAt }) => ({ id, title, summaryStatus, updatedAt }));
}

export async function getMeetingTranscript(meetingId: string): Promise<StoredMeeting> {
  if (isTauriRuntime()) return tauriInvoke<StoredMeeting>("get_meeting_transcript", { meetingId });
  const meeting = readWebHistory()[meetingId];
  if (!meeting) throw new Error("Không tìm thấy transcript đã lưu.");
  return meeting;
}
