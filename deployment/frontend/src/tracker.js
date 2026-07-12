const SUSPECT_THRESHOLD = 5;
const WARNING_THRESHOLD = 10;
const ALARM_WARNING_THRESHOLD = 3;
export const CONTINUOUS_DROWSY_THRESHOLD = 20;

export function createTracker() {
  let drowsyCounter = 0;
  let warningCounter = 0;
  let isWarningActive = false;

  function reset() {
    drowsyCounter = 0;
    warningCounter = 0;
    isWarningActive = false;
  }

  function update(detectedLabel) {
    if (detectedLabel === "drowsy") {
      drowsyCounter += 1;
    } else {
      drowsyCounter = 0;
      isWarningActive = false;
    }

    drowsyCounter = Math.min(drowsyCounter, CONTINUOUS_DROWSY_THRESHOLD);

    let status = "Awake";
    if (drowsyCounter >= WARNING_THRESHOLD) {
      status = "WARNING!";

      if (!isWarningActive) {
        warningCounter += 1;
        isWarningActive = true;
      }
    } else if (drowsyCounter >= SUSPECT_THRESHOLD) {
      status = "Suspected Drowsy";
    }

    const alarmActive =
      warningCounter >= ALARM_WARNING_THRESHOLD ||
      drowsyCounter >= CONTINUOUS_DROWSY_THRESHOLD;

    if (alarmActive) {
      reset();
    }

    const state = {
      status,
      drowsy_counter: drowsyCounter,
      warning_counter: warningCounter,
      alarm_active: alarmActive,
    };

    return state;
  }

  return {
    update,
    reset,
  };
}
