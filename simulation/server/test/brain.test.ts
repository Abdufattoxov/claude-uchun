import { describe, it, expect, vi, afterEach } from "vitest";
import { openDatabase } from "../src/db/index.js";
import { SimulationController } from "../src/controller/simulationController.js";
import { llm } from "../src/llm/llmInterface.js";
import { runTicks } from "./helpers.js";

describe("LLM-driven decision brain", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lets a real model's own choice and reasoning drive the decision, not the utility fallback", async () => {
    vi.spyOn(llm, "generate").mockResolvedValue({
      text: "TANLOV: 1\nSABAB: Charchadim, avval uyga borib dam olishni xohlayman.",
      provider: "test-model",
    });

    const db = openDatabase({ file: ":memory:" });
    const controller = new SimulationController(db);
    controller.setSpeed(120);
    await runTicks(controller, 20);

    const row = db
      .prepare("SELECT reason, source FROM decisions_log WHERE source = 'llm' ORDER BY sim_minute DESC LIMIT 1")
      .get() as { reason: string; source: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.source).toBe("llm");
    expect(row!.reason).toContain("dam olish");
  });

  it("falls back to instinct (utility scoring) when the model's reply can't be parsed", async () => {
    vi.spyOn(llm, "generate").mockResolvedValue({
      text: "Bugun ajoyib kun, lekin men na'ima demoqchi bo'lganimni bilmayman.",
      provider: "test-model",
    });

    const db = openDatabase({ file: ":memory:" });
    const controller = new SimulationController(db);
    controller.setSpeed(120);
    await runTicks(controller, 20);

    const row = db.prepare("SELECT COUNT(*) as c FROM decisions_log WHERE source = 'utility'").get() as {
      c: number;
    };
    expect(row.c).toBeGreaterThan(0);
  });
});
