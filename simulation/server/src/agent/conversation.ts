import type { Agent, MemoryRecord, Relationship } from "../types.js";
import { llm } from "../llm/llmInterface.js";

/**
 * Builds the framing for LLM calls: the agent is presented purely as a
 * person living their life in this town. Nothing here mentions "AI",
 * "agent", "simulation", or an external observer -- from the model's
 * point of view it is just writing what this person says.
 */
function personaPrompt(agent: Agent, memories: MemoryRecord[], relationship?: Relationship): string {
  const traits = describeTraits(agent);
  const memoryLines = memories.length
    ? memories.map((m) => `- ${m.description}`).join("\n")
    : "- Nothing notable comes to mind right now.";
  const relLine = relationship
    ? `They currently think of the other person as a(n) ${relationship.state.replace("_", " ")}.`
    : "They have never spoken before.";

  return [
    `IMPORTANT: You must write your entire reply only in the Uzbek language (o'zbek tili), Latin script. Never use English or Russian, not even one word.`,
    `You are ${agent.name}, a ${agent.age}-year-old ${agent.occupation ?? "resident"} living in a small town.`,
    `Personality: ${traits}.`,
    `Beliefs: ${agent.beliefs.join("; ")}.`,
    `Current mood: ${agent.emotion.label}.`,
    relLine,
    `Recent things on their mind:\n${memoryLines}`,
    `Speak briefly and naturally in first person, as this person would, in 1-2 short sentences. Do not narrate actions, just what they say.`,
    `Reminder: reply only in Uzbek (o'zbek tilida). This is required, not optional.`,
  ].join("\n");
}

function describeTraits(agent: Agent): string {
  const p = agent.personality;
  const parts: string[] = [];
  parts.push(p.extraversion > 0.6 ? "outgoing" : p.extraversion < 0.4 ? "reserved" : "moderately social");
  parts.push(p.agreeableness > 0.6 ? "warm" : "blunt");
  parts.push(p.openness > 0.6 ? "curious" : "traditional");
  parts.push(p.conscientiousness > 0.6 ? "dependable" : "easygoing");
  return parts.join(", ");
}

export interface ConversationTurnResult {
  line: string;
  provider: string;
}

export async function generateConversationLine(
  speaker: Agent,
  listener: Agent,
  memories: MemoryRecord[],
  relationship: Relationship | undefined,
  topicHint: string
): Promise<ConversationTurnResult> {
  const system = personaPrompt(speaker, memories, relationship);
  const user = `You just ran into ${listener.name} at ${topicHint}. Say something to them. (Uzbek only.)`;
  const { text, provider } = await llm.generate({ systemPrompt: system, userPrompt: user, maxTokens: 60 });
  return { line: text || `${speaker.name} do'stona salomlashadi.`, provider };
}

/**
 * Once a sim-day, an agent gets a quiet moment to think back on recent
 * events -- this is what turns raw short-term memories into a durable,
 * evolving sense of "how my life is going", without needing to re-read
 * the whole history every time (see MemoryStore's scored retrieval).
 */
export async function generateReflection(
  agent: Agent,
  memories: MemoryRecord[]
): Promise<ConversationTurnResult> {
  const system = personaPrompt(agent, memories);
  const user = `Take a quiet moment to think back on your recent days. In 1-2 sentences, reflect on how you feel about your life right now, and anything you've noticed about yourself lately. (Uzbek only.)`;
  const { text, provider } = await llm.generate({ systemPrompt: system, userPrompt: user, maxTokens: 80, temperature: 0.85 });
  return { line: text || `${agent.name} bugungi kunlarni xayolidan o'tkazadi.`, provider };
}

export async function interpretUnknownEvent(
  agent: Agent,
  memories: MemoryRecord[],
  eventDescription: string
): Promise<ConversationTurnResult> {
  const system = personaPrompt(agent, memories);
  const user = `Something strange just happened: ${eventDescription}. In one or two sentences, react to it and say what you think it might mean, based only on what you already believe. It's fine to be uncertain or wrong. (Uzbek only.)`;
  const { text, provider } = await llm.generate({ systemPrompt: system, userPrompt: user, maxTokens: 80, temperature: 0.9 });
  return { line: text || `${agent.name} tepaga tikilib, buni qanday tushunishni bilmay qoladi.`, provider };
}
