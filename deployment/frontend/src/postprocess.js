export const DEFAULT_CONFIDENCE_THRESHOLD = 0.4;
export const DEFAULT_IOU_THRESHOLD = 0.7;
const BBOX_FORMAT = "xyxy";
const CLASS_LABELS = {
  0: "awake",
  1: "drowsy",
};

const EMPTY_DETECTION = {
  detected_label: "none",
  confidence: 0,
  bbox: null,
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function decodeBbox(row) {
  const [a, b, c, d] = row;

  if (BBOX_FORMAT === "xywh") {
    return [a, b, a + c, b + d];
  }

  if (BBOX_FORMAT === "cxcywh") {
    return [a - c / 2, b - d / 2, a + c / 2, b + d / 2];
  }

  return [a, b, c, d];
}

function toOriginalBbox(bbox, meta) {
  if (!meta?.scale) {
    return bbox.map((value) => Math.round(value));
  }

  const [x1, y1, x2, y2] = bbox;
  const inputX1 = clamp(x1, 0, meta.inputWidth);
  const inputY1 = clamp(y1, 0, meta.inputHeight);
  const inputX2 = clamp(x2, 0, meta.inputWidth);
  const inputY2 = clamp(y2, 0, meta.inputHeight);

  return [
    clamp((inputX1 - meta.offsetX) / meta.scale, 0, meta.originalWidth),
    clamp((inputY1 - meta.offsetY) / meta.scale, 0, meta.originalHeight),
    clamp((inputX2 - meta.offsetX) / meta.scale, 0, meta.originalWidth),
    clamp((inputY2 - meta.offsetY) / meta.scale, 0, meta.originalHeight),
  ].map((value) => Math.round(value));
}

function calculateIou(a, b) {
  const x1 = Math.max(a.bbox[0], b.bbox[0]);
  const y1 = Math.max(a.bbox[1], b.bbox[1]);
  const x2 = Math.min(a.bbox[2], b.bbox[2]);
  const y2 = Math.min(a.bbox[3], b.bbox[3]);
  const intersectionWidth = Math.max(0, x2 - x1);
  const intersectionHeight = Math.max(0, y2 - y1);
  const intersectionArea = intersectionWidth * intersectionHeight;
  const areaA = Math.max(0, a.bbox[2] - a.bbox[0]) * Math.max(0, a.bbox[3] - a.bbox[1]);
  const areaB = Math.max(0, b.bbox[2] - b.bbox[0]) * Math.max(0, b.bbox[3] - b.bbox[1]);
  const unionArea = areaA + areaB - intersectionArea;

  return unionArea > 0 ? intersectionArea / unionArea : 0;
}

function applyNms(detections, iouThreshold) {
  const selected = [];
  const candidates = [...detections].sort((a, b) => b.confidence - a.confidence);

  while (candidates.length > 0) {
    const current = candidates.shift();
    selected.push(current);

    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const candidate = candidates[index];
      if (
        candidate.classId === current.classId &&
        calculateIou(current, candidate) > iouThreshold
      ) {
        candidates.splice(index, 1);
      }
    }
  }

  return selected;
}

export function postprocessDetections(
  outputData,
  outputShape,
  preprocessMeta,
  options = {},
) {
  const confidenceThreshold =
    options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const iouThreshold = options.iouThreshold ?? DEFAULT_IOU_THRESHOLD;

  if (!Array.isArray(outputShape) || outputShape.length !== 3) {
    throw new Error(`Unsupported detection output shape: ${JSON.stringify(outputShape)}`);
  }

  const [, rowCount, rowSize] = outputShape;
  if (rowSize !== 6) {
    throw new Error(`Unsupported detection row size: ${rowSize}`);
  }

  const detections = [];

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const start = rowIndex * rowSize;
    const confidence = outputData[start + 4];

    if (!Number.isFinite(confidence) || confidence < confidenceThreshold) {
      continue;
    }

    const classId = Math.round(outputData[start + 5]);
    const detectedLabel = CLASS_LABELS[classId];

    if (!detectedLabel) {
      continue;
    }

    const bbox = decodeBbox([
      outputData[start],
      outputData[start + 1],
      outputData[start + 2],
      outputData[start + 3],
    ]);

    detections.push({
      classId,
      detected_label: detectedLabel,
      confidence,
      bbox: toOriginalBbox(bbox, preprocessMeta),
    });
  }

  const [bestDetection] = applyNms(detections, iouThreshold);

  if (!bestDetection) {
    return EMPTY_DETECTION;
  }

  return {
    detected_label: bestDetection.detected_label,
    confidence: bestDetection.confidence,
    bbox: bestDetection.bbox,
  };
}
