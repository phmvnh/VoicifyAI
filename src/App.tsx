import { useEffect, useRef, useState } from "react";
import { Inspector } from "./components/Inspector";
import { MainPanel } from "./components/MainPanel";
import { RemovalConfirmModal } from "./components/RemovalConfirmModal";
import { SettingsModal } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import { SummaryApiModal } from "./components/SummaryApiModal";
import { TitleBar } from "./components/TitleBar";
import { clearAiSummaryConfig, DEFAULT_AI_CONFIG, generateAiSummary, getAiSummaryStatus, saveAiSummaryConfig } from "./lib/aiSummary";
import { cancelGpuRuntimeInstall, cancelModelDownload, downloadModel, fetchGpuRuntimeStatus, fetchHardwareStatus, fetchLanguages, fetchModels, fetchModelStatuses, installGpuRuntime, removeGpuRuntime, removeModel, transcribeFile } from "./lib/engineClient";
import { buildLanguageOptions, type LanguageOption } from "./lib/languages";
import { archiveMeeting, openArchiveUrl, prepareArchiveDestinations, type ArchiveDestinationsOutput, type ArchiveMeetingOutput } from "./lib/meetingArchive";
import { getMeetingTranscript, saveMeetingSummary, saveMeetingTranscript, type StoredMeeting } from "./lib/meetingHistory";
import { cancelGoogleSignIn, getGoogleAuthStatus, signInWithGoogle, signOutGoogle, type GoogleAuthStatus } from "./lib/googleAuth";
import {
  listenToLiveEvents,
  listMicrophones,
  setLiveCapturePaused,
  startLiveCapture,
  stopLiveCapture,
} from "./lib/liveAudioClient";
import type { AudioDeviceInfo } from "./lib/liveAudioClient";
import type { AiSummaryConfigStatus, CaptureSource, EngineConfig, GpuRuntimeStatus, HardwareStatus, MainTab, ModelStatus, RecentMeeting, SaveAiSummaryConfigInput, ThemeMode, TranscriptionResult } from "./types";

const visibleModels = ["tiny", "base", "small", "medium", "turbo", "large-v3"];
const fallbackLanguageCodes = ["vi", "en", "zh", "ja", "ko", "fr", "de", "es", "pt", "it", "ru", "th", "ar"];
const meetingTimeZone = "Asia/Ho_Chi_Minh";

interface MeetingContext {
  id: string;
  startedAt: string;
  endedAt: string | null;
}

type PendingRemoval =
  | { kind: "model"; id: string; name: string; size: string }
  | { kind: "gpu"; name: string; size: string };

