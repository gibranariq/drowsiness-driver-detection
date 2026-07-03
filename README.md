final_project
==============================

A short description of the project.

Deployment Commands
------------

The deployment backend can run from Docker, while the frontend still runs with
Vite during local development.

```bash
make backend-build
make backend-run
```

In another terminal:

```bash
make frontend-install
make frontend-run
```

Open:

```text
http://127.0.0.1:5173/
```

Backend checks:

```bash
make backend-test
```

Project Organization
------------

```
final_project/
├── LICENSE     
├── README.md                  
├── Makefile                    # Makefile with deployment, backend, frontend, and testing commands
├── configs/                    # Config files (models and training hyperparameters)
│   └── model1.yaml              
│
├── data/                       # Datasets
│   ├── external/               # Data from third party sources
│   ├── interim/                # Intermediate data that has been transformed
│   ├── processed/              # The final, canonical data sets for modeling
│   └── raw/                    # The original, immutable data dump
│
├── deployment/                 # Production deployment packages
│   ├── backend/                # FastAPI backend service
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   ├── app/                # Application routes, detection logic, and tracker
│   │   │   ├── config.py
│   │   │   ├── detector.py
│   │   │   ├── main.py
│   │   │   └── tracker.py
│   │   └── models/             # YOLO models for backend inference
│   │
│   └── frontend/               # React (Vite) frontend application
│       ├── package.json
│       ├── vite.config.js
│       ├── index.html
│       ├── src/                # Frontend source code (App components, CSS, API calls)
│       │   ├── App.jsx
│       │   ├── api.js
│       │   └── styles.css
│       └── public/             # Static public assets (alarm.wav, etc.)
│
├── docs/                       # Project documentation
│
├── models/                     # Trained and serialized models (.pt YOLO weights)
│
├── notebooks/                  # Jupyter notebooks for model comparison and development
│
├── references/                 # Explanatory materials, manuals, and data dictionaries
│
├── reports/                    # Generated latency test logs, summaries, and model benchmarks
│   ├── latency_test_web_640.txt
│   └── yolo11/yolo26 benchmark results
│
└── src/                        # Legacy/experimental source code
    ├── data/                   
    ├── models/                 
    │   └── model1/
    │       └── rename.py
    └── visualization/          # Visualization scripts and evaluation notebooks
        ├── EDA.ipynb
        ├── evaluation.py
        └── exploration.py
```
