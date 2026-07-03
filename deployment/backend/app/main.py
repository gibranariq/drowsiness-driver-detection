import time

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.detector import DrowsinessDetector
from app.tracker import DrowsinessTracker

app = FastAPI(title="Drowsiness Detection API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

detector = DrowsinessDetector()
tracker = DrowsinessTracker()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/predict")
async def predict(file: UploadFile = File(...)) -> dict:
    total_start = time.perf_counter()
    image_bytes = await file.read()

    try:
        decode_start = time.perf_counter()
        image = detector.decode_image(image_bytes)
        decode_ms = (time.perf_counter() - decode_start) * 1000
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    inference_start = time.perf_counter()
    detection = detector.predict(image)
    inference_ms = (time.perf_counter() - inference_start) * 1000

    tracker_start = time.perf_counter()
    tracker_state = tracker.update(detection.detected_label)
    tracker_ms = (time.perf_counter() - tracker_start) * 1000
    total_backend_ms = (time.perf_counter() - total_start) * 1000

    return {
        "detected_label": detection.detected_label,
        "confidence": detection.confidence,
        "bbox": detection.bbox,
        "status": tracker_state.status,
        "drowsy_counter": tracker_state.drowsy_counter,
        "warning_counter": tracker_state.warning_counter,
        "alarm_active": tracker_state.alarm_active,
        "decode_ms": round(decode_ms, 2),
        "inference_ms": round(inference_ms, 2),
        "tracker_ms": round(tracker_ms, 2),
        "total_backend_ms": round(total_backend_ms, 2),
    }


@app.post("/reset")
def reset() -> dict[str, str]:
    tracker.reset()
    return {"message": "tracker reset"}
