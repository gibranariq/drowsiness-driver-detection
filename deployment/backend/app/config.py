import os

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

if load_dotenv is not None:
    load_dotenv()

MODEL_PATH = os.getenv("MODEL_PATH", "models/yolo26_v3.pt")

CONF_THRESHOLD = 0.40
IOU_THRESHOLD = 0.70
SUSPECT_THRESHOLD = 5
WARNING_THRESHOLD = 10
ALARM_WARNING_THRESHOLD = 3
CONTINUOUS_DROWSY_THRESHOLD = 20
