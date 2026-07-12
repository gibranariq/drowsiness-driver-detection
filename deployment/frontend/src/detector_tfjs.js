import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-webgl";
import {
    captureLetterboxedImageData,
    getStaticInputSize,
    imageDataToChwFloat32,
    imageDataToNhwcFloat32,
} from "./preprocess.js";
import { postprocessDetections } from "./postprocess.js";

const MODEL_PATH = "/models/yolo26n_tfjs/model.json";

function getTensorShape(tensor) {
    return tensor.shape || tensor.dims || [];
}

function summarizeTfjsOutput(data, shape) {
    const rowCount = shape.length >= 3 ? shape[1] : 0;
    const rowSize = shape.length >= 3 ? shape[2] : 0;
    const firstRows = [];

    for (let rowIndex = 0; rowIndex < Math.min(5, rowCount); rowIndex += 1) {
        const start = rowIndex * rowSize;
        const end = start + rowSize;
        firstRows.push(
            Array.from(data.slice(start, end)).map((value) =>
                Number(value.toFixed(6)),
            ),
        );
    }

    return firstRows;
}

function normalizeTfjsOutput(output) {
    if (Array.isArray(output)) {
        return output[0];
    }

    if (output && typeof output === "object" && "dataSync" in output) {
        return output;
    }

    if (output && typeof output === "object") {
        return Object.values(output)[0];
    }

    throw new Error("TF.js model returned an unsupported output format.");
}

function disposeTfjsOutput(output) {
    if (Array.isArray(output)) {
        output.forEach((tensor) => tensor?.dispose?.());
        return;
    }

    if (output && typeof output === "object" && "dispose" in output) {
        output.dispose();
        return;
    }

    if (output && typeof output === "object") {
        Object.values(output).forEach((tensor) => tensor?.dispose?.());
    }
}

export async function createDetector() {
    await tf.setBackend("webgl");
    await tf.ready();

    const model = await tf.loadGraphModel(MODEL_PATH);
    const inputShape = model.inputs[0].shape;
    const inputSize = getStaticInputSize(inputShape);

    async function predict(video, canvas, postprocessOptions) {
        const { imageData, meta } = captureLetterboxedImageData(
            video,
            canvas,
            inputSize.width,
            inputSize.height,
        );
        const inputData =
            inputSize.layout === "nchw"
                ? imageDataToChwFloat32(imageData)
                : imageDataToNhwcFloat32(imageData);
        const inputTensor = tf.tensor(inputData, inputShape, "float32");
        const start = performance.now();
        const rawOutput = await model.executeAsync(inputTensor);
        const inferenceMs = performance.now() - start;
        const output = normalizeTfjsOutput(rawOutput);
        const outputDims = getTensorShape(output);
        const outputData = output.dataSync();
        const prediction = postprocessDetections(
            outputData,
            outputDims,
            meta,
            postprocessOptions,
        );
        const firstRows = summarizeTfjsOutput(outputData, outputDims);

        inputTensor.dispose();
        disposeTfjsOutput(rawOutput);

        return {
            ...prediction,
            backend: tf.getBackend(),
            inferenceMs,
            outputName: model.outputs[0]?.name || "output0",
            outputDims,
            firstRows,
            preprocessMeta: meta,
        };
    }

    function dispose() {
        model?.dispose();
    }

    return {
        predict,
        dispose,
    };
}
