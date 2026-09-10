import type { Agent, MemoryRecord, Needs, WorldTime } from "../types.js";
import type { AgentAction } from "../decision/decisionSystem.js";
import type { WorldEngine } from "../world/worldEngine.js";
import { ACTIVITY } from "./activityLabels.js";
import { occupationTitle } from "./labels.js";
import { llm } from "../llm/llmInterface.js";

/**
 * This is the agent's actual mind: nobody ranks or scores these
 * options for them (contrast decisionSystem.ts, which is only the
 * fallback instinct used when no model is reachable -- see below).
 * The list is only a *physical* menu of what a person standing here,
 * with this job and these relationships, could concretely go do; nature
 * still won't let someone teleport or invent a building that doesn't
 * exist. Which one they pick, and why, is entirely the model's call,
 * reasoning from the agent's own needs/personality/goals/memories.
 */
export interface DecisionOption {
  n: number;
  label: string;
  action: AgentAction;
}

export function buildDecisionOptions(
  agent: Agent,
  world: WorldEngine,
  nearby: Array<{ id: string; name: string }>
): DecisionOption[] {
  const options: DecisionOption[] = [];
  let n = 1;
  const push = (label: string, action: AgentAction) => options.push({ n: n++, label, action });

  push("Uyga borib, dam olish yoki uxlash", {
    type: "sleep",
    locationId: agent.homeId,
    activityLabel: ACTIVITY.sleeping,
    durationMin: 6 * 60,
  });
  push("Biror narsa yeb, ochlikni bosish", {
    type: "eat",
    locationId: agent.needs.hunger < 45 ? "cafe" : agent.homeId,
    activityLabel: ACTIVITY.eating,
    durationMin: 45,
  });
  if (agent.workId) {
    push(`Ishga (${occupationTitle(agent.occupation, agent.skill)} sifatida) borish`, {
      type: "work",
      locationId: agent.workId,
      activityLabel: ACTIVITY.working,
      durationMin: 4 * 60,
    });
  }
  push("Bozor do'koniga borib, xarid qilish", {
    type: "shop",
    locationId: "general_store",
    activityLabel: ACTIVITY.shopping,
    durationMin: 30,
  });
  push("Shahar bog'iga borib, dam olish", {
    type: "relax",
    locationId: "park",
    activityLabel: ACTIVITY.relaxingFun,
    durationMin: 45,
  });
  push("Uyda o'zini tozalash, yuvinish", {
    type: "relax",
    locationId: agent.homeId,
    activityLabel: ACTIVITY.freshening,
    durationMin: 30,
  });
  push("Shahar maydoniga chiqib, atrofga qarash", {
    type: "wander",
    locationId: "square",
    activityLabel: ACTIVITY.wandering,
    durationMin: 45,
  });

  for (const other of nearby) {
    push(`${other.name} bilan gaplashish (hozir yaqin atrofda)`, {
      type: "socialize",
      locationId: agent.currentLocationId ?? "square",
      activityLabel: ACTIVITY.talkingWithSomeone,
      durationMin: 20,
      targetAgentId: other.id,
    });
  }

  for (const loc of world.leisureLocations().filter((l) => l.modern)) {
    push(`${loc.name}ni ziyorat qilish`, {
      type: "relax",
      locationId: loc.id,
      activityLabel: ACTIVITY.relaxingFun,
      durationMin: 45,
    });
  }

  return options;
}

function describeNeeds(needs: Needs): string {
  const line = (label: string, v: number) => `${label}: ${Math.round(v)}/100`;
  return [
    line("Ochlik", needs.hunger),
    line("Energiya", needs.energy),
    line("Muloqot", needs.social),
    line("Ko'ngilochar", needs.fun),
    line("Gigiena", needs.hygiene),
  ].join(", ");
}

