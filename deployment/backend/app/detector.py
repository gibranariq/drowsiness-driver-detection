from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np
from ultralytics import YOLO

from app.config import CONF_THRESHOLD, IOU_THRESHOLD, MODEL_PATH


@dataclass(frozen=True)
class DetectionResult:
    detected_label: str
    confidence: float
    bbox: Optional[list[int]]


class DrowsinessDetector:
    def __init__(self, model_path: str = MODEL_PATH) -> None:
        self.model = YOLO(model_path)

    def decode_image(self, image_bytes: bytes) -> np.ndarray:
        image_array = np.frombuffer(image_bytes, dtype=np.uint8)
        image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)

        if image is None:
            raise ValueError("Uploaded file is not a valid image.")

        return image

    def predict(self, image: np.ndarray) -> DetectionResult:
        results = self.model.predict(
            source=image,
            conf=CONF_THRESHOLD,
            iou=IOU_THRESHOLD,
            verbose=False,
        )

        boxes = results[0].boxes

        if boxes is None or len(boxes) == 0:
            return DetectionResult(
                detected_label="none",
                confidence=0.0,
                bbox=None,
            )

        best_idx = int(boxes.conf.argmax().item())
        cls_id = int(boxes.cls[best_idx].item())
        detected_label = self._get_label(cls_id)
        confidence = float(boxes.conf[best_idx].item())
        bbox = [int(round(value)) for value in boxes.xyxy[best_idx].tolist()]

        return DetectionResult(
            detected_label=detected_label,
            confidence=confidence,
            bbox=bbox,
        )

    def _get_label(self, cls_id: int) -> str:
        names = self.model.names

        if isinstance(names, dict):
            return str(names.get(cls_id, cls_id))

        return str(names[cls_id])
