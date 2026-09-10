import { describe, it, expect } from "vitest";
import { openDatabase } from "../src/db/index.js";
import { SimulationController } from "../src/controller/simulationController.js";
import { runTicks } from "./helpers.js";

describe("Self-improvement and civic development", () => {
  it("agents grow skill while working and eventually tier up", async () => {
    const db = openDatabase({ file: ":memory:" });
    const controller = new SimulationController(db);
    controller.setSpeed(240);

    const startingSkill = controller.agents.list()[0].skill;
    await runTicks(controller, 2500);

    const grown = controller.agents.list().some((a) => a.skill > startingSkill + 15);
    expect(grown).toBe(true);

    const tierUps = (
      db.prepare("SELECT COUNT(*) as c FROM world_events WHERE kind = 'career_tier_up'").get() as { c: number }
    ).c;
    expect(tierUps).toBeGreaterThan(0);
  });

  it("completed goals are replaced, not just left at 100%", async () => {
    const db = openDatabase({ file: ":memory:" });
    const controller = new SimulationController(db);
    controller.setSpeed(240);

    const agent = controller.agents.list()[0];
    const originalGoalIds = new Set(agent.goals.map((g) => g.id));

    await runTicks(controller, 2500);

    const completions = (
      db.prepare("SELECT COUNT(*) as c FROM world_events WHERE kind = 'goal_completed'").get() as { c: number }
    ).c;
    expect(completions).toBeGreaterThan(0);

    const stillOriginal = agent.goals.every((g) => originalGoalIds.has(g.id));
    expect(stillOriginal).toBe(false);
    for (const g of agent.goals) {
      expect(g.progress).toBeLessThan(1);
    }
  });

  it("the town literally grows: civic fund crosses a milestone and a new building appears", async () => {
    const db = openDatabase({ file: ":memory:" });
    const controller = new SimulationController(db);
    controller.setSpeed(240);

    const initialLocationCount = controller.world.allLocations().length;
    await runTicks(controller, 2500);

    expect(controller.world.getCivicFund()).toBeGreaterThan(0);
    expect(controller.world.allLocations().length).toBeGreaterThan(initialLocationCount);

    const developments = (
      db.prepare("SELECT COUNT(*) as c FROM world_events WHERE kind = 'civic_development'").get() as { c: number }
    ).c;
    expect(developments).toBeGreaterThan(0);

    const row = db.prepare("SELECT COUNT(*) as c FROM locations").get() as { c: number };
    expect(row.c).toBe(controller.world.allLocations().length - initialLocationCount);
  });
});
