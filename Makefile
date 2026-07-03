.PHONY: help backend-build backend-run backend-test frontend-install frontend-run frontend-build

BACKEND_DIR := deployment/backend
FRONTEND_DIR := deployment/frontend
BACKEND_IMAGE := drowsiness-backend
BACKEND_CONTAINER := drowsiness-backend-api
MODEL_PATH := models/yolo26_v3.pt
TEST_IMAGE := ../../data/processed/final_project.yolo/valid/images/valid_awake_44.jpg

help:
	@echo "Available commands:"
	@echo "  make backend-build      Build the backend Docker image"
	@echo "  make backend-run        Run or restart the backend container on port 8000"
	@echo "  make backend-test       Test backend /health and /predict"
	@echo "  make frontend-install   Install frontend dependencies"
	@echo "  make frontend-run       Run the Vite frontend on port 5173"
	@echo "  make frontend-build     Build the frontend"

backend-build:
	cd $(BACKEND_DIR) && docker build -t $(BACKEND_IMAGE) .

backend-run:
	@if docker container inspect $(BACKEND_CONTAINER) >/dev/null 2>&1; then \
		docker start -a $(BACKEND_CONTAINER); \
	else \
		cd $(BACKEND_DIR) && docker run \
			--name $(BACKEND_CONTAINER) \
			-p 8000:8000 \
			-e MODEL_PATH=$(MODEL_PATH) \
			$(BACKEND_IMAGE); \
	fi

backend-test:
	curl http://localhost:8000/health
	cd $(BACKEND_DIR) && curl -X POST http://localhost:8000/predict \
		-F "file=@$(TEST_IMAGE)"

frontend-install:
	cd $(FRONTEND_DIR) && npm install

frontend-run:
	cd $(FRONTEND_DIR) && npm run dev -- --host 127.0.0.1 --port 5173 --strictPort

frontend-build:
	cd $(FRONTEND_DIR) && npm run build
