use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tungstenite::{connect, Message};
use wasapi::{initialize_mta, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};

const TARGET_RATE: u32 = 16_000;
const CHUNK_SECONDS: usize = 4;
const OVERLAP_SAMPLES: usize = 8_000;
const CHUNK_SAMPLES: usize = TARGET_RATE as usize * CHUNK_SECONDS;
const STEP_SAMPLES: usize = CHUNK_SAMPLES - OVERLAP_SAMPLES;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LevelEvent {
    source: String,
    level: f32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureErrorEvent {
    source: String,
    message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureStatusEvent {
    source: String,
    active: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceInfo {
    id: String,
    name: String,
    is_default: bool,
}

#[derive(Deserialize)]
struct ServerMessage {
    #[serde(rename = "type")]
    kind: String,
    message: Option<String>,
    #[serde(flatten)]
    payload: HashMap<String, Value>,
}

struct AudioBlock {
    samples: Vec<f32>,
    sample_rate: u32,
}

#[derive(Default)]
struct Runtime {
    stops: HashMap<String, Arc<AtomicBool>>,
    paused: Option<Arc<AtomicBool>>,
}

pub struct CaptureManager {
    runtime: Mutex<Runtime>,
    backend: Mutex<Option<Child>>,
}

impl Default for CaptureManager {
    fn default() -> Self {
        Self {
            runtime: Mutex::new(Runtime::default()),
            backend: Mutex::new(None),
        }
    }
}

impl CaptureManager {
    fn stop_all(&self) {
        let mut runtime = self.runtime.lock().expect("capture state poisoned");
        for stop in runtime.stops.values() {
            stop.store(true, Ordering::Relaxed);
        }
        runtime.stops.clear();
        runtime.paused = None;
    }

    fn ensure_backend(&self) -> Result<(), String> {
        if backend_is_ready() {
            return Ok(());
        }

        let mut backend = self
            .backend
            .lock()
            .map_err(|_| "Không thể khóa tiến trình FastAPI")?;
        if let Some(child) = backend.as_mut() {
            if child
                .try_wait()
                .map_err(|error| error.to_string())?
                .is_none()
            {
                return wait_for_backend();
            }
            *backend = None;
        }

        let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or("Không xác định được thư mục dự án")?
            .to_path_buf();
        let mut command = Command::new("python.exe");
        command
            .args([
                "-m",
                "uvicorn",
                "api.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                "8765",
            ])
            .current_dir(project_root)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        let child = command
            .spawn()
            .map_err(|error| format!("Không thể khởi động FastAPI bằng Python: {error}"))?;
        *backend = Some(child);
        drop(backend);
        wait_for_backend()
    }
}

impl Drop for CaptureManager {
    fn drop(&mut self) {
        self.stop_all();
        if let Ok(mut backend) = self.backend.lock() {
            if let Some(child) = backend.as_mut() {
                let _ = child.kill();
            }
        }
    }
}

fn backend_is_ready() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], 8765));
    TcpStream::connect_timeout(&address, Duration::from_millis(200)).is_ok()
}

fn wait_for_backend() -> Result<(), String> {
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(20) {
        if backend_is_ready() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(150));
    }
    Err(
        "FastAPI không khởi động trong 20 giây. Hãy kiểm tra Python và api/requirements.txt."
            .to_string(),
    )
}

#[tauri::command]
pub fn list_microphones() -> Result<Vec<AudioDeviceInfo>, String> {
    let host = cpal::default_host();
    let default_name = host
        .default_input_device()
        .and_then(|device| device.name().ok());
    let devices = host.input_devices().map_err(|error| error.to_string())?;
    let mut result = Vec::new();
    for device in devices {
        let name = device.name().map_err(|error| error.to_string())?;
        result.push(AudioDeviceInfo {
            id: name.clone(),
            is_default: default_name.as_deref() == Some(name.as_str()),
            name,
        });
    }
    result.sort_by_key(|device| !device.is_default);
    Ok(result)
}

#[tauri::command]
pub fn start_capture(
    sources: Vec<String>,
    websocket_url: String,
    config: Value,
    microphone_device: Option<String>,
    app: AppHandle,
    manager: State<'_, CaptureManager>,
) -> Result<(), String> {
    if sources.is_empty() {
        return Err("Hãy chọn ít nhất một nguồn thu".to_string());
    }
    if sources
        .iter()
        .any(|source| source != "mic" && source != "system")
    {
        return Err("Nguồn thu không hợp lệ".to_string());
    }

    manager.ensure_backend()?;
    manager.stop_all();
    let paused = Arc::new(AtomicBool::new(false));
    let session_started = Instant::now();
    let mut runtime = manager
        .runtime
        .lock()
        .map_err(|_| "Không thể khóa trạng thái thu")?;

    for source in sources {
        let stop = Arc::new(AtomicBool::new(false));
        runtime.stops.insert(source.clone(), stop.clone());
        spawn_source(
            source,
            websocket_url.clone(),
            config.clone(),
            microphone_device.clone(),
            stop,
            paused.clone(),
            session_started,
            app.clone(),
        );
    }
    runtime.paused = Some(paused);
    Ok(())
}

