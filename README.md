# Driver Drowsiness Detection

Driver Drowsiness Detection is a webcam-based application for detecting whether
a driver appears `awake` or `drowsy`. The current default deployment runs
inference directly in the browser with TensorFlow.js and a YOLO26n model.

The backend is intentionally kept in the repository as a backup, reference, and
possible VM fallback path.

## Current Architecture

Default browser inference flow:

```text
Camera
-> React/Vite frontend
-> TensorFlow.js YOLO26n
-> Postprocessing
-> Tracker/Alarm
-> UI
```

Fallback backend inference flow:

```text
Camera
-> React/Vite frontend
-> POST /predict
-> FastAPI backend
-> YOLO .pt model
-> UI
```

The project originally used server-side inference through FastAPI. During public
deployment testing, repeated frame uploads over the internet introduced enough
latency to reduce the effective FPS. The client-side TF.js path removes the
network round trip and keeps the camera, inference, postprocessing, tracker, and
alarm loop in the browser.

## Model Choice

The current browser deployment uses **YOLO26n V4**. It was selected because it
gave the fastest browser inference time and the best FPS during web testing,
while keeping validation metrics competitive.

There is a trade-off: YOLO26n is lighter and faster, but less robust in some
ambiguous awake gestures than larger models. Known false-positive cases include:

- smiling while eyes are closed can be detected as `drowsy`
- some eating gestures can be detected as `drowsy`

The tracker/alarm logic reduces one-frame noise by requiring repeated drowsy
detections before escalating status, but these cases remain model behavior
limitations.

## Model Comparison

The table below is taken from
`notebooks/drowsiness-model-comparison_v2.ipynb`. The timing numbers are native
YOLO/PyTorch benchmark results; browser TF.js speed should be measured through
the frontend metrics export.

| Model | Precision | Recall | F1 | mAP50 | mAP50-95 | Time ms | FPS | Params M | Size MB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| YOLO11s Baseline | 0.8873 | 0.8975 | 0.8924 | 0.9514 | 0.6675 | 14.1368 | 70.7570 | 9.43 | 18.30 |
| YOLO11s V2 | 0.8676 | 0.9500 | 0.9069 | 0.9619 | 0.6209 | 14.0831 | 71.0102 | 9.43 | 18.30 |
| YOLO11s V3 | 0.8424 | 0.8895 | 0.8653 | 0.9288 | 0.5967 | 14.0353 | 71.2505 | 9.43 | 18.30 |
| YOLO11n V4 | 0.8605 | 0.8420 | 0.8512 | 0.9320 | 0.5527 | 12.7775 | 78.2770 | 2.59 | 5.22 |
| YOLO26s Baseline | 0.8636 | 0.8221 | 0.8424 | 0.9159 | 0.6077 | 14.2379 | 70.2426 | 9.95 | 19.38 |
| YOLO26s V2 | 0.9130 | 0.8960 | 0.9044 | 0.9485 | 0.6561 | 14.3926 | 69.4919 | 9.95 | 19.39 |
| YOLO26s V3 | 0.9246 | 0.8858 | 0.9048 | 0.9506 | 0.6383 | 14.1946 | 70.4521 | 9.95 | 19.39 |
| YOLO26n V4 | 0.9038 | 0.9138 | 0.9088 | 0.9557 | 0.6394 | 13.6936 | 73.0351 | 2.50 | 5.16 |

Interpretation:

- `YOLO26n V4` is the best current browser-deployment candidate because it keeps
  strong recall/F1 with much smaller size.
- `YOLO26s V3` has the highest precision, but the larger model is heavier for
  browser deployment.
- Browser testing ultimately favored YOLO26n because client-side FPS and
  inference latency matter more for this deployment target than absolute
  precision.

## Local Development

Frontend, using the default TF.js client-side path:

```bash
cd deployment/frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open:

```text
http://127.0.0.1:5173/
```

Optional backend fallback/reference path:

```bash
make backend-build
make backend-run
```

Backend checks:

```bash
make backend-test
```

## Project Organization

```text
final_project/
├── LICENSE
├── README.md
├── Makefile                    # Backend, frontend, and testing commands
├── configs/                    # Model and training configuration
├── data/                       # Raw, interim, processed, and external datasets
├── deployment/
│   ├── backend/                # FastAPI backend fallback/reference service
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   ├── app/                # API route, detector, tracker, config
│   │   └── models/             # Backend YOLO weights
│   └── frontend/               # React/Vite + TensorFlow.js application
│       ├── package.json
│       ├── vite.config.js
│       ├── index.html
│       ├── public/             # TF.js model assets and alarm audio
│       └── src/                # App, TF.js detector, postprocess, tracker, CSS
├── docs/                       # Project documentation
├── models/                     # Trained/exported model artifacts
├── notebooks/                  # Model comparison and development notebooks
├── references/                 # Supporting materials
├── reports/                    # Latency logs, summaries, and benchmarks
└── src/                        # Legacy/experimental source code
```
