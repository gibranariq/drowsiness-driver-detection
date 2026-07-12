import cv2
import time
import csv
import pygame
from ultralytics import YOLO

# =========================
# Configuration
# =========================
MODEL_PATH = "/Users/gibranariq/Documents/Dibimbing/final_project/models/yolo26_v3.pt"
ALARM_PATH = "/Users/gibranariq/Documents/Dibimbing/final_project/deployment/frontend/public/alarm.wav"

CONF_THRESHOLD = 0.40
IOU_THRESHOLD = 0.70

SUSPECT_THRESHOLD = 5
WARNING_THRESHOLD = 10

# alarm baru aktif setelah warning terjadi 3 kali
ALARM_WARNING_THRESHOLD = 3
CONTINUOUS_DROWSY_THRESHOLD = 20  # Alarm bunyi jika mengantuk terus-menerus selama 20 frame

CAMERA_INDEX = 0

# supaya alarm tidak spam terus
ALARM_COOLDOWN = 2.0  # detik

LOG_CSV_PATH = "/Users/gibranariq/Documents/Dibimbing/final_project/inference_logs.csv"

# =========================
# Load Model
# =========================
model = YOLO(MODEL_PATH)

# =========================
# Load Alarm
# =========================
pygame.mixer.init()
pygame.mixer.music.load(ALARM_PATH)

last_alarm_time = 0

def play_alarm():
    global last_alarm_time

    current_time = time.time()

    if current_time - last_alarm_time >= ALARM_COOLDOWN:
        if not pygame.mixer.music.get_busy():
            pygame.mixer.music.play()
        last_alarm_time = current_time

# =========================
# Setup CSV Log File
# =========================
print(f"Creating CSV log file at: {LOG_CSV_PATH}")
log_file = open(LOG_CSV_PATH, mode="w", newline="")
log_writer = csv.writer(log_file)
log_writer.writerow(["Timestamp", "Inference_Time_ms", "FPS", "Detected_Label", "Status"])

# =========================
# Camera
# =========================
cap = cv2.VideoCapture(CAMERA_INDEX)

if not cap.isOpened():
    log_file.close()
    raise RuntimeError("Camera not detected. Coba ganti CAMERA_INDEX ke 1 atau 2.")

# =========================
# Counters
# =========================
drowsy_counter = 0
warning_counter = 0
is_warning_active = False

