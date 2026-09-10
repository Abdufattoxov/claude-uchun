import { TownScene } from "./scene";
import { connectWebSocket, fetchAgentDetail, fetchEvents, fetchWorld, injectEvent, setPaused, setSpeed, setWeather } from "./api";
import type { AgentPublicState, StateMessage } from "./types";
import { actionTypeLabel, goalKindLabel, needLabel, occupationTitle, relationshipStateLabel, weatherLabel } from "./i18n";

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const labelLayer = document.createElement("div");
labelLayer.style.position = "absolute";
labelLayer.style.inset = "0";
labelLayer.style.pointerEvents = "none";
document.getElementById("app")!.appendChild(labelLayer);

const scene = new TownScene(canvas, labelLayer);

const clockEl = document.getElementById("clock")!;
const weatherLabelEl = document.getElementById("weather-label")!;
const pauseBtn = document.getElementById("pause-btn") as HTMLButtonElement;
const speedSelect = document.getElementById("speed-select") as HTMLSelectElement;
const weatherSelect = document.getElementById("weather-select") as HTMLSelectElement;
const agentListEl = document.getElementById("agent-list")!;
const inspectorEl = document.getElementById("inspector")!;
const inspectorContentEl = document.getElementById("inspector-content")!;
const inspectorCloseBtn = document.getElementById("inspector-close")!;
const eventTextEl = document.getElementById("event-text") as HTMLTextAreaElement;
const eventSubmitBtn = document.getElementById("event-submit") as HTMLButtonElement;
const eventLogEl = document.getElementById("event-log")!;
const civicNextEl = document.getElementById("civic-next")!;
const civicBarFillEl = document.getElementById("civic-bar-fill") as HTMLElement;
const connectionBannerEl = document.getElementById("connection-banner")!;

let paused = false;
let selectedAgentId: string | null = null;
let latestAgents: AgentPublicState[] = [];
let lastEventPoll = 0;
let dropdownsSynced = false;

/**
 * The backend (simulation/server) is a separate process the viewer has
 * to actually have running -- a very common first-run snag is opening
 * the client alone. Retry with backoff and show a clear banner instead
 * of a silently blank/black scene, which gives no clue what's wrong.
 */
async function fetchWorldWithRetry(): ReturnType<typeof fetchWorld> {
  let delayMs = 1000;
  for (;;) {
    try {
      const world = await fetchWorld();
      connectionBannerEl.classList.add("hidden");
      return world;
    } catch {
      connectionBannerEl.classList.remove("hidden");
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * 1.5, 8000);
    }
  }
}

async function bootstrap() {
  const world = await fetchWorldWithRetry();
  scene.buildTown(world.locations);
  scene.setOnAgentClick((id) => selectAgent(id));
  scene.start();
  updateCivicPanel(world.civicFund, world.nextMilestone);

  connectWebSocket({
    onMessage: onState,
    onOpen: () => connectionBannerEl.classList.add("hidden"),
    onClose: () => connectionBannerEl.classList.remove("hidden"),
  });
  pollEvents();
  setInterval(pollEvents, 4000);
  setInterval(refreshCivicPanel, 5000);
  if (selectedAgentId) refreshInspector();
  setInterval(() => {
    if (selectedAgentId) refreshInspector();
  }, 3000);
}

function updateCivicPanel(fund: number, next: { name: string; threshold: number } | null): void {
  if (!next) {
    civicNextEl.textContent = "Barcha rejalashtirilgan binolar qurib bo'lindi!";
    civicBarFillEl.style.width = "100%";
    return;
  }
  const pct = Math.min(100, (fund / next.threshold) * 100);
  civicNextEl.textContent = `Navbatdagi: ${next.name} (${fund}/${next.threshold})`;
  civicBarFillEl.style.width = `${pct}%`;
}

async function refreshCivicPanel(): Promise<void> {
  try {
    const world = await fetchWorld();
    connectionBannerEl.classList.add("hidden");
    updateCivicPanel(world.civicFund, world.nextMilestone);
    scene.addLocations(world.locations);
  } catch {
    connectionBannerEl.classList.remove("hidden");
  }
}

