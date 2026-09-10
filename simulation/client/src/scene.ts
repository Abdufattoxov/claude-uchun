import * as THREE from "three";
import type { AgentPublicState, Weather, WorldLocation, WorldTime } from "./types";

const BUILDING_COLORS: Record<WorldLocation["type"], number> = {
  house: 0x8a6d5c,
  workplace: 0x5c7a8a,
  shop: 0xa88a4a,
  cafe: 0xa8556b,
  park: 0x3f7d4a,
  public: 0x6b6f80,
};

// Landmarks built by the civic development system get a distinct
// glass-and-glow look so the town's growth is visible at a glance,
// not just another gray box.
const MODERN_COLOR = 0x5fd0e8;
const MODERN_EMISSIVE = 0x1a6b7d;

const AGENT_COLORS = [0xe0a458, 0x5fa8d3, 0xd35f8d, 0x8fd35f, 0xc5a3ff];

interface AgentVisual {
  group: THREE.Group;
  targetX: number;
  targetZ: number;
  label: HTMLDivElement;
}

export class TownScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly sun: THREE.DirectionalLight;
  private readonly ambient: THREE.AmbientLight;
  private readonly agentVisuals = new Map<string, AgentVisual>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private rain: THREE.Points | null = null;
  private onAgentClick?: (id: string) => void;
  private labelLayer: HTMLDivElement;
  private camAngle = 0;
  private camDistance = 55;

  constructor(canvas: HTMLCanvasElement, labelLayer: HTMLDivElement) {
    this.labelLayer = labelLayer;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;

    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 500);
    this.updateCameraPosition();

    this.ambient = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xffffff, 1.2);
    this.sun.position.set(30, 40, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -50;
    this.sun.shadow.camera.right = 50;
    this.sun.shadow.camera.top = 50;
    this.sun.shadow.camera.bottom = -50;
    this.scene.add(this.sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0x3a4a3a })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    window.addEventListener("resize", () => this.onResize());
    canvas.addEventListener("click", (e) => this.handleClick(e));
    canvas.addEventListener("wheel", (e) => {
      this.camDistance = THREE.MathUtils.clamp(this.camDistance + e.deltaY * 0.05, 20, 120);
      this.updateCameraPosition();
    });
    let dragging = false;
    let lastX = 0;
    canvas.addEventListener("mousedown", (e) => {
      dragging = true;
      lastX = e.clientX;
    });
    window.addEventListener("mouseup", () => (dragging = false));
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      this.camAngle += (e.clientX - lastX) * 0.005;
      lastX = e.clientX;
      this.updateCameraPosition();
    });
  }

  private updateCameraPosition(): void {
    const x = Math.sin(this.camAngle) * this.camDistance;
    const z = Math.cos(this.camAngle) * this.camDistance;
    this.camera.position.set(x, this.camDistance * 0.65, z);
    this.camera.lookAt(0, 0, 0);
  }

  setOnAgentClick(cb: (id: string) => void): void {
    this.onAgentClick = cb;
  }

  private renderedLocationIds = new Set<string>();
  private townHub: WorldLocation | null = null;

  buildTown(locations: WorldLocation[]): void {
    this.townHub = locations.find((l) => l.id === "square") ?? null;
    for (const loc of locations) this.buildOneLocation(loc);
  }

  /**
   * Called when the civic development system unlocks a new landmark
   * mid-simulation: adds only what's new, so the town visibly grows
   * outward without rebuilding (and re-flickering) everything else.
   */
  addLocations(locations: WorldLocation[]): void {
    for (const loc of locations) {
      if (this.renderedLocationIds.has(loc.id)) continue;
      this.buildOneLocation(loc);
    }
  }

  private buildOneLocation(loc: WorldLocation): void {
    this.renderedLocationIds.add(loc.id);

    const height = loc.type === "house" ? 4 : loc.type === "park" ? 0.4 : 6;
    const size = loc.type === "park" ? 10 : loc.type === "public" ? 8 : 6;
    const geometry =
      loc.type === "park"
        ? new THREE.CylinderGeometry(size / 2, size / 2, 0.4, 24)
        : new THREE.BoxGeometry(size, height, size);
    const material = loc.modern
      ? new THREE.MeshStandardMaterial({
          color: MODERN_COLOR,
          emissive: MODERN_EMISSIVE,
          emissiveIntensity: 0.6,
          metalness: 0.4,
          roughness: 0.25,
        })
      : new THREE.MeshStandardMaterial({ color: BUILDING_COLORS[loc.type] });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(loc.x, height / 2, loc.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    if (loc.type === "park") {
      for (let i = 0; i < 6; i++) {
        const tree = makeTree();
        const angle = (i / 6) * Math.PI * 2;
        tree.position.set(loc.x + Math.cos(angle) * 4, 0, loc.z + Math.sin(angle) * 4);
        this.scene.add(tree);
      }
    }

    const label = this.makeLabel(loc.modern ? `✨ ${loc.name}` : loc.name);
    this.attachLabel(label, () => new THREE.Vector3(loc.x, height + 1.2, loc.z));

    if (this.townHub && loc.id !== this.townHub.id) {
      this.buildRoad(this.townHub, loc);
    }
  }

  private buildRoad(hub: WorldLocation, loc: WorldLocation): void {
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e });
    const dx = loc.x - hub.x;
    const dz = loc.z - hub.z;
    const length = Math.hypot(dx, dz);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(length, 2.4), roadMat);
    road.rotation.x = -Math.PI / 2;
    road.rotation.z = -Math.atan2(dz, dx);
    road.position.set(hub.x + dx / 2, 0.01, hub.z + dz / 2);
    road.receiveShadow = true;
    this.scene.add(road);
  }

  private makeLabel(text: string): HTMLDivElement {
    const div = document.createElement("div");
    div.textContent = text;
    div.style.position = "absolute";
    div.style.color = "#dfe7f5";
    div.style.fontSize = "11px";
    div.style.textShadow = "0 1px 2px rgba(0,0,0,0.8)";
    div.style.pointerEvents = "none";
    div.style.transform = "translate(-50%, -100%)";
    this.labelLayer.appendChild(div);
    return div;
  }

  private staticLabels: Array<{ el: HTMLDivElement; getPos: () => THREE.Vector3 }> = [];
  private attachLabel(el: HTMLDivElement, getPos: () => THREE.Vector3): void {
    this.staticLabels.push({ el, getPos });
  }

  upsertAgent(agent: AgentPublicState, index: number): void {
    let visual = this.agentVisuals.get(agent.id);
    if (!visual) {
      const group = new THREE.Group();
      const color = AGENT_COLORS[index % AGENT_COLORS.length];
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.5, 1.1, 4, 8),
        new THREE.MeshStandardMaterial({ color })
      );
      body.position.y = 1.05;
      body.castShadow = true;
      body.userData.agentId = agent.id;
      group.add(body);
      group.userData.agentId = agent.id;
      this.scene.add(group);

      const label = this.makeLabel(agent.name);
      visual = { group, targetX: agent.position.x, targetZ: agent.position.z, label };
      this.agentVisuals.set(agent.id, visual);
      group.position.set(agent.position.x, 0, agent.position.z);
    }
    visual.targetX = agent.position.x;
    visual.targetZ = agent.position.z;
  }

  removeMissingAgents(currentIds: Set<string>): void {
    for (const [id, visual] of this.agentVisuals.entries()) {
      if (!currentIds.has(id)) {
        this.scene.remove(visual.group);
        visual.label.remove();
        this.agentVisuals.delete(id);
      }
    }
  }

  applyTime(time: WorldTime): void {
    const t = (time.hour + time.minute / 60) / 24;
    // Sun angle sweeps through the sky; brightest at midday, dark at night.
    const angle = t * Math.PI * 2 - Math.PI / 2;
    this.sun.position.set(Math.cos(angle) * 40, Math.max(5, Math.sin(angle) * 40), 20);

    const daylight = Math.max(0, Math.sin(angle));
    this.sun.intensity = 0.15 + daylight * 1.3;
    this.ambient.intensity = 0.15 + daylight * 0.5;

    const nightColor = new THREE.Color(0x0b1220);
    const dayColor = new THREE.Color(0x8fc7e8);
    const sky = nightColor.clone().lerp(dayColor, daylight);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky.getHex(), 60, 180);
  }

  applyWeather(weather: Weather): void {
    if (weather === "rain" || weather === "storm") {
      if (!this.rain) this.rain = this.makeRain();
      this.rain.visible = true;
      this.renderer.setClearColor(0x1a1f2b);
    } else if (this.rain) {
      this.rain.visible = false;
    }
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = weather === "storm" ? 20 : weather === "cloudy" ? 45 : 60;
    }
  }

  private makeRain(): THREE.Points {
    const count = 1500;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 120;
      positions[i * 3 + 1] = Math.random() * 40;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 120;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0x9db8d9, size: 0.3, transparent: true, opacity: 0.6 });
    const points = new THREE.Points(geometry, material);
    this.scene.add(points);
    return points;
  }

  private handleClick(e: MouseEvent): void {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes: THREE.Object3D[] = [];
    for (const visual of this.agentVisuals.values()) meshes.push(...visual.group.children);
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      const id = hits[0].object.userData.agentId as string;
      this.onAgentClick?.(id);
    }
  }

  private onResize(): void {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  start(): void {
    this.onResize();
    const rainPositions = () => {
      if (this.rain?.visible) {
        const attr = this.rain.geometry.getAttribute("position") as THREE.BufferAttribute;
        for (let i = 0; i < attr.count; i++) {
          let y = attr.getY(i) - 1.2;
          if (y < 0) y = 40;
          attr.setY(i, y);
        }
        attr.needsUpdate = true;
      }
    };

    const tick = () => {
      for (const visual of this.agentVisuals.values()) {
        visual.group.position.x += (visual.targetX - visual.group.position.x) * 0.12;
        visual.group.position.z += (visual.targetZ - visual.group.position.z) * 0.12;
      }
      this.updateLabels();
      rainPositions();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(tick);
    };
    tick();
  }

  private updateLabels(): void {
    const project = (pos: THREE.Vector3): { x: number; y: number; visible: boolean } => {
      const v = pos.clone().project(this.camera);
      return {
        x: (v.x * 0.5 + 0.5) * innerWidth,
        y: (-v.y * 0.5 + 0.5) * innerHeight,
        visible: v.z < 1,
      };
    };

    for (const visual of this.agentVisuals.values()) {
      const p = project(new THREE.Vector3(visual.group.position.x, 2.3, visual.group.position.z));
      visual.label.style.left = `${p.x}px`;
      visual.label.style.top = `${p.y}px`;
      visual.label.style.display = p.visible ? "block" : "none";
    }
    for (const { el, getPos } of this.staticLabels) {
      const p = project(getPos());
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      el.style.display = p.visible ? "block" : "none";
    }
  }
}

function makeTree(): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.2, 1.2, 6),
    new THREE.MeshStandardMaterial({ color: 0x5a4632 })
  );
  trunk.position.y = 0.6;
  const leaves = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x2f6b3a })
  );
  leaves.position.y = 1.5;
  g.add(trunk, leaves);
  return g;
}
