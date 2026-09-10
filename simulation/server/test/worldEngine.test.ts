import { describe, it, expect } from "vitest";
import { openDatabase } from "../src/db/index.js";
import { WorldEngine } from "../src/world/worldEngine.js";

describe("WorldEngine", () => {
  it("persists and reloads weather and clock", () => {
    const db = openDatabase({ file: ":memory:" });
    const world = new WorldEngine(db);
    world.setWeather("storm", "test");
    world.time.setTotalMinutes(500);
    world.persistState();

    const world2 = new WorldEngine(db);
    expect(world2.getWeather()).toBe("storm");
    expect(world2.time.getTotalMinutes()).toBe(500);
  });

  it("logs and retrieves events", () => {
    const db = openDatabase({ file: ":memory:" });
    const world = new WorldEngine(db);
    world.logEvent("admin_message", { text: "hello" });
    const events = world.recentEvents(0);
    expect(events.length).toBe(1);
    expect(events[0].payload.text).toBe("hello");
  });
});
