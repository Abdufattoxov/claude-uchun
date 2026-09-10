import { describe, it, expect } from "vitest";
import { TimeSystem } from "../src/time/timeSystem.js";

describe("TimeSystem", () => {
  it("advances by multiplier per tick", () => {
    const t = new TimeSystem({ startTotalMinutes: 0, baseMinutesPerTick: 1, multiplier: 60 });
    const delta = t.tick();
    expect(delta).toBe(60);
    expect(t.getTotalMinutes()).toBe(60);
  });

  it("computes day/hour/minute correctly", () => {
    const t = new TimeSystem({ startTotalMinutes: 24 * 60 + 90 }); // day 2, 01:30
    const snap = t.snapshot();
    expect(snap.day).toBe(2);
    expect(snap.hour).toBe(1);
    expect(snap.minute).toBe(30);
  });

  it("does not advance while paused", () => {
    const t = new TimeSystem({ startTotalMinutes: 0, multiplier: 10 });
    t.pause();
    expect(t.tick()).toBe(0);
    t.resume();
    expect(t.tick()).toBe(10);
  });

  it("marks night hours correctly", () => {
    const t = new TimeSystem({ startTotalMinutes: 23 * 60 });
    expect(t.snapshot().isDaytime).toBe(false);
  });
});
