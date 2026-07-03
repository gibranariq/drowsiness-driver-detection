from dataclasses import dataclass

from app.config import (
    ALARM_WARNING_THRESHOLD,
    CONTINUOUS_DROWSY_THRESHOLD,
    SUSPECT_THRESHOLD,
    WARNING_THRESHOLD,
)


@dataclass
class TrackerState:
    status: str
    drowsy_counter: int
    warning_counter: int
    alarm_active: bool


@dataclass
class DrowsinessTracker:
    drowsy_counter: int = 0
    warning_counter: int = 0
    is_warning_active: bool = False

    def update(self, detected_label: str) -> TrackerState:
        if detected_label == "drowsy":
            self.drowsy_counter += 1
        else:
            self.drowsy_counter = 0
            self.is_warning_active = False

        self.drowsy_counter = min(
            self.drowsy_counter,
            CONTINUOUS_DROWSY_THRESHOLD,
        )

        if self.drowsy_counter >= WARNING_THRESHOLD:
            status = "WARNING!"

            if not self.is_warning_active:
                self.warning_counter += 1
                self.is_warning_active = True
        elif self.drowsy_counter >= SUSPECT_THRESHOLD:
            status = "Suspected Drowsy"
        else:
            status = "Awake"

        alarm_active = (
            self.warning_counter >= ALARM_WARNING_THRESHOLD
            or self.drowsy_counter >= CONTINUOUS_DROWSY_THRESHOLD
        )

        if alarm_active:
            self.reset()

        return TrackerState(
            status=status,
            drowsy_counter=self.drowsy_counter,
            warning_counter=self.warning_counter,
            alarm_active=alarm_active,
        )

    def reset(self) -> None:
        self.drowsy_counter = 0
        self.warning_counter = 0
        self.is_warning_active = False