function onState(msg: StateMessage): void {
  clockEl.textContent = `${msg.time.day}-kun, ${pad(msg.time.hour)}:${pad(msg.time.minute)}`;
  weatherLabelEl.textContent = weatherLabel(msg.weather);
  scene.applyTime(msg.time);
  scene.applyWeather(msg.weather);
  paused = msg.paused;
  pauseBtn.textContent = paused ? "Davom etish" : "Pauza";
  if (!dropdownsSynced) {
    weatherSelect.value = msg.weather;
    const closestSpeed = Array.from(speedSelect.options).reduce((best, opt) =>
      Math.abs(Number(opt.value) - msg.multiplier) < Math.abs(Number(best.value) - msg.multiplier) ? opt : best
    );
    speedSelect.value = closestSpeed.value;
    dropdownsSynced = true;
  }

  latestAgents = msg.agents;
  const ids = new Set(msg.agents.map((a) => a.id));
  msg.agents.forEach((a, i) => scene.upsertAgent(a, i));
  scene.removeMissingAgents(ids);

  renderAgentList(msg.agents);
}

const agentCardEls = new Map<string, HTMLDivElement>();

function renderAgentList(agents: AgentPublicState[]): void {
  for (const agent of agents) {
    let card = agentCardEls.get(agent.id);
    if (!card) {
      card = document.createElement("div");
      card.className = "agent-card";
      card.dataset.agentId = agent.id;
      card.addEventListener("click", () => selectAgent(agent.id));
      agentCardEls.set(agent.id, card);
      agentListEl.appendChild(card);
    }
    card.innerHTML = `
      <div class="name">${agent.name} <span class="muted">$${agent.money.toFixed(0)}</span></div>
      <div class="activity">${agent.currentActivity}</div>
      ${needBar("hunger", agent.needs.hunger)}
      ${needBar("energy", agent.needs.energy)}
      ${needBar("social", agent.needs.social)}
    `;
  }
  const currentIds = new Set(agents.map((a) => a.id));
  for (const [id, card] of agentCardEls.entries()) {
    if (!currentIds.has(id)) {
      card.remove();
      agentCardEls.delete(id);
    }
  }
}

function needBar(key: string, value: number): string {
  return `<div class="need-bar-row"><span class="label">${needLabel(key)}</span><div class="need-bar"><i style="width:${value}%"></i></div></div>`;
}

function selectAgent(id: string): void {
  selectedAgentId = id;
  inspectorEl.classList.remove("hidden");
  refreshInspector();
}

async function refreshInspector(): Promise<void> {
  if (!selectedAgentId) return;
  const detail = await fetchAgentDetail(selectedAgentId);
  const a = detail.agent;
  inspectorContentEl.innerHTML = `
    <h2>${a.name}</h2>
    <div class="muted">${a.age} yosh &middot; ${occupationTitle(a.occupation, a.skill)} &middot; $${a.money.toFixed(2)}</div>
    <div class="muted">${a.currentActivity}</div>
    <h4>Mahorat</h4>
    ${needBar("skill", a.skill)}
    <h4>Ehtiyojlar</h4>
    ${Object.entries(a.needs).map(([k, v]) => needBar(k, v as number)).join("")}
    <h4>Kayfiyat</h4>
    <div class="muted">${a.emotion.label} (valentlik ${a.emotion.valence.toFixed(2)})</div>
    <h4>Maqsadlar</h4>
    <ul>${a.goals.map((g) => `<li>${g.description} <span class="pill">${goalKindLabel(g.kind)}</span></li>`).join("")}</ul>
    <h4>Munosabatlar</h4>
    <ul>${detail.relationships.length ? detail.relationships.map((r) => `<li>${r.otherName}: ${relationshipStateLabel(r.state)} (${r.affinity.toFixed(0)})</li>`).join("") : '<li class="muted">Hozircha munosabatlar yo\'q</li>'}</ul>
    <h4>So'nggi xotiralar</h4>
    <ul>${detail.memories.shortTerm.slice(0, 6).map((m) => `<li>${m.description}</li>`).join("") || '<li class="muted">Hozircha hech narsa yo\'q</li>'}</ul>
    <h4>So'nggi qarorlar</h4>
    <ul>${detail.recentDecisions.slice(0, 5).map((d) => `<li>${d.source === "llm" ? "🧠" : "⚙️"} ${actionTypeLabel(d.action)}: ${d.reason}</li>`).join("") || '<li class="muted">Hozircha yo\'q</li>'}</ul>
  `;
}

