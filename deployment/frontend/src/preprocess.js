const LETTERBOX_FILL = 114;

export function getStaticInputSize(shape) {
  if (!Array.isArray(shape) || shape.length !== 4) {
    throw new Error(`Unsupported model input shape: ${JSON.stringify(shape)}`);
  }

  const isNchw = shape[1] === 3;
  const isNhwc = shape[3] === 3;

  if (isNchw) {
    return {
      layout: "nchw",
      width: shape[3],
      height: shape[2],
    };
  }

  if (isNhwc) {
    return {
      layout: "nhwc",
      width: shape[2],
      height: shape[1],
    };
  }

  throw new Error(`Unsupported model input layout: ${JSON.stringify(shape)}`);
}

export function captureLetterboxedImageData(video, canvas, width, height) {
  if (!video || !canvas) {
    throw new Error("Camera frame is not available for preprocessing.");
  }

  if (!video.videoWidth || !video.videoHeight) {
    throw new Error("Camera frame is not ready yet.");
  }

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Unable to prepare the preprocessing canvas.");
  }

  context.fillStyle = `rgb(${LETTERBOX_FILL}, ${LETTERBOX_FILL}, ${LETTERBOX_FILL})`;
  context.fillRect(0, 0, width, height);

  const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
  const drawWidth = Math.round(video.videoWidth * scale);
  const drawHeight = Math.round(video.videoHeight * scale);
  const offsetX = Math.floor((width - drawWidth) / 2);
  const offsetY = Math.floor((height - drawHeight) / 2);

  context.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);

  return {
    imageData: context.getImageData(0, 0, width, height),
    meta: {
      inputWidth: width,
      inputHeight: height,
      originalWidth: video.videoWidth,
      originalHeight: video.videoHeight,
      scale,
      offsetX,
      offsetY,
      drawWidth,
      drawHeight,
    },
  };
}

export function imageDataToChwFloat32(imageData) {
  const { data, width, height } = imageData;
  const channelSize = width * height;
  const input = new Float32Array(3 * channelSize);

  for (let pixelIndex = 0; pixelIndex < channelSize; pixelIndex += 1) {
    const rgbaIndex = pixelIndex * 4;
    input[pixelIndex] = data[rgbaIndex] / 255;
    input[channelSize + pixelIndex] = data[rgbaIndex + 1] / 255;
    input[channelSize * 2 + pixelIndex] = data[rgbaIndex + 2] / 255;
  }

  return input;
}

export function imageDataToNhwcFloat32(imageData) {
  const { data, width, height } = imageData;
  const channelSize = width * height;
  const input = new Float32Array(channelSize * 3);

  for (let pixelIndex = 0; pixelIndex < channelSize; pixelIndex += 1) {
    const rgbaIndex = pixelIndex * 4;
    const rgbIndex = pixelIndex * 3;
    input[rgbIndex] = data[rgbaIndex] / 255;
    input[rgbIndex + 1] = data[rgbaIndex + 1] / 255;
    input[rgbIndex + 2] = data[rgbaIndex + 2] / 255;
  }

  return input;
}
