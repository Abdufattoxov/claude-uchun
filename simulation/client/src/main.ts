import { TownScene } from "./scene";
import { connectWebSocket, fetchAgentDetail, fetchEvents, fetchWorld, injectEvent, setPaused, setSpeed, setWeather } from "./api";
import type { AgentPublicState, StateMessage } from "./types";
import { actionTypeLabel, goalKindLabel, needLabel, occupationLabel, relationshipStateLabel, weatherLabel } from "./i18n";

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

let paused = false;
let selectedAgentId: string | null = null;
let latestAgents: AgentPublicState[] = [];
let lastEventPoll = 0;
let dropdownsSynced = false;

async function bootstrap() {
  const world = await fetchWorld();
  scene.buildTown(world.locations);
  scene.setOnAgentClick((id) => selectAgent(id));
  scene.start();

  connectWebSocket(onState);
  pollEvents();
  setInterval(pollEvents, 4000);
  if (selectedAgentId) refreshInspector();
  setInterval(() => {
    if (selectedAgentId) refreshInspector();
  }, 3000);
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
    <div class="muted">${a.age} yosh &middot; ${occupationLabel(a.occupation)} &middot; $${a.money.toFixed(2)}</div>
    <div class="muted">${a.currentActivity}</div>
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
    <ul>${detail.recentDecisions.slice(0, 5).map((d) => `<li>${actionTypeLabel(d.action)}: ${d.reason}</li>`).join("") || '<li class="muted">Hozircha yo\'q</li>'}</ul>
  `;
}

inspectorCloseBtn.addEventListener("click", () => {
  selectedAgentId = null;
  inspectorEl.classList.add("hidden");
});

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
  const events = await fetchEvents(lastEventPoll);
  for (const ev of events.slice().reverse()) {
    if (ev.simMinute <= lastEventPoll) continue;
    if (ev.kind === "admin_message" && (ev.payload as any).kind === "dialogue") {
      const p = ev.payload as any;
      appendEventLog(`${p.speaker} dan ${p.listener} ga: "${p.line}"`);
    } else if (ev.kind === "weather_change") {
      appendEventLog(`Ob-havo ${weatherLabel((ev.payload as any).weather)} ga o'zgardi (${(ev.payload as any).cause})`);
    } else if (ev.kind === "unknown_event") {
      appendEventLog(`Noma'lum hodisa: ${(ev.payload as any).description}`);
    }
  }
  if (events.length) lastEventPoll = Math.max(...events.map((e) => e.simMinute));
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
