const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const DEFAULT_PREDICTION_INTERVAL_MS = 500;
const DEFAULT_CAPTURE_WIDTH = 416;
const ENABLE_METRICS_EXPORT =
  import.meta.env.VITE_ENABLE_METRICS_EXPORT === "true";

const parsedPredictionInterval = Number(
  import.meta.env.VITE_PREDICTION_INTERVAL_MS,
);
const parsedCaptureWidth = Number(import.meta.env.VITE_CAPTURE_WIDTH);

export const PREDICTION_INTERVAL_MS =
  Number.isFinite(parsedPredictionInterval) && parsedPredictionInterval > 0
    ? parsedPredictionInterval
    : DEFAULT_PREDICTION_INTERVAL_MS;

export const CAPTURE_WIDTH =
  Number.isFinite(parsedCaptureWidth) && parsedCaptureWidth > 0
    ? parsedCaptureWidth
    : DEFAULT_CAPTURE_WIDTH;

export const IS_METRICS_EXPORT_ENABLED = ENABLE_METRICS_EXPORT;

export const initialPrediction = {
  detected_label: "none",
  confidence: 0,
  status: "Awake",
  drowsy_counter: 0,
  warning_counter: 0,
  alarm_active: false,
};

export async function predictFrame(frameBlob) {
  const formData = new FormData();
  formData.append("file", frameBlob, "frame.jpg");

  const requestStart = performance.now();
  const response = await fetch(`${API_BASE_URL}/predict`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Prediction request failed.");
  }

  const data = await response.json();
  const requestLatencyMs = performance.now() - requestStart;

  return {
    ...data,
    request_latency_ms: Math.round(requestLatencyMs * 100) / 100,
  };
}
