import { useEffect, useRef, useState } from "react";
import {
  CAPTURE_WIDTH,
  initialPrediction,
  IS_METRICS_EXPORT_ENABLED,
  predictFrame,
  PREDICTION_INTERVAL_MS,
} from "./api.js";

const MAX_DROWSY_COUNTER = 20;
const FPS_WINDOW_MS = 5000;
const STATUS_CLASS_NAMES = {
  Awake: "awake",
  "Suspected Drowsy": "suspected",
  "WARNING!": "warning",
};
const initialPerformanceMetrics = {
  requestLatencyMs: null,
  backendTotalMs: null,
  inferenceMs: null,
  fps: null,
};
const CSV_COLUMNS = [
  "sample",
  "timestamp",
  "request_latency_ms",
  "backend_total_ms",
  "inference_ms",
  "decode_ms",
  "tracker_ms",
  "approx_fps",
  "detected_label",
  "confidence",
  "status",
  "drowsy_counter",
  "warning_counter",
  "alarm_active",
];

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

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const isDetectionRunningRef = useRef(false);
  const isRequestInFlightRef = useRef(false);
  const previousAlarmActiveRef = useRef(false);
  const successfulPredictionTimesRef = useRef([]);
  const alarmRef = useRef(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isDetectionRunning, setIsDetectionRunning] = useState(false);
  const [cameraMessage, setCameraMessage] = useState("");
  const [prediction, setPrediction] = useState(initialPrediction);
  const [performanceMetrics, setPerformanceMetrics] = useState(
    initialPerformanceMetrics,
  );
  const [metricSamples, setMetricSamples] = useState([]);

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
  };

  const stopCamera = () => {
    stopDetection();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsCameraActive(false);
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

  const captureFrameBlob = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas || !streamRef.current) {
      throw new Error("Start the camera before analyzing a frame.");
    }

    if (!video.videoWidth || !video.videoHeight) {
      throw new Error("Camera frame is not ready yet.");
    }

    const targetWidth = Math.min(CAPTURE_WIDTH, video.videoWidth);
    const targetHeight = Math.round(
      (targetWidth / video.videoWidth) * video.videoHeight,
    );

    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to prepare the frame capture canvas.");
    }

    context.drawImage(video, 0, 0, targetWidth, targetHeight);

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
            return;
          }

          reject(new Error("Unable to capture the current frame."));
        },
        "image/jpeg",
        0.9,
      );
    });
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
          request_latency_ms: result.request_latency_ms ?? "",
          backend_total_ms: result.total_backend_ms ?? "",
          inference_ms: result.inference_ms ?? "",
          decode_ms: result.decode_ms ?? "",
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
      const frameBlob = await captureFrameBlob();
      const result = await predictFrame(frameBlob);

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
    setCameraMessage("");
    successfulPredictionTimesRef.current = [];
    setPerformanceMetrics(initialPerformanceMetrics);
    previousAlarmActiveRef.current = prediction.alarm_active;
    isDetectionRunningRef.current = true;
    setIsDetectionRunning(true);
    runPredictionCycle();
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const statusClassName = STATUS_CLASS_NAMES[prediction.status] || "awake";
  const confidencePercent = Math.round(prediction.confidence * 100);
  const progressPercent = Math.min(
    (prediction.drowsy_counter / MAX_DROWSY_COUNTER) * 100,
    100,
  );

  return (
    <main className="app-shell">
      <section className="workspace">
        <div className="camera-panel">
          <div className="page-heading">
            <p className="eyebrow">Webcam monitor</p>
            <h1>Driver Drowsiness Detection</h1>
          </div>

          <div className="video-frame">
            <video
              ref={videoRef}
              className="webcam-video"
              autoPlay
              muted
              playsInline
            />
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

        <aside className="status-card">
          <div className={`status-header ${statusClassName}`}>
            <span className={`status-dot ${statusClassName}`} />
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
              <dt>Request latency</dt>
              <dd>{formatMetric(performanceMetrics.requestLatencyMs)}</dd>
            </div>
            <div className="metric">
              <dt>Backend total</dt>
              <dd>{formatMetric(performanceMetrics.backendTotalMs)}</dd>
            </div>
            <div className="metric">
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
      </section>
    </main>
  );
}

export default App;