function personaSystemPrompt(agent: Agent, memories: MemoryRecord[], time: WorldTime, weather: string): string {
  const p = agent.personality;
  const goalsLine = agent.goals.length
    ? agent.goals.map((g) => `- ${g.description} (${Math.round(g.progress * 100)}% bajarilgan)`).join("\n")
    : "- Hozircha aniq maqsad yo'q.";
  const memLine = memories.length ? memories.map((m) => `- ${m.description}`).join("\n") : "- Hech narsa esda yo'q.";

  return [
    `MUHIM: Javobingizni faqat va faqat o'zbek tilida, lotin yozuvida yozing. Ingliz yoki rus tilidan birorta ham so'z ishlatmang.`,
    `Siz ${agent.name}, ${agent.age} yoshli ${occupationTitle(agent.occupation, agent.skill)}, kichik shaharchada yashaysiz.`,
    `Xarakteringiz (0 dan 1 gacha): ochiqlik ${p.openness.toFixed(2)}, tartiblilik ${p.conscientiousness.toFixed(2)}, ekstrovertlik ${p.extraversion.toFixed(2)}, mehribonlik ${p.agreeableness.toFixed(2)}, xavotirlanish ${p.neuroticism.toFixed(2)}.`,
    `E'tiqodlaringiz: ${agent.beliefs.join("; ")}.`,
    `Hozirgi kayfiyatingiz: ${agent.emotion.label}.`,
    `Ehtiyojlaringiz (past qiymat = kuchli ehtiyoj): ${describeNeeds(agent.needs)}.`,
    `Maqsadlaringiz:\n${goalsLine}`,
    `Yodingizda qolganlar:\n${memLine}`,
    `Hozir ${time.day}-kun, soat ${time.hour}:${String(time.minute).padStart(2, "0")}, ob-havo: ${weather}.`,
    "Hech kim sizga nima qilish kerakligini aytmaydi va buyurmaydi -- bu butunlay o'zingizning qaroringiz. O'z his-tuyg'ularingiz, ehtiyojlaringiz, xarakteringiz va maqsadlaringizga tayanib qaror qabul qiling, xuddi haqiqiy odam o'z kunini rejalashtirganidek.",
  ].join("\n");
}

export interface BrainDecision {
  option: DecisionOption;
  reason: string;
  provider: string;
}

/**
 * Asks the model to choose, in character, from the physically available
 * options -- and to say why in its own words. Throws if no real model
 * answered in the expected format (e.g. the zero-cost FallbackProvider
 * kicks in when Ollama isn't reachable), so callers can fall back to
 * plain instinct (decisionSystem.ts) rather than the agent's own
 * (unavailable) reasoning.
 */
export async function decideViaBrain(
  agent: Agent,
  options: DecisionOption[],
  memories: MemoryRecord[],
  time: WorldTime,
  weather: string
): Promise<BrainDecision> {
  const system = personaSystemPrompt(agent, memories, time, weather);
  const menu = options.map((o) => `${o.n}. ${o.label}`).join("\n");
  const user = [
    "Hozir nima qilmoqchisiz? Quyidagi variantlardan birini tanlang -- faqat jismonan mumkin bo'lgan narsalar shu ro'yxatda:",
    menu,
    "",
    "Javobingizni aynan shu formatda yozing, boshqa hech narsa qo'shmang:",
    "TANLOV: <raqam>",
    "SABAB: <nega aynan shuni tanlaganingiz, 1 gap, birinchi shaxsda, o'zbek tilida>",
  ].join("\n");

  const { text, provider } = await llm.generate({ systemPrompt: system, userPrompt: user, maxTokens: 120, temperature: 0.85 });

  const choiceMatch = text.match(/TANLOV\s*:?\s*(\d+)/i);
  const reasonMatch = text.match(/SABAB\s*:?\s*(.+)/is);
  const chosenN = choiceMatch ? Number(choiceMatch[1]) : NaN;
  const option = options.find((o) => o.n === chosenN);
  if (!option) {
    throw new Error("brain: model did not return a parseable choice");
  }

  const reason = reasonMatch ? reasonMatch[1].trim().split("\n")[0] : text.trim().slice(0, 140);
  return { option, reason, provider };
}