try:
    while True:
        ret, frame = cap.read()

        if not ret:
            print("Failed to read frame.")
            break

        # =========================
        # Prediction & Time Measurement
        # =========================
        t_start = time.perf_counter()
        
        results = model.predict(
            source=frame,
            conf=CONF_THRESHOLD,
            iou=IOU_THRESHOLD,
            verbose=False
        )
        
        t_end = time.perf_counter()
        inference_time = (t_end - t_start) * 1000  # ms
        fps = 1000 / inference_time if inference_time > 0 else 0

        annotated_frame = results[0].plot()

        # =========================
        # Get Prediction Label
        # =========================
        boxes = results[0].boxes
        detected_label = "none"

        if len(boxes) > 0:
            best_idx = boxes.conf.argmax()
            cls_id = int(boxes.cls[best_idx])
            detected_label = model.names[cls_id]

            if detected_label == "drowsy":
                drowsy_counter += 1
            else:
                drowsy_counter = 0
                is_warning_active = False
        else:
            drowsy_counter = 0
            is_warning_active = False
            pygame.mixer.music.stop()

        drowsy_counter = min(drowsy_counter, CONTINUOUS_DROWSY_THRESHOLD)

        # =========================
        # Status Logic + Warning Counter
        # =========================
        if drowsy_counter >= WARNING_THRESHOLD:
            status = "WARNING!"
            color = (0, 0, 255)

            # warning dihitung hanya saat transisi baru masuk WARNING
            if not is_warning_active:
                warning_counter += 1
                is_warning_active = True

        elif drowsy_counter >= SUSPECT_THRESHOLD:
            status = "Suspected Drowsy"
            color = (0, 255, 255)

        else:
            status = "Awake"
            color = (0, 255, 0)

        # =========================
        # Alarm Logic
        # =========================
        # Alarm aktif jika warning mencapai threshold ATAU jika mengantuk terus-menerus selama 20 frame
        alarm_active = (warning_counter >= ALARM_WARNING_THRESHOLD) or (drowsy_counter >= CONTINUOUS_DROWSY_THRESHOLD)

        if alarm_active:
            play_alarm()
            # Reset counter setelah membunyikan alarm agar tidak looping terus
            warning_counter = 0
            drowsy_counter = 0
            is_warning_active = False

        # =========================
        # Write Log to CSV and Console
        # =========================
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        log_writer.writerow([timestamp, f"{inference_time:.2f}", f"{fps:.2f}", detected_label, status])
        print(f"[LOG] {timestamp} | Inference: {inference_time:.2f} ms | FPS: {fps:.2f} | Label: {detected_label} | Status: {status}")

        # =========================
        # UI Overlay
        # =========================
        cv2.putText(
            annotated_frame,
            f"Status: {status}",
            (20, 40),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.9,
            color,
            2
        )

        cv2.putText(
            annotated_frame,
            f"Detected: {detected_label}",
            (20, 75),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.75,
            (255, 255, 255),
            2
        )

        cv2.putText(
            annotated_frame,
            f"Drowsy Counter: {drowsy_counter}/{CONTINUOUS_DROWSY_THRESHOLD}",
            (20, 110),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.75,
            color,
            2
        )

        cv2.putText(
            annotated_frame,
            f"Warning Count: {warning_counter}/{ALARM_WARNING_THRESHOLD}",
            (20, 145),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.75,
            (255, 255, 255),
            2
        )

        # UI Overlay for Inference time & FPS
        cv2.putText(
            annotated_frame,
            f"Inference: {inference_time:.1f} ms ({fps:.1f} FPS)",
            (20, 255),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (255, 255, 255),
            2
        )

        # Progress bar
        bar_x, bar_y = 20, 170
        bar_width, bar_height = 280, 20

        progress = min(drowsy_counter / WARNING_THRESHOLD, 1.0)

        cv2.rectangle(
            annotated_frame,
            (bar_x, bar_y),
            (bar_x + bar_width, bar_y + bar_height),
            (255, 255, 255),
            2
        )

        cv2.rectangle(
            annotated_frame,
            (bar_x, bar_y),
            (bar_x + int(bar_width * progress), bar_y + bar_height),
            color,
            -1
        )

        # Alarm text
        if pygame.mixer.music.get_busy():
            cv2.putText(
                annotated_frame,
                "ALARM ACTIVE!",
                (20, 225),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.9,
                (0, 0, 255),
                3
            )

        # Big warning text
        if drowsy_counter >= WARNING_THRESHOLD:
            h, w = annotated_frame.shape[:2]

            text1 = "WARNING!"
            font1 = cv2.FONT_HERSHEY_DUPLEX
            scale1 = 2
            thick1 = 4

            (t_w1, t_h1), _ = cv2.getTextSize(text1, font1, scale1, thick1)
            x1 = (w - t_w1) // 2
            y1 = h // 2

            cv2.putText(
                annotated_frame,
                text1,
                (x1, y1),
                font1,
                scale1,
                (0, 0, 255),
                thick1
            )

            text2 = "PLEASE TAKE A BREAK"
            font2 = cv2.FONT_HERSHEY_DUPLEX
            scale2 = 1
            thick2 = 2

            (t_w2, t_h2), _ = cv2.getTextSize(text2, font2, scale2, thick2)
            x2 = (w - t_w2) // 2
            y2 = h // 2 + 60

            cv2.putText(
                annotated_frame,
                text2,
                (x2, y2),
                font2,
                scale2,
                (0, 0, 255),
                thick2
            )

        # =========================
        # Show Frame
        # =========================
        cv2.imshow("Drowsiness Detection Test with Inference Timing", annotated_frame)

        key = cv2.waitKey(1) & 0xFF

        # q = keluar
        if key == ord("q"):
            break

        # r = reset warning counter
        if key == ord("r"):
            warning_counter = 0
            drowsy_counter = 0
            is_warning_active = False
            pygame.mixer.music.stop()

finally:
    # Cleanup resources and save CSV properly
    print("\nClosing camera and saving CSV logs...")
    cap.release()
    cv2.destroyAllWindows()
    pygame.mixer.music.stop()
    pygame.mixer.quit()
    log_file.close()
    print(f"Log successfully saved to {LOG_CSV_PATH}")