function localMeetingParts(isoDate: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: meetingTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(isoDate));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}:${value("second")}`,
  };
}

export default function App() {
  const liveSegmentId = useRef(1_000_000);
  const aiSummaryConfigRevision = useRef(0);
  const googleSignInAttempt = useRef(0);
  const googleSignInPending = useRef(false);
  const googleSignInLeftApp = useRef(false);
  const googleCancelTimer = useRef<number | null>(null);
  const liveResult = useRef<TranscriptionResult | null>(null);
  const activeCaptureSources = useRef<CaptureSource[]>([]);
  const finishedTranscriptStreams = useRef(new Set<CaptureSource>());
  const meetingContext = useRef<MeetingContext | null>(null);
  const pendingModelRemovals = useRef(new Set<string>());
  const [tab, setTab] = useState<MainTab>("transcript");
  const [sessionName, setSessionName] = useState("Phiên mới");
  const [result, setResult] = useState<TranscriptionResult | null>(null);
  const [models, setModels] = useState(visibleModels);
  const [languages, setLanguages] = useState<LanguageOption[]>(
    buildLanguageOptions(fallbackLanguageCodes),
  );
  const [hardwareStatus, setHardwareStatus] = useState<HardwareStatus | null>(null);
  const [gpuRuntimeStatus, setGpuRuntimeStatus] = useState<GpuRuntimeStatus | null>(null);
  const [modelStatuses, setModelStatuses] = useState<ModelStatus[]>([]);
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<Record<CaptureSource, boolean>>({ mic: true, system: false });
  const [microphones, setMicrophones] = useState<AudioDeviceInfo[]>([]);
  const [microphoneDevice, setMicrophoneDevice] = useState<string | null>(null);
  const [levels, setLevels] = useState<Record<CaptureSource, number>>({ mic: 0, system: 0 });
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [summarySettingsOpen, setSummarySettingsOpen] = useState(false);
  const [aiSummaryConfig, setAiSummaryConfig] = useState<AiSummaryConfigStatus>(DEFAULT_AI_CONFIG);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [archiveLinks, setArchiveLinks] = useState<ArchiveMeetingOutput | null>(null);
  const [archiveDestinations, setArchiveDestinations] = useState<ArchiveDestinationsOutput | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [recentMeetings, setRecentMeetings] = useState<RecentMeeting[]>([]);
  const [googleAuth, setGoogleAuth] = useState<GoogleAuthStatus>({ configured: false, user: null });
  const [googleAuthBusy, setGoogleAuthBusy] = useState(false);
  const [googleAuthError, setGoogleAuthError] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem("voicifyai-theme");
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  });
  const [config, setConfig] = useState<EngineConfig>({
    model: "turbo",
    device: "cpu",
    quantization: "int8",
    language: "vi",
    task: "transcribe",
    vad_filter: true,
    word_timestamps: true,
  });

  const upsertRecentMeeting = (meeting: RecentMeeting) => {
    setRecentMeetings((current) => [meeting, ...current.filter((item) => item.id !== meeting.id)]);
  };

  const updateRecentMeeting = (id: string, patch: Partial<Omit<RecentMeeting, "id">>) => {
    setRecentMeetings((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const persistCurrentTranscript = async (transcription: TranscriptionResult, title = sessionName) => {
    const context = meetingContext.current;
    if (!context) throw new Error("Không có thông tin phiên để lưu transcript.");
    const endedAt = context.endedAt ?? new Date().toISOString();
    context.endedAt = endedAt;
    const stored = await saveMeetingTranscript({
      id: context.id,
      title: title.trim() || "Phiên chưa đặt tên",
      startedAt: context.startedAt,
      endedAt,
      transcript: transcription.text,
      language: transcription.language,
      duration: transcription.duration,
      updatedAt: new Date().toISOString(),
    });
    upsertRecentMeeting({
      id: stored.id,
      title: stored.title,
      status: "completed",
      summaryStatus: stored.summaryStatus,
    });
    return stored;
  };

  const openStoredMeeting = (meeting: StoredMeeting) => {
    const restoredResult: TranscriptionResult = {
      text: meeting.transcript,
      segments: meeting.transcript ? [{
        id: 0,
        start: 0,
        end: meeting.duration,
        text: meeting.transcript,
        words: null,
      }] : [],
      language: meeting.language,
      language_probability: 1,
      duration: meeting.duration,
      duration_after_vad: meeting.duration,
      inference_seconds: 0,
      rtf: 0,
    };
    meetingContext.current = {
      id: meeting.id,
      startedAt: meeting.startedAt,
      endedAt: meeting.endedAt,
    };
    liveResult.current = restoredResult;
    setResult(restoredResult);
    setSessionName(meeting.title);
    setSummaryText(meeting.summaryText);
    setSummaryError(meeting.summaryError);
    setArchiveLinks(null);
    setArchiveError(null);
    setElapsed(Math.max(0, Math.round(meeting.duration)));
    setTab(meeting.summaryText || meeting.summaryStatus === "failed" ? "summary" : "transcript");
  };

  const handleSelectMeeting = async (meetingId: string) => {
    setError(null);
    try {
      openStoredMeeting(await getMeetingTranscript(meetingId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const handleSessionNameChange = (value: string) => {
    setSessionName(value);
    if (meetingContext.current) updateRecentMeeting(meetingContext.current.id, { title: value });
  };

  useEffect(() => {
    fetchModels()
      .then((availableModels) => {
        const supportedModels = visibleModels.filter((model) => availableModels.includes(model));
        if (supportedModels.length > 0) setModels(supportedModels);
      })
      .catch(() => undefined);
    fetchLanguages()
      .then((codes) => setLanguages(buildLanguageOptions(codes)))
      .catch(() => undefined);
    getGoogleAuthStatus()
      .then((status) => {
        setGoogleAuth(status);
      })
      .catch(() => undefined);
    const configRevision = aiSummaryConfigRevision.current;
    getAiSummaryStatus()
      .then((status) => {
        if (aiSummaryConfigRevision.current === configRevision) {
          setAiSummaryConfig(status);
        }
      })
      .catch((caught) => setSummaryError(caught instanceof Error ? caught.message : String(caught)));
  }, []);

  useEffect(() => {
    let disposed = false;
    let refreshTimer: number | null = null;
    const refresh = async () => {
      let delay = 10_000;
      try {
        const statuses = await fetchModelStatuses();
        if (disposed) return;
        setModelStatuses(statuses);
        if (statuses.some((status) => status.downloading || status.removing)) delay = 750;
      } catch {
        delay = 3_000;
      } finally {
        if (!disposed) refreshTimer = window.setTimeout(refresh, delay);
      }
    };
    void refresh();
    return () => {
      disposed = true;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, []);

  useEffect(() => {
    for (const model of pendingModelRemovals.current) {
      const status = modelStatuses.find((item) => item.id === model);
      if (!status || status.removing || status.downloaded) continue;
      pendingModelRemovals.current.delete(model);
      if (config.model === model) {
        const fallback = modelStatuses.find((item) => item.downloaded && !item.removing && item.id !== model);
        if (fallback) setConfig((current) => ({ ...current, model: fallback.id }));
      }
    }
  }, [modelStatuses, config.model]);

  useEffect(() => {
    let disposed = false;
    let retryTimer: number | null = null;
    const refreshHardware = async () => {
      let retryDelay = 30_000;
      const [hardwareResult, runtimeResult] = await Promise.allSettled([
        fetchHardwareStatus(),
        fetchGpuRuntimeStatus(),
      ]);
      if (!disposed) {
        if (hardwareResult.status === "fulfilled") {
          setHardwareStatus(hardwareResult.value);
        } else {
          const message = hardwareResult.reason instanceof Error ? hardwareResult.reason.message : String(hardwareResult.reason);
          setHardwareStatus({
            cpu: {
              compute_types: [],
              error: `Không thể kiểm tra CPU: ${message}. Đang thử lại…`,
            },
            cuda: {
              available: false,
              device_count: 0,
              compute_types: [],
              error: `Không thể kiểm tra CUDA: ${message}. Đang thử lại…`,
            },
          });
        }
        if (runtimeResult.status === "fulfilled") {
          setGpuRuntimeStatus(runtimeResult.value);
          retryDelay = runtimeResult.value.installing || runtimeResult.value.removing ? 1_000 : 15_000;
        } else {
          // Runtime management is optional. A stale/missing endpoint must not hide
          // a GPU that /v1/hardware already detected correctly.
          retryDelay = 5_000;
        }
        retryTimer = window.setTimeout(refreshHardware, retryDelay);
      }
    };
    void refreshHardware();
    return () => {
      disposed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [gpuRuntimeStatus?.installing, gpuRuntimeStatus?.removing]);

  const handleSaveAiSummary = async (input: SaveAiSummaryConfigInput) => {
    const saved = await saveAiSummaryConfig(input);
    if (!saved.configured || saved.provider !== input.provider || saved.model !== input.model) {
      throw new Error(saved.storageError ?? "Cấu hình AI chưa được lưu hoàn chỉnh. Hãy thử lại.");
    }
    aiSummaryConfigRevision.current += 1;
    setAiSummaryConfig(saved);
    setSummaryText(null);
    setSummaryError(null);
    return saved;
  };

  const handleClearAiSummary = async () => {
    const cleared = await clearAiSummaryConfig();
    aiSummaryConfigRevision.current += 1;
    setAiSummaryConfig(cleared);
    setSummaryText(null);
    setSummaryError(null);
  };

  const archiveCompletedSummary = async (summary: string, meetingTitle: string) => {
    const context = meetingContext.current;
    if (!context) {
      setArchiveError("Không có mốc thời gian meeting để lưu Google.");
      return;
    }
    const endedAt = context.endedAt ?? new Date().toISOString();
    context.endedAt = endedAt;
    const start = localMeetingParts(context.startedAt);
    const end = localMeetingParts(endedAt);
    setArchiveLoading(true);
    setArchiveError(null);
    try {
      const links = await archiveMeeting({
        meetingId: context.id,
        meetingTitle,
        summary,
        meetingDate: start.date,
        startTime: start.time,
        endTime: end.time,
        startDateTime: context.startedAt,
        endDateTime: endedAt,
        timeZone: meetingTimeZone,
      });
      setArchiveLinks(links);
      setArchiveDestinations({ spreadsheetUrl: links.spreadsheetUrl, calendarUrl: links.calendarUrl });
    } catch (caught) {
      setArchiveError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setArchiveLoading(false);
    }
  };

  const generateSummaryForTranscript = async (transcript: string) => {
    setSummaryLoading(true);
    setSummaryError(null);
    let completedSummary: string | null = null;
    let completedTitle: string | null = null;
    const context = meetingContext.current;
    if (context) {
      await saveMeetingSummary({
        meetingId: context.id,
        title: sessionName,
        status: "pending",
        text: null,
        provider: aiSummaryConfig.provider,
        model: aiSummaryConfig.model,
        error: null,
        updatedAt: new Date().toISOString(),
      }).catch(() => undefined);
      updateRecentMeeting(context.id, { summaryStatus: "pending" });
    }
    try {
      const output = await generateAiSummary(transcript, "bullets", "");
      setSummaryText(output.text);
      setSessionName(output.title);
      if (context) {
        await saveMeetingSummary({
          meetingId: context.id,
          title: output.title,
          status: "completed",
          text: output.text,
          provider: output.provider,
          model: output.model,
          error: null,
          updatedAt: new Date().toISOString(),
        });
        updateRecentMeeting(context.id, { title: output.title, status: "completed", summaryStatus: "completed" });
      }
      completedSummary = output.text;
      completedTitle = output.title;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setSummaryError(message);
      if (context) {
        await saveMeetingSummary({
          meetingId: context.id,
          title: sessionName,
          status: "failed",
          text: null,
          provider: aiSummaryConfig.provider,
          model: aiSummaryConfig.model,
          error: message,
          updatedAt: new Date().toISOString(),
        }).catch(() => undefined);
        updateRecentMeeting(context.id, { summaryStatus: "failed" });
      }
    } finally {
      setSummaryLoading(false);
    }
    if (completedSummary && completedTitle) await archiveCompletedSummary(completedSummary, completedTitle);
  };

  const handleGenerateSummary = async () => {
    if (!result) return;
    try {
      await persistCurrentTranscript(result);
    } catch (caught) {
      setSummaryError(caught instanceof Error ? caught.message : String(caught));
      return;
    }
    await generateSummaryForTranscript(result.text);
  };

  const handleGoogleSignIn = async () => {
    const attempt = ++googleSignInAttempt.current;
    googleSignInPending.current = true;
    googleSignInLeftApp.current = false;
    setGoogleAuthBusy(true);
    setGoogleAuthError(null);
    try {
      const user = await signInWithGoogle();
      if (attempt !== googleSignInAttempt.current) return;
      setGoogleAuth({ configured: true, user });
      setArchiveLinks(null);
      setArchiveDestinations(null);
      getAiSummaryStatus()
        .then((status) => {
          aiSummaryConfigRevision.current += 1;
          setAiSummaryConfig(status);
        })
        .catch((caught) => setSummaryError(caught instanceof Error ? caught.message : String(caught)));
    } catch (caught) {
      if (attempt !== googleSignInAttempt.current) return;
      setGoogleAuthError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (attempt === googleSignInAttempt.current) {
        googleSignInPending.current = false;
        googleSignInLeftApp.current = false;
        setGoogleAuthBusy(false);
      }
    }
  };

  useEffect(() => {
    const clearCancelTimer = () => {
      if (googleCancelTimer.current !== null) {
        window.clearTimeout(googleCancelTimer.current);
        googleCancelTimer.current = null;
      }
    };
    const handleBlur = () => {
      clearCancelTimer();
      if (googleSignInPending.current) googleSignInLeftApp.current = true;
    };
    const handleFocus = () => {
      if (!googleSignInPending.current || !googleSignInLeftApp.current) return;
      clearCancelTimer();
      googleCancelTimer.current = window.setTimeout(async () => {
        googleCancelTimer.current = null;
        if (!document.hasFocus() || !googleSignInPending.current) return;

        const cancelled = await cancelGoogleSignIn().catch(() => false);
        if (!cancelled || !googleSignInPending.current) return;

        googleSignInPending.current = false;
        googleSignInLeftApp.current = false;
        googleSignInAttempt.current += 1;
        setGoogleAuthBusy(false);
        setGoogleAuthError(null);
      }, 1500);
    };

    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
    return () => {
      clearCancelTimer();
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  const handleGoogleSignOut = async () => {
    setGoogleAuthBusy(true);
    setGoogleAuthError(null);
    try {
      await signOutGoogle();
      setGoogleAuth((current) => ({ ...current, user: null }));
      setArchiveLinks(null);
      setArchiveDestinations(null);
    } catch (caught) {
      setGoogleAuthError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setGoogleAuthBusy(false);
    }
  };

  const refreshMicrophones = async () => {
    try {
      const devices = await listMicrophones();
      setMicrophones(devices);
      setMicrophoneDevice((current) => {
        if (current && devices.some((device) => device.id === current)) return current;
        return devices.find((device) => device.isDefault)?.id ?? devices[0]?.id ?? null;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể đọc danh sách microphone");
    }
  };

  useEffect(() => {
    void refreshMicrophones();
  }, []);

  useEffect(() => {
    if (config.model.endsWith(".en") && config.language !== null && config.language !== "en") {
      setConfig((current) => ({ ...current, language: "en" }));
    }
  }, [config.model, config.language]);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    listenToLiveEvents({
      onLevel: ({ source, level }) => setLevels((current) => ({ ...current, [source]: level })),
      onStatus: ({ source, active }) => {
        if (!active) setLevels((current) => ({ ...current, [source]: 0 }));
      },
      onError: ({ source, message }) => {
        setError(`${source === "mic" ? "Microphone" : "System Audio"}: ${message}`);
        setRecording(false);
        setPaused(false);
        if (meetingContext.current) updateRecentMeeting(meetingContext.current.id, { status: "completed" });
        void stopLiveCapture();
      },
      onTranscript: (segment) => {
        if (!segment.text) return;
        setSummaryText(null);
        setSummaryError(null);
        const segments = [
          ...(liveResult.current?.segments ?? []),
          {
            id: liveSegmentId.current++,
            start: segment.start_sec,
            end: segment.end_sec,
            text: segment.text,
            words: null,
            source: segment.source,
          },
        ].sort((left, right) => left.start - right.start);
        const nextResult: TranscriptionResult = {
          text: segments.map((item) => item.text.trim()).join(" "),
          segments,
          language: segment.language,
          language_probability: segment.language_probability,
          duration: Math.max(...segments.map((item) => item.end)),
          duration_after_vad: Math.max(...segments.map((item) => item.end)),
          inference_seconds: segment.latency_seconds,
          rtf: segment.rtf,
        };
        liveResult.current = nextResult;
        setResult(nextResult);
      },
      onStreamFinished: ({ source }) => {
        finishedTranscriptStreams.current.add(source);
      },
    }).then((unlisten) => {
      if (disposed) unlisten();
      else cleanup = unlisten;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    if (!recording || paused) return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording, paused]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.dataset.theme = theme;
    root.style.colorScheme = theme === "system" ? "light dark" : theme;
    localStorage.setItem("voicifyai-theme", theme);
  }, [theme]);

  const handleFile = async (file: File) => {
    if (config.device === "cuda" && !hardwareStatus?.cuda.available) {
      setError("Hãy cài thành phần tăng tốc GPU trước khi nhận diện file.");
      return;
    }
    const selectedStatus = modelStatuses.find((status) => status.id === config.model);
    if (selectedStatus && !selectedStatus.downloaded) {
      setError(selectedStatus.downloading ? "Model đang được tải. Hãy chờ tải xong rồi thử lại." : "Hãy tải model đã chọn trước khi nhận diện file.");
      return;
    }
    setLoading(true);
    setError(null);
    setSummaryText(null);
    setSummaryError(null);
    setArchiveLinks(null);
    setArchiveError(null);
    const fileTitle = sessionName === "Phiên mới" ? file.name.replace(/\.[^.]+$/, "") : sessionName;
    if (sessionName === "Phiên mới") setSessionName(fileTitle);
    try {
      const nextResult = await transcribeFile(file, config);
      liveResult.current = nextResult;
      setResult(nextResult);
      const endedAt = new Date();
      meetingContext.current = {
        id: crypto.randomUUID(),
        startedAt: new Date(endedAt.getTime() - Math.max(nextResult.duration, 1) * 1000).toISOString(),
        endedAt: endedAt.toISOString(),
      };
      upsertRecentMeeting({ id: meetingContext.current.id, title: fileTitle, status: "completed" });
      try {
        await persistCurrentTranscript(nextResult, fileTitle);
      } catch (caught) {
        setSummaryError(`Không thể lưu transcript: ${caught instanceof Error ? caught.message : String(caught)}`);
      }
      setTab("transcript");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể nhận diện file âm thanh");
      liveResult.current = null;
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const handleStartCapture = async () => {
    if (config.device === "cuda" && !hardwareStatus?.cuda.available) {
      setError("Hãy cài thành phần tăng tốc GPU trước khi bắt đầu thu âm.");
      return;
    }
    const selectedStatus = modelStatuses.find((status) => status.id === config.model);
    if (selectedStatus && !selectedStatus.downloaded) {
      setError(selectedStatus.downloading ? "Model đang được tải. Hãy chờ tải xong rồi bắt đầu." : "Hãy tải model đã chọn trước khi bắt đầu thu âm.");
      return;
    }
    const selected = (Object.entries(sources) as [CaptureSource, boolean][])
      .filter(([, enabled]) => enabled)
      .map(([source]) => source);
    if (!selected.length) {
      setError("Hãy chọn Microphone, System Audio hoặc cả hai.");
      return;
    }
    setError(null);
    liveResult.current = null;
    setResult(null);
    setSummaryText(null);
    setSummaryError(null);
    setArchiveLinks(null);
    setArchiveError(null);
    setElapsed(0);
    setPaused(false);
    activeCaptureSources.current = selected;
    finishedTranscriptStreams.current.clear();
    const nextMeeting: MeetingContext = {
      id: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      endedAt: null,
    };
    meetingContext.current = nextMeeting;
    try {
      await startLiveCapture(selected, config, microphoneDevice);
      setRecording(true);
      setTab("transcript");
      upsertRecentMeeting({ id: nextMeeting.id, title: sessionName, status: "recording" });
    } catch (caught) {
      activeCaptureSources.current = [];
      meetingContext.current = null;
      setError(caught instanceof Error ? caught.message : "Không thể bắt đầu thu âm");
    }
  };

  const handleDownloadModel = async (model: string) => {
    setError(null);
    try {
      const status = await downloadModel(model);
      setModelStatuses((current) => current.some((item) => item.id === status.id)
        ? current.map((item) => item.id === status.id ? status : item)
        : [...current, status]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể bắt đầu tải model");
    }
  };

  const handleCancelModelDownload = async (model: string) => {
    setError(null);
    try {
      const status = await cancelModelDownload(model);
      setModelStatuses((current) => current.map((item) => item.id === status.id ? status : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể huỷ tải model");
    }
  };

  const handleRemoveModel = async (model: string) => {
    const status = modelStatuses.find((item) => item.id === model);
    if (!status) return;
    if (config.model === model) {
      setError("Không thể gỡ model đang được chọn. Hãy chọn model khác trước.");
      return;
    }
    if (recording || loading) {
      setError("Không thể gỡ model khi tác vụ nhận diện đang chạy.");
      return;
    }
    const size = status.size_bytes >= 1024 ** 3
      ? `${(status.size_bytes / 1024 ** 3).toFixed(2)} GB`
      : `${Math.round(status.size_bytes / 1024 ** 2)} MB`;
    setPendingRemoval({ kind: "model", id: model, name: status.label, size });
  };

  const confirmRemoveModel = async (model: string) => {
    setError(null);
    try {
      pendingModelRemovals.current.add(model);
      const nextStatus = await removeModel(model);
      setModelStatuses((current) => current.map((item) => item.id === nextStatus.id ? nextStatus : item));
      setPendingRemoval(null);
    } catch (caught) {
      pendingModelRemovals.current.delete(model);
      setError(caught instanceof Error ? caught.message : "Không thể gỡ model");
    }
  };

  const handleInstallGpuRuntime = async () => {
    setError(null);
    try {
      setGpuRuntimeStatus(await installGpuRuntime());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể cài tăng tốc GPU");
    }
  };

  const handleCancelGpuRuntimeInstall = async () => {
    setError(null);
    try {
      setGpuRuntimeStatus(await cancelGpuRuntimeInstall());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể huỷ cài tăng tốc GPU");
    }
  };

  const handleRemoveGpuRuntime = async () => {
    if (!gpuRuntimeStatus || recording || loading) return;
    const size = gpuRuntimeStatus.size_bytes >= 1024 ** 3
      ? `${(gpuRuntimeStatus.size_bytes / 1024 ** 3).toFixed(1)} GB`
      : `${Math.max(1, Math.round(gpuRuntimeStatus.size_bytes / 1024 ** 2))} MB`;
    setPendingRemoval({ kind: "gpu", name: "CUDA 12 + cuDNN", size });
  };

  const confirmRemoveGpuRuntime = async () => {
    setError(null);
    try {
      if (config.device === "cuda") setConfig((current) => ({ ...current, device: "cpu", quantization: "int8" }));
      setGpuRuntimeStatus(await removeGpuRuntime());
      setPendingRemoval(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể gỡ tăng tốc GPU");
    }
  };

  const confirmPendingRemoval = async () => {
    if (!pendingRemoval || confirmingRemoval) return;
    setConfirmingRemoval(true);
    try {
      if (pendingRemoval.kind === "model") await confirmRemoveModel(pendingRemoval.id);
      else await confirmRemoveGpuRuntime();
    } finally {
      setConfirmingRemoval(false);
    }
  };

  const handlePauseCapture = async () => {
    const next = !paused;
    try {
      await setLiveCapturePaused(next);
      setPaused(next);
      if (meetingContext.current) updateRecentMeeting(meetingContext.current.id, { status: next ? "paused" : "recording" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể tạm dừng");
    }
  };

  const handleStopCapture = async () => {
    const stoppedSources = [...activeCaptureSources.current];
    setTab("summary");
    setSummaryText(null);
    setSummaryError(null);
    setSummaryLoading(true);
    setRecording(false);
    setPaused(false);
    setLevels({ mic: 0, system: 0 });
    if (meetingContext.current) meetingContext.current.endedAt = new Date().toISOString();
    if (meetingContext.current) updateRecentMeeting(meetingContext.current.id, { title: sessionName, status: "completed" });

    await stopLiveCapture().catch(() => undefined);
    const waitStarted = Date.now();
    while (
      stoppedSources.some((source) => !finishedTranscriptStreams.current.has(source))
      && Date.now() - waitStarted < 30_000
    ) {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    activeCaptureSources.current = [];

    const transcript = liveResult.current?.text.trim();
    if (!transcript) {
      setSummaryError("Không có transcript để tạo bản tóm tắt.");
      setSummaryLoading(false);
      return;
    }
    try {
      await persistCurrentTranscript(liveResult.current!);
    } catch (caught) {
      setSummaryError(`Không thể lưu transcript: ${caught instanceof Error ? caught.message : String(caught)}`);
      setSummaryLoading(false);
      return;
    }
    if (!aiSummaryConfig.configured) {
      setSummaryError("Chưa cấu hình dịch vụ AI Summary.");
      setSummaryLoading(false);
      return;
    }

    await generateSummaryForTranscript(transcript);
  };

  const handleOpenArchive = async (kind: "docs" | "sheet" | "calendar") => {
    if (kind === "docs" && !archiveLinks) return;
    try {
      let destinations = archiveDestinations;
      if (kind !== "docs" && !destinations) {
        setArchiveLoading(true);
        setArchiveError(null);
        destinations = await prepareArchiveDestinations();
        setArchiveDestinations(destinations);
      }
      const url = kind === "docs"
        ? archiveLinks!.documentUrl
        : kind === "sheet"
          ? destinations!.spreadsheetUrl
          : destinations!.calendarUrl;
      await openArchiveUrl(url);
    } catch (caught) {
      setArchiveError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setArchiveLoading(false);
    }
  };

  const selectedModelReady = modelStatuses.find((status) => status.id === config.model)?.downloaded ?? true;
  const selectedDeviceReady = config.device !== "cuda" || hardwareStatus?.cuda.available === true;
  const inferenceReady = selectedModelReady && selectedDeviceReady;
  const inferenceBlockedReason = !selectedModelReady
    ? "Tải model đã chọn để bắt đầu."
    : !selectedDeviceReady
      ? "Cài thành phần tăng tốc GPU để bắt đầu."
      : null;

  return (
    <div className="app-shell">
      <TitleBar />
      <div className="workspace">
        <Sidebar sessionName={sessionName} setSessionName={handleSessionNameChange} onOpenSettings={() => setSettingsOpen(true)} hasResult={Boolean(result)} recentMeetings={recentMeetings} onSelectMeeting={handleSelectMeeting} sources={sources} setSources={setSources} levels={levels} recording={recording} paused={paused} elapsed={elapsed} onStart={handleStartCapture} onPause={handlePauseCapture} onStop={handleStopCapture} microphones={microphones} microphoneDevice={microphoneDevice} onMicrophoneChange={setMicrophoneDevice} onRefreshMicrophones={refreshMicrophones} googleUser={googleAuth.user} archiveLinks={archiveLinks} archiveLoading={archiveLoading} onOpenArchive={handleOpenArchive} modelReady={inferenceReady} blockedReason={inferenceBlockedReason} />
        <MainPanel tab={tab} onTabChange={setTab} result={result} loading={loading} error={error ?? archiveError} onFile={handleFile} sessionName={sessionName} model={config.model} device={config.device} quantization={config.quantization} sources={sources} levels={levels} recording={recording} paused={paused} elapsed={elapsed} onStart={handleStartCapture} onPause={handlePauseCapture} onStop={handleStopCapture} summaryText={summaryText} summaryLoading={summaryLoading} summaryError={summaryError} aiSummaryConfigured={aiSummaryConfig.configured} aiSummaryModel={aiSummaryConfig.model} onGenerateSummary={handleGenerateSummary} onOpenSummarySettings={() => setSummarySettingsOpen(true)} modelReady={inferenceReady} blockedReason={inferenceBlockedReason} />
        <Inspector config={config} setConfig={setConfig} models={models} languages={languages} result={result} recording={recording} engineBusy={recording || loading} onOpenSummarySettings={() => setSummarySettingsOpen(true)} aiSummaryConfig={aiSummaryConfig} hardwareStatus={hardwareStatus} gpuRuntimeStatus={gpuRuntimeStatus} modelStatuses={modelStatuses} onDownloadModel={handleDownloadModel} onCancelModelDownload={handleCancelModelDownload} onRemoveModel={handleRemoveModel} onInstallGpuRuntime={handleInstallGpuRuntime} onCancelGpuRuntimeInstall={handleCancelGpuRuntimeInstall} onRemoveGpuRuntime={handleRemoveGpuRuntime} />
      </div>
      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          theme={theme}
          onThemeChange={setTheme}
          googleAuth={googleAuth}
          googleBusy={googleAuthBusy}
          googleError={googleAuthError}
          onGoogleSignIn={handleGoogleSignIn}
          onGoogleSignOut={handleGoogleSignOut}
        />
      )}
      {summarySettingsOpen && <SummaryApiModal status={aiSummaryConfig} onClose={() => setSummarySettingsOpen(false)} onSave={handleSaveAiSummary} onClear={handleClearAiSummary} />}
      {pendingRemoval && (
        <RemovalConfirmModal
          title={pendingRemoval.kind === "model" ? "Gỡ model khỏi thiết bị?" : "Gỡ tăng tốc GPU?"}
          itemName={pendingRemoval.name}
          size={pendingRemoval.size}
          description={pendingRemoval.kind === "model"
            ? "Model sẽ bị xoá khỏi máy và không thể sử dụng cho đến khi được tải lại."
            : "Chỉ runtime do VoicifyAI tải sẽ bị xoá. NVIDIA Driver và CUDA của ứng dụng khác không bị ảnh hưởng."}
          busy={confirmingRemoval}
          onClose={() => !confirmingRemoval && setPendingRemoval(null)}
          onConfirm={confirmPendingRemoval}
        />
      )}
    </div>
  );
}
