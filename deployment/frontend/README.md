# Driver Drowsiness Detection Frontend

React + Vite frontend for browser webcam preview and realtime drowsiness detection.

## Local Run

Start the FastAPI backend first:

```bash
cd ../backend
source ../../venv/bin/activate
uvicorn app.main:app --reload
```

Then start the frontend:

```bash
cd deployment/frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open the Vite URL shown in the terminal, usually:

```text
http://127.0.0.1:5173
```

## Phase 5 Scope

- Uses browser webcam preview.
- Starts realtime prediction when `Start Detection` is clicked.
- Sends webcam frames to FastAPI `POST /predict` at the configured interval.
- Stops prediction when `Stop Detection`, `Stop Camera`, or page cleanup runs.
- Updates the UI using backend responses.
- Plays browser alarm audio when `alarm_active` changes from false to true.

## Environment

Create a local `.env` if you need to override defaults:

```text
VITE_API_BASE_URL=http://localhost:8000
VITE_PREDICTION_INTERVAL_MS=100
VITE_CAPTURE_WIDTH=416
VITE_ENABLE_METRICS_EXPORT=true
```

`VITE_CAPTURE_WIDTH` resizes the captured webcam frame before upload while preserving aspect ratio.

## Performance QA

The status panel shows lightweight local performance metrics:

- request latency
- backend total time
- model inference time
- approximate successful prediction FPS

These metrics are for local tuning only and are not stored.

When `VITE_ENABLE_METRICS_EXPORT=true`, the app temporarily keeps successful
prediction samples in browser memory and can download them as
`latency_test_web.csv`. Set it to `false` to hide the export controls.

## Alarm Audio

Place the real alarm audio file here:

```text
deployment/frontend/public/alarm.wav
```

If `alarm.wav` is missing or browser playback is blocked, the app keeps running and shows a short message.
