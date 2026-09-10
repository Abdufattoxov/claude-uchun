/**
 * Single source of truth for activity label text (Uzbek). Several
 * modules (decisionSystem, agentFactory, agentEngine) must agree on
 * these exact strings -- agentEngine's activityEffectKey() matches
 * against them to know which need to satisfy while an activity runs.
 * Centralizing avoids the labels drifting out of sync across files.
 */
export const ACTIVITY = {
  wakingUp: "uyg'onmoqda",
  working: "ishlamoqda",
  havingLunch: "tushlik qilmoqda",
  unwinding: "shaharda dam olmoqda",
  relaxingHome: "uyda dam olmoqda",
  sleeping: "uxlamoqda",
  eating: "ovqatlanmoqda",
  relaxingFun: "dam olmoqda",
  freshening: "yuvinib-tozalanmoqda",
  shopping: "xarid qilmoqda",
  wandering: "shahar bo'ylab sayr qilmoqda",
  talkingWithSomeone: "kimdir bilan suhbatlashmoqda",
  /** Deliberating over what to do next -- no need effects apply while in this state. */
  thinking: "o'ylanib turibdi",
} as const;

export function talkingWithLabel(name: string): string {
  return `${name} bilan suhbatlashmoqda`;
}

export function walkingToLabel(locationName: string): string {
  return `${locationName} tomon yo'l olmoqda`;
}

/** Matches any "talking with ..." variant regardless of who's named. */
export function isTalkingActivity(activity: string): boolean {
  return activity.endsWith("suhbatlashmoqda");
}
