# Driver Drowsiness Detection Frontend

React + Vite frontend for browser webcam preview and realtime drowsiness
detection. The active flow runs inference in the browser with TensorFlow.js and
the YOLO26n model.

## Active Flow

```text
Camera
-> Preprocess
-> TF.js YOLO26n
-> Postprocess
-> Tracker/Alarm
-> UI
```

No backend request is made during the default detection flow.

The FastAPI `POST /predict` backend path is still kept in the project as a
fallback/reference path, but it is not used by the default UI.

## Local Run

Start the frontend:

```bash
cd deployment/frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open the Vite URL shown in the terminal, usually:

```text
http://127.0.0.1:5173
```

## Current Behavior

- Uses browser webcam preview.
- Starts realtime prediction when `Start Detection` is clicked.
- Runs client-side TF.js inference from the browser frame.
- Converts model output through frontend postprocessing.
- Draws a bounding box overlay on the camera preview.
- Updates detected label, confidence, status, drowsy counter, warning counter,
  and alarm state.
- Stops prediction when `Stop Detection`, `Stop Camera`, or page cleanup runs.
- Keeps the backend helper available as a fallback/reference only.

## Model Choice

The frontend uses **YOLO26n** for the current client-side deployment because it
gave the fastest browser inference time and best FPS in web testing.

Known trade-offs:

- smiling while eyes are closed can be detected as `drowsy`
- some eating gestures can be detected as `drowsy`

The tracker/alarm logic helps reduce one-frame noise, but these cases remain
model behavior limitations.

## Environment

Create a local `.env` if you need to override defaults:

```text
VITE_API_BASE_URL=http://localhost:8000
VITE_PREDICTION_INTERVAL_MS=100
VITE_CAPTURE_WIDTH=640
VITE_ENABLE_METRICS_EXPORT=true
```

Active TF.js settings:

- `VITE_PREDICTION_INTERVAL_MS` controls the client-side detection cycle.
- `VITE_ENABLE_METRICS_EXPORT` shows or hides CSV export controls.

Legacy backend fallback settings:

- `VITE_API_BASE_URL` only applies if the legacy `POST /predict` helper is
  reconnected later.
- `VITE_CAPTURE_WIDTH` only applies to the old backend frame upload path.

## Performance QA

The status panel shows lightweight local performance metrics:

- total client-side cycle time
- model inference time
- approximate successful prediction FPS

When `VITE_ENABLE_METRICS_EXPORT=true`, the app temporarily keeps successful
prediction samples in browser memory and can download them as
`latency_test_web.csv`.

For the current TF.js path, the most relevant CSV fields are:

- `inference_ms`
- `tracker_ms`
- `approx_fps`
- `detected_label`
- `confidence`
- `status`
- `drowsy_counter`
- `warning_counter`
- `alarm_active`

Backend-only fields such as request latency or backend total time are retained
for compatibility with older CSV analysis, but they are empty in the default
TF.js flow.

## Alarm Audio

Place the real alarm audio file here:

```text
deployment/frontend/public/alarm.wav
```

If `alarm.wav` is missing or browser playback is blocked, the app keeps running
and shows a short message.
