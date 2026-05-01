export let learningEnabled = false;

export function setLearningMode(enabled: boolean) {
  learningEnabled = enabled;
}

export function isLearningMode() {
  return learningEnabled;
}
