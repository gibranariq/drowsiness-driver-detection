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
            <p className="eyebrow">Webcam monitor</p>
            <h1>Driver Drowsiness Detection</h1>
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
      </section>
    </main>
  );
}

export default App;
