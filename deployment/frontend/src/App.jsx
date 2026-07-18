import { useEffect, useRef, useState } from "react";
import {
  initialPrediction,
  IS_METRICS_EXPORT_ENABLED,
  PREDICTION_INTERVAL_MS,
} from "./api.js";
import { createDetector } from "./detector_tfjs.js";
import { CONTINUOUS_DROWSY_THRESHOLD, createTracker } from "./tracker.js";

const MAX_DROWSY_COUNTER = CONTINUOUS_DROWSY_THRESHOLD;
const FPS_WINDOW_MS = 5000;
const STATUS_CLASS_NAMES = {
  Awake: "awake",
  "Suspected Drowsy": "suspected",
  "WARNING!": "warning",
};
const BBOX_DISPLAY_PADDING = {
  x: 0.18,
  top: 0.05,
  bottom: 0.35,
};
const initialPerformanceMetrics = {
  totalCycleMs: null,
  requestLatencyMs: null,
  backendTotalMs: null,
  inferenceMs: null,
  fps: null,
};
const CSV_COLUMNS = [
  "sample",
  "timestamp",
  // "request_latency_ms",
  // "backend_total_ms",
  "total_cycle_ms",
  "inference_ms",
  // "decode_ms",
  "tracker_ms",
  "approx_fps",
  "detected_label",
  "confidence",
  "status",
  "drowsy_counter",
  "warning_counter",
  "alarm_active",
];
const THEME_STORAGE_KEY = "drowsiness-detection-theme";

function formatMetric(value, suffix = "ms") {
  if (value === null || value === undefined) {
    return "--";
  }

  return `${value.toFixed(1)} ${suffix}`;
}

function formatCsvCell(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);

  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

function getBoundingBoxStyle(bbox, video, frame) {
  if (!bbox || !video?.videoWidth || !video?.videoHeight || !frame) {
    return null;
  }

  const frameWidth = frame.clientWidth;
  const frameHeight = frame.clientHeight;
  const scale = Math.max(frameWidth / video.videoWidth, frameHeight / video.videoHeight);
  const renderedWidth = video.videoWidth * scale;
  const renderedHeight = video.videoHeight * scale;
  const offsetX = (frameWidth - renderedWidth) / 2;
  const offsetY = (frameHeight - renderedHeight) / 2;
  const [rawX1, rawY1, rawX2, rawY2] = bbox;
  const bboxWidth = rawX2 - rawX1;
  const bboxHeight = rawY2 - rawY1;
  const x1 = Math.max(0, rawX1 - bboxWidth * BBOX_DISPLAY_PADDING.x);
  const y1 = Math.max(0, rawY1 - bboxHeight * BBOX_DISPLAY_PADDING.top);
  const x2 = Math.min(video.videoWidth, rawX2 + bboxWidth * BBOX_DISPLAY_PADDING.x);
  const y2 = Math.min(video.videoHeight, rawY2 + bboxHeight * BBOX_DISPLAY_PADDING.bottom);

  return {
    left: `${offsetX + x1 * scale}px`,
    top: `${offsetY + y1 * scale}px`,
    width: `${Math.max(0, (x2 - x1) * scale)}px`,
    height: `${Math.max(0, (y2 - y1) * scale)}px`,
  };
}

