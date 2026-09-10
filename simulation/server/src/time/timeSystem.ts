import type { WorldTime } from "../types.js";

const MINUTES_PER_DAY = 24 * 60;

/**
 * Deterministic simulated clock. Real time is never consulted for sim
 * state -- only totalMinutes is, so persistence + replay stay exact
 * regardless of how fast/slow the host machine ticks.
 */
export class TimeSystem {
  private totalMinutes: number;

  /** Sim minutes advanced per real tick, before the speed multiplier. */
  private readonly baseMinutesPerTick: number;

  /** Configurable speed multiplier, e.g. 60 => 1 real minute = 1 sim hour. */
  private multiplier: number;

  private paused = false;

  constructor(opts: {
    startTotalMinutes?: number;
    baseMinutesPerTick?: number;
    multiplier?: number;
  } = {}) {
    this.totalMinutes = opts.startTotalMinutes ?? 8 * 60; // start at 08:00 day 1
    this.baseMinutesPerTick = opts.baseMinutesPerTick ?? 1;
    this.multiplier = opts.multiplier ?? 60;
  }

  setMultiplier(multiplier: number): void {
    if (multiplier <= 0) throw new Error("multiplier must be > 0");
    this.multiplier = multiplier;
  }

  getMultiplier(): number {
    return this.multiplier;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** Advance the clock by one tick. Returns minutes actually advanced. */
  tick(): number {
    if (this.paused) return 0;
    const delta = Math.max(1, Math.round(this.baseMinutesPerTick * this.multiplier));
    this.totalMinutes += delta;
    return delta;
  }

  getTotalMinutes(): number {
    return this.totalMinutes;
  }

  setTotalMinutes(minutes: number): void {
    this.totalMinutes = minutes;
  }

  snapshot(): WorldTime {
    const day = Math.floor(this.totalMinutes / MINUTES_PER_DAY) + 1;
    const minuteOfDay = this.totalMinutes % MINUTES_PER_DAY;
    const hour = Math.floor(minuteOfDay / 60);
    const minute = minuteOfDay % 60;
    return {
      totalMinutes: this.totalMinutes,
      day,
      hour,
      minute,
      isDaytime: hour >= 6 && hour < 20,
    };
  }
}
