/**
 * LLM abstraction. The rest of the simulation never talks to a model
 * directly -- it calls `generate()` here, so the backend can be swapped
 * (Ollama, a hosted API, etc.) without touching agent logic. The
 * decision/agent engines are responsible for only calling this for
 * things that actually need it (dialogue, event interpretation),
 * never for routine movement/needs/scheduling.
 */
export interface LLMRequest {
  /** Frames the agent as a person in the world -- never mentions AI/simulation. */
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  generate(req: LLMRequest): Promise<string>;
}

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.2";

export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${OLLAMA_HOST}/api/version`, {
        signal: AbortSignal.timeout(800),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generate(req: LLMRequest): Promise<string> {
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        options: { temperature: req.temperature ?? 0.8, num_predict: req.maxTokens ?? 120 },
        messages: [
          { role: "system", content: req.systemPrompt },
          { role: "user", content: req.userPrompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama request failed: ${res.status}`);
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content?.trim() ?? "";
  }
}

/**
 * Deterministic, zero-cost stand-in used whenever no local model is
 * reachable, so the simulation is always fully runnable and testable.
 * It produces plausible, personality-flavored text via templates
 * instead of failing or blocking the tick loop.
 */
export class FallbackProvider implements LLMProvider {
  readonly name = "fallback";

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async generate(req: LLMRequest): Promise<string> {
    const seed = hashString(req.systemPrompt + "|" + req.userPrompt);
    const templates = [
      "bosh irg'ab, kunining bir lahzasi haqida gapirib beradi",
      "jilmayib, javobida do'stona savol beradi",
      "yaqinda shaharda ko'rgan kichik bir narsa haqida gapiradi",
      "biroz xayolga tolgan, lekin suhbatni davom ettiradi",
      "kulib, mavzuni yengilroq narsaga o'zgartiradi",
      "yelka qisib, bu haqida tashvishlanishga arzimasligini aytadi",
      "qoshini chimirib, kimdir hazillashayotgan bo'lishi mumkinligini o'ylaydi",
      "jim bo'lib qoladi, buning ta'sirida biroz xavotirlanganga o'xshaydi",
      "hayajonlanib, bu ajoyib narsa bo'lishi mumkinligini taxmin qiladi",
      "mavzuni tezda o'zgartiradi, bu haqida o'ylashni istamaydi",
    ];
    return templates[seed % templates.length];
  }
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Picks Ollama when reachable, otherwise falls back automatically.
 * Availability is cached briefly so we don't probe on every call.
 */
export class LLMInterface {
  private readonly ollama = new OllamaProvider();
  private readonly fallback = new FallbackProvider();
  private cachedAvailable: boolean | null = null;
  private cachedAt = 0;
  private readonly cacheTtlMs = 30_000;

  async activeProvider(): Promise<LLMProvider> {
    const now = Date.now();
    if (this.cachedAvailable === null || now - this.cachedAt > this.cacheTtlMs) {
      this.cachedAvailable = await this.ollama.isAvailable();
      this.cachedAt = now;
    }
    return this.cachedAvailable ? this.ollama : this.fallback;
  }

  async generate(req: LLMRequest): Promise<{ text: string; provider: string }> {
    const provider = await this.activeProvider();
    try {
      const text = await provider.generate(req);
      if (text) return { text, provider: provider.name };
    } catch {
      // fall through to fallback below
    }
    const text = await this.fallback.generate(req);
    return { text, provider: this.fallback.name };
  }
}

export const llm = new LLMInterface();