function App() {
  const videoRef = useRef(null);
  const videoFrameRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const isDetectionRunningRef = useRef(false);
  const isRequestInFlightRef = useRef(false);
  const previousAlarmActiveRef = useRef(false);
  const successfulPredictionTimesRef = useRef([]);
  const detectorRef = useRef(null);
  const trackerRef = useRef(createTracker());
  const alarmRef = useRef(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isDetectionRunning, setIsDetectionRunning] = useState(false);
  const [cameraMessage, setCameraMessage] = useState("");
  const [prediction, setPrediction] = useState(initialPrediction);
  const [performanceMetrics, setPerformanceMetrics] = useState(
    initialPerformanceMetrics,
  );
  const [metricSamples, setMetricSamples] = useState([]);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) === "dark"
        ? "dark"
        : "light";
    } catch {
      return "light";
    }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;

    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Theme still applies for the current session when storage is unavailable.
    }
  }, [theme]);

  const clearPredictionTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopDetection = () => {
    isDetectionRunningRef.current = false;
    clearPredictionTimer();
    setIsDetectionRunning(false);
    setPrediction(initialPrediction);
  };

  const resetTracker = () => {
    trackerRef.current.reset();
  };

  const disposeDetector = () => {
    detectorRef.current?.dispose();
    detectorRef.current = null;
  };

  const stopCamera = () => {
    stopDetection();
    disposeDetector();
    resetTracker();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsCameraActive(false);
    setPrediction(initialPrediction);
  };

  const startCamera = async () => {
    setCameraMessage("");

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraMessage("Camera access is not available in this browser.");
      return;
    }

    try {
      stopCamera();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      setIsCameraActive(true);
    } catch (error) {
      setCameraMessage(error.message || "Unable to start the camera.");
      setIsCameraActive(false);
    }
  };

  const runBrowserInference = async () => {
    const cycleStart = performance.now();
    if (!detectorRef.current) {
      detectorRef.current = await createDetector();
    }

    const inferenceResult = await detectorRef.current.predict(
      videoRef.current,
      canvasRef.current,
    );
    const inferenceMs = inferenceResult.inferenceMs;
    const trackerStart = performance.now();
    const trackerState = trackerRef.current.update(inferenceResult.detected_label);
    const trackerMs = performance.now() - trackerStart;

    console.log("Browser inference output", {
      backend: inferenceResult.backend,
      outputName: inferenceResult.outputName,
      outputDims: inferenceResult.outputDims,
      inferenceMs: Number(inferenceMs.toFixed(2)),
      preprocessMeta: inferenceResult.preprocessMeta,
      firstRows: inferenceResult.firstRows,
      prediction: {
        detected_label: inferenceResult.detected_label,
        confidence: inferenceResult.confidence,
        bbox: inferenceResult.bbox,
        ...trackerState,
      },
    });

    return {
      ...initialPrediction,
      detected_label: inferenceResult.detected_label,
      confidence: inferenceResult.confidence,
      bbox: inferenceResult.bbox,
      ...trackerState,
      total_cycle_ms: Math.round((performance.now() - cycleStart) * 100) / 100,
      request_latency_ms: "",
      total_backend_ms: "",
      inference_ms: Math.round(inferenceMs * 100) / 100,
      decode_ms: "",
      tracker_ms: Math.round(trackerMs * 100) / 100,
    };
  };

  const playAlarm = async () => {
    if (!alarmRef.current) {
      alarmRef.current = new Audio("/alarm.wav");
    }

    try {
      alarmRef.current.currentTime = 0;
      await alarmRef.current.play();
    } catch {
      setCameraMessage(
        "Alarm is active, but alarm.wav is missing or playback was blocked.",
      );
    }
  };

  const updatePerformanceMetrics = (result) => {
    const now = performance.now();
    successfulPredictionTimesRef.current = [
      ...successfulPredictionTimesRef.current,
      now,
    ].filter((timestamp) => now - timestamp <= FPS_WINDOW_MS);

    const timestamps = successfulPredictionTimesRef.current;
    let fps = 0;

    if (timestamps.length >= 2) {
      const elapsedSeconds =
        (timestamps[timestamps.length - 1] - timestamps[0]) / 1000;
      fps = elapsedSeconds > 0 ? (timestamps.length - 1) / elapsedSeconds : 0;
    }

    setPerformanceMetrics({
      totalCycleMs: result.total_cycle_ms ?? null,
      requestLatencyMs: result.request_latency_ms ?? null,
      backendTotalMs: result.total_backend_ms ?? null,
      inferenceMs: result.inference_ms ?? null,
      fps,
    });

    if (IS_METRICS_EXPORT_ENABLED) {
      setMetricSamples((samples) => [
        ...samples,
        {
          sample: samples.length + 1,
          timestamp: new Date().toISOString(),
          // request_latency_ms: result.request_latency_ms ?? "",
          // backend_total_ms: result.total_backend_ms ?? "",
          total_cycle_ms: result.total_cycle_ms ?? "",
          inference_ms: result.inference_ms ?? "",
          // decode_ms: result.decode_ms ?? "",
          tracker_ms: result.tracker_ms ?? "",
          approx_fps: Math.round(fps * 100) / 100,
          detected_label: result.detected_label,
          confidence: result.confidence,
          status: result.status,
          drowsy_counter: result.drowsy_counter,
          warning_counter: result.warning_counter,
          alarm_active: result.alarm_active,
        },
      ]);
    }
  };

  const downloadMetricsCsv = () => {
    const rows = [
      CSV_COLUMNS.join(","),
      ...metricSamples.map((sample) =>
        CSV_COLUMNS.map((column) => formatCsvCell(sample[column])).join(","),
      ),
    ];
    const blob = new Blob([`${rows.join("\n")}\n`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "latency_test_web.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const runPredictionCycle = async () => {
    if (!isDetectionRunningRef.current || isRequestInFlightRef.current) {
      return;
    }

    const cycleStart = performance.now();

    setCameraMessage("");
    isRequestInFlightRef.current = true;

    try {
      const result = await runBrowserInference();

      if (!isDetectionRunningRef.current) {
        return;
      }

      setPrediction(result);
      updatePerformanceMetrics(result);

      if (result.alarm_active && !previousAlarmActiveRef.current) {
        await playAlarm();
      }

      previousAlarmActiveRef.current = result.alarm_active;
    } catch (error) {
      stopDetection();
      setCameraMessage(error.message || "Unable to analyze the frame.");
      return;
    } finally {
      isRequestInFlightRef.current = false;
    }

    if (isDetectionRunningRef.current) {
      const elapsedMs = performance.now() - cycleStart;
      const waitMs = Math.max(0, PREDICTION_INTERVAL_MS - elapsedMs);
      timerRef.current = setTimeout(runPredictionCycle, waitMs);
    }
  };

  const startDetection = () => {
    if (isDetectionRunningRef.current) {
      return;
    }

    if (!isCameraActive) {
      setCameraMessage("Start the camera before starting detection.");
      return;
    }

    clearPredictionTimer();
    resetTracker();
    setCameraMessage("");
    setPrediction(initialPrediction);
    successfulPredictionTimesRef.current = [];
    setPerformanceMetrics(initialPerformanceMetrics);
    previousAlarmActiveRef.current = false;
    isDetectionRunningRef.current = true;
    setIsDetectionRunning(true);
    runPredictionCycle();
  };

  useEffect(() => {
    return () => {
      stopCamera();
      disposeDetector();
    };
  }, []);

  const statusClassName = STATUS_CLASS_NAMES[prediction.status] || "awake";
  const confidencePercent = Math.round(prediction.confidence * 100);
  const bboxStyle = getBoundingBoxStyle(
    prediction.bbox,
    videoRef.current,
    videoFrameRef.current,
  );
  const bboxClassName =
    prediction.detected_label === "drowsy" && statusClassName === "awake"
      ? "suspected"
      : statusClassName;
  const progressPercent = Math.min(
    (prediction.drowsy_counter / MAX_DROWSY_COUNTER) * 100,
    100,
  );

  return (
    <main className="app-shell">
      <section className="workspace">
        <div className="camera-panel">
          <div className="page-heading">
            <div>
              <p className="eyebrow">Webcam monitor</p>
              <h1>Driver Drowsiness Detection</h1>
            </div>
            <button
              className="theme-toggle"
              type="button"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
              title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            >
              {theme === "light" ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M20.5 15.5A8.5 8.5 0 0 1 8.5 3.5 8.5 8.5 0 1 0 20.5 15.5Z" />
                </svg>
              )}
            </button>
          </div>

          <div ref={videoFrameRef} className="video-frame">
            <video
              ref={videoRef}
              className="webcam-video"
              autoPlay
              muted
              playsInline
            />
            {isCameraActive && bboxStyle && (
              <div className={`bbox-overlay ${bboxClassName}`} style={bboxStyle}>
                <span className="bbox-label">
                  {prediction.detected_label} {confidencePercent}%
                </span>
              </div>
            )}
            {!isCameraActive && (
              <div className="video-placeholder">Camera is off</div>
            )}
          </div>
          <canvas ref={canvasRef} className="hidden-canvas" />

          <div className="camera-controls">
            <button
              className="button primary"
              type="button"
              onClick={startCamera}
              disabled={isCameraActive}
            >
              Start Camera
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={stopCamera}
              disabled={!isCameraActive}
            >
              Stop Camera
            </button>
            <button
              className="button analyze"
              type="button"
              onClick={startDetection}
              disabled={!isCameraActive || isDetectionRunning}
            >
              Start Detection
            </button>
            <button
              className="button stop-detection"
              type="button"
              onClick={stopDetection}
              disabled={!isDetectionRunning}
            >
              Stop Detection
            </button>
          </div>

          {cameraMessage && (
            <p className="camera-message" role="status">
              {cameraMessage}
            </p>
          )}
        </div>

        <div className="status-column">
          <aside className="status-card">
          <div className={`status-header ${statusClassName}`}>
            <div>
              <p className="eyebrow">Current status</p>
              <h2>{prediction.status}</h2>
            </div>
          </div>

          <dl className="metric-grid">
            <div className="metric">
              <dt>Detected label</dt>
              <dd>{prediction.detected_label}</dd>
            </div>
            <div className="metric">
              <dt>Confidence</dt>
              <dd>{confidencePercent}%</dd>
            </div>
            <div className="metric">
              <dt>Drowsy counter</dt>
              <dd>{prediction.drowsy_counter}</dd>
            </div>
            <div className="metric">
              <dt>Warning counter</dt>
              <dd>{prediction.warning_counter}</dd>
            </div>
            <div className="metric">
              <dt>Alarm state</dt>
              <dd>{prediction.alarm_active ? "Active" : "Inactive"}</dd>
            </div>
            {/* <div className="metric">
              <dt>Total cycle</dt>
              <dd>{formatMetric(performanceMetrics.totalCycleMs)}</dd>
            </div> */}
            {/*
            <div className="metric">
              <dt>Request latency</dt>
              <dd>{formatMetric(performanceMetrics.requestLatencyMs)}</dd>
            </div>
            <div className="metric">
              <dt>Backend total</dt>
              <dd>{formatMetric(performanceMetrics.backendTotalMs)}</dd>
            </div>
            */}
            {/* <div className="metric">
              <dt>Model inference</dt>
              <dd>{formatMetric(performanceMetrics.inferenceMs)}</dd>
            </div> */}
            <div className="metric">
              <dt>Approx FPS</dt>
              <dd>{formatMetric(performanceMetrics.fps, "fps")}</dd>
            </div>
          </dl>

          <div className="progress-block">
            <div className="progress-label">
              <span>Drowsy progress</span>
              <span>
                {prediction.drowsy_counter}/{MAX_DROWSY_COUNTER}
              </span>
            </div>
            <div className="progress-track">
              <div
                className={`progress-value ${statusClassName}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {IS_METRICS_EXPORT_ENABLED && (
            <div className="export-panel">
              <p className="export-count">Samples: {metricSamples.length}</p>
              <div className="export-actions">
                <button
                  className="button secondary compact"
                  type="button"
                  onClick={downloadMetricsCsv}
                  disabled={metricSamples.length === 0}
                >
                  Download CSV
                </button>
                <button
                  className="button secondary compact"
                  type="button"
                  onClick={() => setMetricSamples([])}
                  disabled={metricSamples.length === 0}
                >
                  Clear Samples
                </button>
              </div>
            </div>
          )}
          </aside>

          <div className="drowsy-guide">
            <span className="drowsy-guide-icon" aria-hidden="true">i</span>
            <p>
              Alarm activates after 20 consecutive drowsy frames or 3 warning
              events.
            </p>
          </div>
        </div>
      </section>

      <footer className="app-footer">
        <span>&copy; 2026 Gibran Ariq Natakusuma. All rights reserved.</span>
        <nav className="footer-links" aria-label="Contact links">
          <a href="mailto:gibranariq15@gmail.com" aria-label="Email Gibran Ariq Natakusuma" title="Email">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 5h18v14H3z" />
              <path d="m3 7 9 6 9-6" />
            </svg>
            <span>Email</span>
          </a>
          <a
            href="https://www.linkedin.com/in/gibranariqnatakusuma/"
            target="_blank"
            rel="noreferrer"
            aria-label="LinkedIn profile"
            title="LinkedIn"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 8v11" />
              <path d="M5 5v.01" />
              <path d="M9 19V8" />
              <path d="M9 12c0-2 1.3-4 4-4 2.2 0 3.5 1.4 3.5 4v7" />
              <path d="M16.5 12v7" />
            </svg>
            <span>LinkedIn</span>
          </a>
          <a
            href="https://github.com/gibranariq?tab=repositories"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub repositories"
            title="GitHub"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 19c-4 1.3-4-2-5.5-2.5M14.5 21v-3.2c0-.9.1-1.4-.4-2 2.7-.3 5.5-1.3 5.5-6a4.7 4.7 0 0 0-1.3-3.3A4.4 4.4 0 0 0 18.2 3S17 2.6 14.5 4a11.5 11.5 0 0 0-5 0C7 2.6 5.8 3 5.8 3a4.4 4.4 0 0 0-.1 3.5 4.7 4.7 0 0 0-1.3 3.3c0 4.7 2.8 5.7 5.5 6-.5.4-.5 1.1-.4 2V21" />
            </svg>
            <span>GitHub</span>
          </a>
        </nav>
      </footer>
    </main>
  );
}

export default App;
