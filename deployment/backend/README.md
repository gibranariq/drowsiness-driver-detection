# Drowsiness Detection Backend

FastAPI backend for the drowsiness detection model. It accepts one uploaded image frame, runs YOLO inference, applies warning/alarm tracking, and returns JSON.

## Setup

From the project root, use the existing virtual environment:

```bash
cd final_project/deployment/backend
source ../../venv/bin/activate
pip install -r requirements.txt
```

Copy the model file manually:

```bash
cp ../../models/yolo26_v3.pt models/yolo26_v3.pt
```

Run the API:

```bash
uvicorn app.main:app --reload
```

The default model path is:

```text
models/yolo26_v3.pt
```

You can override it with:

```bash
MODEL_PATH=/path/to/model.pt uvicorn app.main:app --reload
```

## Endpoints

```text
GET /health
POST /predict
POST /reset
```

Example checks:

```bash
curl http://127.0.0.1:8000/health
curl -X POST http://127.0.0.1:8000/reset
curl -X POST http://127.0.0.1:8000/predict -F "file=@/path/to/test-image.jpg"
```

## Docker

Build the backend image:

```bash
cd deployment/backend
docker build -t drowsiness-backend .
```

The Docker image uses CPU PyTorch wheels by default and installs the minimal
OpenCV runtime libraries required by the slim Python image.

Run the container:

```bash
docker run --rm \
  -p 8000:8000 \
  -e MODEL_PATH=models/yolo26_v3.pt \
  drowsiness-backend
```

Verify the health endpoint:

```bash
curl http://localhost:8000/health
```

Expected response:

```json
{"status":"ok"}
```

Verify prediction from another terminal:

```bash
curl -X POST http://localhost:8000/predict \
  -F "file=@../../data/processed/final_project.yolo/valid/images/valid_awake_44.jpg"
```

The response should include the same fields as the non-Docker backend, including detection fields, tracker status, alarm state, and timing metrics.