#[tauri::command]
pub fn pause_capture(paused: bool, manager: State<'_, CaptureManager>) -> Result<(), String> {
    let runtime = manager
        .runtime
        .lock()
        .map_err(|_| "Không thể khóa trạng thái thu")?;
    let flag = runtime
        .paused
        .as_ref()
        .ok_or("Chưa có phiên thu đang chạy")?;
    flag.store(paused, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn stop_capture(manager: State<'_, CaptureManager>) {
    manager.stop_all();
}

fn spawn_source(
    source: String,
    websocket_url: String,
    config: Value,
    microphone_device: Option<String>,
    stop: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    session_started: Instant,
    app: AppHandle,
) {
    let (sender, receiver) = mpsc::sync_channel::<AudioBlock>(128);
    let capture_source = source.clone();
    let capture_stop = stop.clone();
    let capture_paused = paused.clone();
    let capture_app = app.clone();
    thread::Builder::new()
        .name(format!("capture-{capture_source}"))
        .spawn(move || {
            let result = if capture_source == "mic" {
                run_microphone(
                    sender,
                    capture_stop,
                    capture_paused,
                    microphone_device,
                    capture_app.clone(),
                )
            } else {
                run_system_loopback(sender, capture_stop, capture_paused)
            };
            if let Err(message) = result {
                emit_error(&capture_app, &capture_source, message);
            }
            let _ = capture_app.emit(
                "capture-status",
                CaptureStatusEvent {
                    source: capture_source,
                    active: false,
                },
            );
        })
        .ok();

    thread::Builder::new()
        .name(format!("stream-{source}"))
        .spawn(move || {
            if let Err(message) = stream_audio(
                receiver,
                &source,
                &websocket_url,
                config,
                stop,
                paused,
                session_started,
                &app,
            ) {
                emit_error(&app, &source, message);
            }
            let _ = app.emit(
                "transcript-stream-finished",
                CaptureStatusEvent {
                    source,
                    active: false,
                },
            );
        })
        .ok();
}

fn run_microphone(
    sender: SyncSender<AudioBlock>,
    stop: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    selected_device: Option<String>,
    app: AppHandle,
) -> Result<(), String> {
    let host = cpal::default_host();
    let device = if let Some(selected_name) = selected_device {
        host.input_devices()
            .map_err(|error| error.to_string())?
            .find(|device| device.name().ok().as_deref() == Some(selected_name.as_str()))
            .ok_or_else(|| format!("Không tìm thấy microphone đã chọn: {selected_name}"))?
    } else {
        host.default_input_device()
            .ok_or("Không tìm thấy microphone mặc định")?
    };
    let supported = device
        .default_input_config()
        .map_err(|error| error.to_string())?;
    let sample_rate = supported.sample_rate().0;
    let channels = supported.channels() as usize;
    let config: cpal::StreamConfig = supported.clone().into();
    let error_app = app.clone();
    let error_callback =
        move |error: cpal::StreamError| emit_error(&error_app, "mic", error.to_string());

    let stream = match supported.sample_format() {
        cpal::SampleFormat::F32 => {
            let tx = sender.clone();
            let pause = paused.clone();
            device.build_input_stream(
                &config,
                move |data: &[f32], _| send_mono_f32(data, channels, sample_rate, &tx, &pause),
                error_callback,
                None,
            )
        }
        cpal::SampleFormat::I16 => {
            let tx = sender.clone();
            let pause = paused.clone();
            device.build_input_stream(
                &config,
                move |data: &[i16], _| {
                    let converted: Vec<f32> =
                        data.iter().map(|value| *value as f32 / 32768.0).collect();
                    send_mono_f32(&converted, channels, sample_rate, &tx, &pause);
                },
                error_callback,
                None,
            )
        }
        cpal::SampleFormat::U16 => {
            let tx = sender;
            let pause = paused.clone();
            device.build_input_stream(
                &config,
                move |data: &[u16], _| {
                    let converted: Vec<f32> = data
                        .iter()
                        .map(|value| (*value as f32 - 32768.0) / 32768.0)
                        .collect();
                    send_mono_f32(&converted, channels, sample_rate, &tx, &pause);
                },
                error_callback,
                None,
            )
        }
        format => return Err(format!("Định dạng microphone chưa hỗ trợ: {format:?}")),
    }
    .map_err(|error| error.to_string())?;

    stream.play().map_err(|error| error.to_string())?;
    let _ = app.emit(
        "capture-status",
        CaptureStatusEvent {
            source: "mic".into(),
            active: true,
        },
    );
    while !stop.load(Ordering::Relaxed) {
        thread::sleep(Duration::from_millis(50));
    }
    drop(stream);
    Ok(())
}

fn send_mono_f32(
    data: &[f32],
    channels: usize,
    sample_rate: u32,
    sender: &SyncSender<AudioBlock>,
    paused: &AtomicBool,
) {
    if paused.load(Ordering::Relaxed) || channels == 0 {
        return;
    }
    let samples = data
        .chunks_exact(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect();
    let _ = sender.try_send(AudioBlock {
        samples,
        sample_rate,
    });
}

fn run_system_loopback(
    sender: SyncSender<AudioBlock>,
    stop: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
) -> Result<(), String> {
    initialize_mta().ok().map_err(|error| error.to_string())?;
    let enumerator = DeviceEnumerator::new().map_err(|error| error.to_string())?;
    let device = enumerator
        .get_default_device(&Direction::Render)
        .map_err(|error| error.to_string())?;
    let mut audio_client = device
        .get_iaudioclient()
        .map_err(|error| error.to_string())?;
    let format = WaveFormat::new(32, 32, &SampleType::Float, 48_000, 2, None);
    let (_, minimum_period) = audio_client
        .get_device_period()
        .map_err(|error| error.to_string())?;
    audio_client
        .initialize_client(
            &format,
            &Direction::Capture,
            &StreamMode::EventsShared {
                autoconvert: true,
                buffer_duration_hns: minimum_period,
            },
        )
        .map_err(|error| error.to_string())?;
    let event = audio_client
        .set_get_eventhandle()
        .map_err(|error| error.to_string())?;
    let capture = audio_client
        .get_audiocaptureclient()
        .map_err(|error| error.to_string())?;
    let mut bytes = VecDeque::new();
    audio_client
        .start_stream()
        .map_err(|error| error.to_string())?;

    while !stop.load(Ordering::Relaxed) {
        if event.wait_for_event(250).is_err() {
            continue;
        }
        capture
            .read_from_device_to_deque(&mut bytes)
            .map_err(|error| error.to_string())?;
        if paused.load(Ordering::Relaxed) {
            bytes.clear();
            continue;
        }
        let frame_count = bytes.len() / 8;
        if frame_count == 0 {
            continue;
        }
        let mut samples = Vec::with_capacity(frame_count);
        for _ in 0..frame_count {
            let left = pop_f32(&mut bytes);
            let right = pop_f32(&mut bytes);
            samples.push((left + right) * 0.5);
        }
        let _ = sender.try_send(AudioBlock {
            samples,
            sample_rate: 48_000,
        });
    }
    audio_client
        .stop_stream()
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn pop_f32(bytes: &mut VecDeque<u8>) -> f32 {
    let raw = [
        bytes.pop_front().unwrap_or(0),
        bytes.pop_front().unwrap_or(0),
        bytes.pop_front().unwrap_or(0),
        bytes.pop_front().unwrap_or(0),
    ];
    f32::from_le_bytes(raw)
}

struct LinearResampler {
    source_rate: u32,
    position: f64,
    input: Vec<f32>,
}

impl LinearResampler {
    fn new(source_rate: u32) -> Self {
        Self {
            source_rate,
            position: 0.0,
            input: Vec::new(),
        }
    }

    fn process(&mut self, samples: &[f32]) -> Vec<f32> {
        self.input.extend_from_slice(samples);
        let step = self.source_rate as f64 / TARGET_RATE as f64;
        let mut output = Vec::with_capacity((samples.len() as f64 / step).ceil() as usize);
        while self.position + 1.0 < self.input.len() as f64 {
            let index = self.position.floor() as usize;
            let fraction = (self.position - index as f64) as f32;
            output.push(self.input[index] * (1.0 - fraction) + self.input[index + 1] * fraction);
            self.position += step;
        }
        let consumed = self.position.floor() as usize;
        if consumed > 0 {
            self.input
                .drain(..consumed.min(self.input.len().saturating_sub(1)));
            self.position -= consumed as f64;
        }
        output
    }
}

fn stream_audio(
    receiver: Receiver<AudioBlock>,
    source: &str,
    websocket_url: &str,
    config: Value,
    stop: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    _session_started: Instant,
    app: &AppHandle,
) -> Result<(), String> {
    let (mut socket, _) = connect(websocket_url)
        .map_err(|error| format!("Không thể kết nối API streaming tại {websocket_url}: {error}"))?;
    let handshake = serde_json::json!({ "source": source, "config": config });
    socket
        .send(Message::Text(handshake.to_string().into()))
        .map_err(|error| error.to_string())?;
    let ready = socket.read().map_err(|error| error.to_string())?;
    if !ready.is_text() {
        return Err("API streaming không xác nhận kết nối".to_string());
    }

    let mut resampler: Option<LinearResampler> = None;
    let mut rolling = Vec::<f32>::new();
    let mut chunk_index = 0_u64;
    let mut last_level = Instant::now() - Duration::from_secs(1);

    while !stop.load(Ordering::Relaxed) {
        let block = match receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(block) => block,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };
        if paused.load(Ordering::Relaxed) {
            continue;
        }
        let level = rms_level(&block.samples);
        if last_level.elapsed() >= Duration::from_millis(60) {
            let _ = app.emit(
                "audio-level",
                LevelEvent {
                    source: source.to_string(),
                    level,
                },
            );
            last_level = Instant::now();
        }
        if resampler.as_ref().map(|item| item.source_rate) != Some(block.sample_rate) {
            resampler = Some(LinearResampler::new(block.sample_rate));
        }
        rolling.extend(resampler.as_mut().unwrap().process(&block.samples));

        while rolling.len() >= CHUNK_SAMPLES {
            let samples = rolling[..CHUNK_SAMPLES].to_vec();
            let start_sec = chunk_index as f64 * STEP_SAMPLES as f64 / TARGET_RATE as f64;
            send_chunk(&mut socket, source, start_sec, &samples, app)?;
            rolling.drain(..STEP_SAMPLES);
            chunk_index += 1;
        }
    }

    if rolling.len() >= TARGET_RATE as usize / 2 {
        let start_sec = chunk_index as f64 * STEP_SAMPLES as f64 / TARGET_RATE as f64;
        let _ = send_chunk(&mut socket, source, start_sec, &rolling, app);
    }
    let _ = socket.close(None);
    let _ = app.emit(
        "audio-level",
        LevelEvent {
            source: source.to_string(),
            level: 0.0,
        },
    );
    Ok(())
}

fn send_chunk<S: std::io::Read + std::io::Write>(
    socket: &mut tungstenite::WebSocket<S>,
    source: &str,
    start_sec: f64,
    samples: &[f32],
    app: &AppHandle,
) -> Result<(), String> {
    let mut packet = Vec::with_capacity(8 + samples.len() * 2);
    packet.extend_from_slice(&start_sec.to_le_bytes());
    for sample in samples {
        let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        packet.extend_from_slice(&value.to_le_bytes());
    }
    socket
        .send(Message::Binary(packet.into()))
        .map_err(|error| error.to_string())?;
    let message = socket.read().map_err(|error| error.to_string())?;
    if let Message::Text(text) = message {
        let parsed: ServerMessage =
            serde_json::from_str(&text).map_err(|error| error.to_string())?;
        if parsed.kind == "error" {
            return Err(parsed
                .message
                .unwrap_or_else(|| "Lỗi streaming không xác định".into()));
        }
        let mut payload = parsed.payload;
        payload.insert("type".into(), Value::String(parsed.kind));
        payload.insert("source".into(), Value::String(source.to_string()));
        app.emit("transcript-segment", payload)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn rms_level(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let mean_square =
        samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32;
    (mean_square.sqrt() * 4.0).clamp(0.0, 1.0)
}

fn emit_error(app: &AppHandle, source: &str, message: String) {
    let _ = app.emit(
        "capture-error",
        CaptureErrorEvent {
            source: source.to_string(),
            message,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resampler_converts_48khz_to_16khz() {
        let mut resampler = LinearResampler::new(48_000);
        let output = resampler.process(&vec![0.5; 48_000]);
        assert!((output.len() as isize - 16_000).abs() <= 1);
        assert!(output.iter().all(|sample| (*sample - 0.5).abs() < 0.0001));
    }

    #[test]
    fn rms_level_is_bounded() {
        assert_eq!(rms_level(&[]), 0.0);
        assert_eq!(rms_level(&[1.0, -1.0]), 1.0);
    }
}
