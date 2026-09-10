import { describe, it, expect } from "vitest";
import { openDatabase } from "../src/db/index.js";
import { SimulationController } from "../src/controller/simulationController.js";
import { ACTIVITY } from "../src/agent/activityLabels.js";
import { ADULT_AGE_YEARS, GESTATION_MIN, HOUSE_BUILD_COST, MINUTES_PER_YEAR } from "../src/agent/lifeConstants.js";
import { runTicks } from "./helpers.js";

/**
 * These tests drive the private life-cycle handlers on AgentEngine
 * directly (via a cast) rather than through the LLM brain, the same way
 * brain.test.ts already covers that the brain can choose an option --
 * here the point is to pin down the mechanics themselves (state
 * changes, persistence-relevant fields, world events, memories)
 * without depending on which option number a mocked model happens to
 * pick out of a list whose size varies with who's nearby.
 */
describe("Agent life-cycle: aging, marriage, childbirth, coming-of-age, housing", () => {
  it("ages agents forward from their birth minute on every tick", async () => {
    const db = openDatabase({ file: ":memory:" });
    const controller = new SimulationController(db);
    controller.setSpeed(600);
    const agent = controller.agents.list()[0];
    const startingAge = agent.age;

    await runTicks(controller, 50);

    expect(agent.age).toBeGreaterThan(startingAge);
    expect(agent.age).toBeLessThan(startingAge + 5); // sane bound, not wildly off
  });

  it("an agent whose age passes their lifespan dies naturally, leaving inheritance and a memory for their spouse", async () => {
    const db = openDatabase({ file: ":memory:" });
    const controller = new SimulationController(db);
    controller.setSpeed(60);

    const [a, b] = controller.agents.list();
    a.spouseId = b.id;
    b.spouseId = a.id;
    a.money = 100;
    b.money = 0;
    a.birthSimMinute = -1_000_000_000; // absurdly old -- guarantees age >= lifespan on the next tick

    await runTicks(controller, 1);

    expect(controller.agents.get(a.id)).toBeUndefined();
    expect(controller.agents.list().find((x) => x.id === a.id)).toBeUndefined();
    expect(b.spouseId).toBeUndefined();
    expect(b.money).toBeGreaterThan(0); // inherited a's savings

    const deathEvents = (
      db.prepare("SELECT COUNT(*) as c FROM world_events WHERE kind = 'agent_death'").get() as { c: number }
    ).c;
    expect(deathEvents).toBeGreaterThan(0);

    const memories = controller.agents.memories.recentShortTerm(b.id, 10);
    expect(memories.some((m) => m.description.includes(a.name))).toBe(true);
  });

  it("lets two partnered adults marry, forming a shared family relationship", async () => {
    const db = openDatabase({ file: ":memory:" });
    const controller = new SimulationController(db);
    const [a, b] = controller.agents.list();
    const now = controller.world.time.getTotalMinutes();
    controller.agents.relationships.setState(a.id, b.id, "partner", now);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller.agents as any).finalizeMarriage(a, b.id, now);

    expect(a.spouseId).toBe(b.id);
    expect(b.spouseId).toBe(a.id);
    expect(controller.agents.relationships.get(a.id, b.id).state).toBe("family");

    const marriedEvents = (
      db.prepare("SELECT COUNT(*) as c FROM world_events WHERE kind = 'married'").get() as { c: number }
    ).c;
    expect(marriedEvents).toBe(1);
  });

  it("completes a pregnancy after the gestation period into a new agent raised by both parents", async () => {
    const db = openDatabase({ file: ":memory:" });
    const controller = new SimulationController(db);
    controller.setSpeed(600);

    const beforeCount = controller.agents.list().length;
    const [a, b] = controller.agents.list();
    a.spouseId = b.id;
    b.spouseId = a.id;
    a.money = 200;
    b.money = 200;
    const now = controller.world.time.getTotalMinutes();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller.agents as any).startPregnancy(a, b.id, now);
    expect(a.expectingSinceMin).toBeDefined();
    expect(b.expectingSinceMin).toBeDefined();

    // Fast-forward straight past gestation instead of waiting it out tick by tick.
    a.expectingSinceMin = now - GESTATION_MIN - 10;
    b.expectingSinceMin = now - GESTATION_MIN - 10;

    await runTicks(controller, 1);

    expect(controller.agents.list().length).toBe(beforeCount + 1);
    expect(a.expectingSinceMin).toBeUndefined();
    expect(b.expectingSinceMin).toBeUndefined();

    const child = controller.agents.list().find((x) => x.parentIds.includes(a.id) && x.parentIds.includes(b.id));
    expect(child).toBeDefined();
    expect(child!.stage).toBe("child");

    const rel = controller.agents.relationships.get(a.id, child!.id);
    expect(rel.state).toBe("family");

    const bornEvents = (
      db.prepare("SELECT COUNT(*) as c FROM world_events WHERE kind = 'child_born'").get() as { c: number }
    ).c;
    expect(bornEvents).toBe(1);
  });

  it("transitions a child to full autonomous adulthood once they reach coming-of-age", async () => {
    const db = openDatabase({ file: ":memory:" });
    const controller = new SimulationController(db);
    controller.setSpeed(600);

    const [a, b] = controller.agents.list();
    a.spouseId = b.id;
    b.spouseId = a.id;
    a.money = 200;
    b.money = 200;
    const now = controller.world.time.getTotalMinutes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller.agents as any).startPregnancy(a, b.id, now);
    a.expectingSinceMin = now - GESTATION_MIN - 10;
    b.expectingSinceMin = now - GESTATION_MIN - 10;
    await runTicks(controller, 1);

    const child = controller.agents.list().find((x) => x.stage === "child")!;
    expect(child).toBeDefined();

    // Old enough to be an adult already, as of the next tick.
    child.birthSimMinute = controller.world.time.getTotalMinutes() - Math.round((ADULT_AGE_YEARS + 1) * MINUTES_PER_YEAR);

    await runTicks(controller, 1);

    const grownUp = controller.agents.get(child.id)!;
    expect(grownUp.stage).toBe("adult");
    expect(grownUp.occupation).toBeDefined();
    expect(grownUp.workId).toBeDefined();
    expect(grownUp.goals.length).toBeGreaterThan(0);

    const cameOfAgeEvents = (
      db.prepare("SELECT COUNT(*) as c FROM world_events WHERE kind = 'came_of_age'").get() as { c: number }
    ).c;
    expect(cameOfAgeEvents).toBe(1);
  });

  it("lets a grown child fund and build their own house once they've saved enough", () => {
    const db = openDatabase({ file: ":memory:" });
    const controller = new SimulationController(db);

    const agent = controller.agents.list()[0];
    agent.parentIds = ["someone"]; // simulate being sim-born rather than a founder
    agent.money = HOUSE_BUILD_COST + 50;
    const originalHomeId = agent.homeId;
    const initialLocationCount = controller.world.allLocations().length;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller.agents as any).commitDecision(
      agent,
      agent.currentActivity,
      { type: "build_house", locationId: "", activityLabel: ACTIVITY.buildingHome, durationMin: 90 },
      "test",
      "llm"
    );

    expect(agent.homeId).not.toBe(originalHomeId);
    expect(agent.homeId.startsWith("home_")).toBe(true);
    expect(agent.money).toBeCloseTo(50, 5);
    expect(controller.world.allLocations().length).toBe(initialLocationCount + 1);

    const builtEvents = (
      db.prepare("SELECT COUNT(*) as c FROM world_events WHERE kind = 'home_built'").get() as { c: number }
    ).c;
    expect(builtEvents).toBe(1);
  });
});