inspectorCloseBtn.addEventListener("click", () => {
  selectedAgentId = null;
  inspectorEl.classList.add("hidden");
});

// Camera D-pad: press-and-hold to pan (mouse or touch, via pointer events),
// so the viewer can freely move around the map, not just orbit in place.
function bindPanButton(id: string, direction: "up" | "down" | "left" | "right"): void {
  const btn = document.getElementById(id) as HTMLButtonElement;
  const start = (e: Event) => {
    e.preventDefault();
    scene.setPanFlag(direction, true);
  };
  const stop = () => scene.setPanFlag(direction, false);
  btn.addEventListener("pointerdown", start);
  btn.addEventListener("pointerup", stop);
  btn.addEventListener("pointerleave", stop);
  btn.addEventListener("pointercancel", stop);
}
bindPanButton("cam-up", "up");
bindPanButton("cam-down", "down");
bindPanButton("cam-left", "left");
bindPanButton("cam-right", "right");

document.getElementById("cam-zoom-in")!.addEventListener("click", () => scene.zoomBy(-8));
document.getElementById("cam-zoom-out")!.addEventListener("click", () => scene.zoomBy(8));
document.getElementById("cam-reset")!.addEventListener("click", () => scene.resetCamera());

pauseBtn.addEventListener("click", async () => {
  await setPaused(!paused);
});

speedSelect.addEventListener("change", async () => {
  await setSpeed(Number(speedSelect.value));
});

weatherSelect.addEventListener("change", async () => {
  await setWeather(weatherSelect.value);
});

eventSubmitBtn.addEventListener("click", async () => {
  const text = eventTextEl.value.trim();
  if (!text) return;
  eventSubmitBtn.disabled = true;
  eventSubmitBtn.textContent = "Yuborilmoqda...";
  try {
    const result = await injectEvent(text);
    for (const r of result.reactions) {
      appendEventLog(`${r.name}: ${r.reaction}`);
    }
    eventTextEl.value = "";
  } finally {
    eventSubmitBtn.disabled = false;
    eventSubmitBtn.textContent = "Yuborish";
  }
});

async function pollEvents(): Promise<void> {
  let events;
  try {
    events = await fetchEvents(lastEventPoll);
    connectionBannerEl.classList.add("hidden");
  } catch {
    connectionBannerEl.classList.remove("hidden");
    return;
  }
  let sawCivicDevelopment = false;
  for (const ev of events.slice().reverse()) {
    if (ev.simMinute <= lastEventPoll) continue;
    const p = ev.payload as any;
    if (ev.kind === "admin_message" && p.kind === "dialogue") {
      appendEventLog(`${p.speaker} dan ${p.listener} ga: "${p.line}"`);
    } else if (ev.kind === "admin_message" && p.kind === "reflection") {
      appendEventLog(`💭 ${p.agent}: "${p.line}"`);
    } else if (ev.kind === "admin_message" && p.kind === "thought") {
      appendEventLog(`🧠 ${p.agent}: "${p.line}"`);
    } else if (ev.kind === "weather_change") {
      appendEventLog(`Ob-havo ${weatherLabel(p.weather)} ga o'zgardi (${p.cause})`);
    } else if (ev.kind === "unknown_event") {
      appendEventLog(`Noma'lum hodisa: ${p.description}`);
    } else if (ev.kind === "civic_development") {
      appendEventLog(`🏗️ Shahar rivojlandi: "${p.name}" qurib bitkazildi!`);
      sawCivicDevelopment = true;
    } else if (ev.kind === "career_tier_up") {
      appendEventLog(`⭐ ${p.name} endi "${p.title}" darajasiga yetdi.`);
    } else if (ev.kind === "goal_completed") {
      appendEventLog(`✅ ${p.name} maqsadiga erishdi: "${p.description}".`);
    }
  }
  if (events.length) lastEventPoll = Math.max(...events.map((e) => e.simMinute));
  if (sawCivicDevelopment) refreshCivicPanel();
}

function appendEventLog(text: string): void {
  const div = document.createElement("div");
  div.className = "event-log-entry";
  div.textContent = text;
  eventLogEl.prepend(div);
  while (eventLogEl.children.length > 30) eventLogEl.removeChild(eventLogEl.lastChild!);
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

bootstrap();
