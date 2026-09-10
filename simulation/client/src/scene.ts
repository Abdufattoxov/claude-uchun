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

  // Free camera: orbit (angle/pitch) + zoom (distance) around a look-at
  // point (target) that the viewer can pan across the whole map.
  private camAngle = 0;
  private camPitch = 0.7; // radians above the horizon
  private camDistance = 55;
  private camTarget = { x: 0, z: 0 };
  private readonly PAN_BOUND = 75;
  private panFlags = { up: false, down: false, left: false, right: false };
  private readonly PAN_SPEED = 0.9; // world units per animation frame

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
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: 0x3a4a3a })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    window.addEventListener("resize", () => this.onResize());
    canvas.addEventListener("click", (e) => this.handleClick(e));
    this.setupPointerControls(canvas);
    this.setupKeyboardControls();
  }

  /** Mouse drag (any pointer) orbits the view; wheel/pinch zooms. */
  private setupPointerControls(canvas: HTMLCanvasElement): void {
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.zoomBy(e.deltaY * 0.05);
      },
      { passive: false }
    );

    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const startDrag = (x: number, y: number) => {
      dragging = true;
      lastX = x;
      lastY = y;
    };
    const moveDrag = (x: number, y: number) => {
      if (!dragging) return;
      this.camAngle += (x - lastX) * 0.006;
      this.camPitch = THREE.MathUtils.clamp(this.camPitch + (y - lastY) * 0.005, 0.15, 1.4);
      lastX = x;
      lastY = y;
      this.updateCameraPosition();
    };
    const endDrag = () => (dragging = false);

    canvas.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      startDrag(e.clientX, e.clientY);
    });
    window.addEventListener("mouseup", endDrag);
    window.addEventListener("mousemove", (e) => moveDrag(e.clientX, e.clientY));

    // Touch: one finger orbits, two fingers pinch-zoom.
    let pinchStartDist = 0;
    canvas.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length === 1) {
          startDrag(e.touches[0].clientX, e.touches[0].clientY);
        } else if (e.touches.length === 2) {
          dragging = false;
          pinchStartDist = touchDistance(e.touches);
        }
      },
      { passive: true }
    );
    canvas.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches.length === 1) {
          moveDrag(e.touches[0].clientX, e.touches[0].clientY);
        } else if (e.touches.length === 2) {
          e.preventDefault();
          const dist = touchDistance(e.touches);
          this.zoomBy((pinchStartDist - dist) * 0.15);
          pinchStartDist = dist;
        }
      },
      { passive: false }
    );
    canvas.addEventListener("touchend", endDrag);
  }

  /** WASD/arrow keys pan the camera target across the map, relative to facing direction. */
  private setupKeyboardControls(): void {
    const keyToFlag: Record<string, keyof typeof this.panFlags> = {
      w: "up",
      arrowup: "up",
      s: "down",
      arrowdown: "down",
      a: "left",
      arrowleft: "left",
      d: "right",
      arrowright: "right",
    };
    window.addEventListener("keydown", (e) => {
      const flag = keyToFlag[e.key.toLowerCase()];
      if (flag) this.panFlags[flag] = true;
    });
    window.addEventListener("keyup", (e) => {
      const flag = keyToFlag[e.key.toLowerCase()];
      if (flag) this.panFlags[flag] = false;
    });
  }

  /** Used by both the on-screen D-pad buttons and (indirectly) keyboard. */
  setPanFlag(direction: "up" | "down" | "left" | "right", active: boolean): void {
    this.panFlags[direction] = active;
  }

  zoomBy(delta: number): void {
    this.camDistance = THREE.MathUtils.clamp(this.camDistance + delta, 12, 160);
    this.updateCameraPosition();
  }

  resetCamera(): void {
    this.camTarget = { x: 0, z: 0 };
    this.camAngle = 0;
    this.camPitch = 0.7;
    this.camDistance = 55;
    this.updateCameraPosition();
  }

  private applyPanFlags(): void {
    const { up, down, left, right } = this.panFlags;
    if (!up && !down && !left && !right) return;

    // Move relative to where the camera is currently facing, like a
    // free-roam viewer: "forward" is toward the look-at point.
    const forward = { x: -Math.sin(this.camAngle), z: -Math.cos(this.camAngle) };
    const strafe = { x: Math.cos(this.camAngle), z: -Math.sin(this.camAngle) };
    let dx = 0;
    let dz = 0;
    if (up) {
      dx += forward.x;
      dz += forward.z;
    }
    if (down) {
      dx -= forward.x;
      dz -= forward.z;
    }
    if (right) {
      dx += strafe.x;
      dz += strafe.z;
    }
    if (left) {
      dx -= strafe.x;
      dz -= strafe.z;
    }
    const len = Math.hypot(dx, dz) || 1;
    this.camTarget.x = THREE.MathUtils.clamp(this.camTarget.x + (dx / len) * this.PAN_SPEED, -this.PAN_BOUND, this.PAN_BOUND);
    this.camTarget.z = THREE.MathUtils.clamp(this.camTarget.z + (dz / len) * this.PAN_SPEED, -this.PAN_BOUND, this.PAN_BOUND);
    this.updateCameraPosition();
  }

  private updateCameraPosition(): void {
    const horizontalRadius = this.camDistance * Math.cos(this.camPitch);
    const height = this.camDistance * Math.sin(this.camPitch);
    const x = this.camTarget.x + Math.sin(this.camAngle) * horizontalRadius;
    const z = this.camTarget.z + Math.cos(this.camAngle) * horizontalRadius;
    this.camera.position.set(x, Math.max(2.5, height), z);
    this.camera.lookAt(this.camTarget.x, 0, this.camTarget.z);
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
    const group = new THREE.Group();
    group.position.set(loc.x, 0, loc.z);

    if (loc.type === "park") {
      this.addParkDetails(group);
      this.scene.add(group);
      this.attachLabel(this.makeLabel(loc.name), () => new THREE.Vector3(loc.x, 1.8, loc.z));
      if (this.townHub && loc.id !== this.townHub.id) this.buildRoad(this.townHub, loc);
      return;
    }

    if (loc.id === "square") {
      this.addPlazaDetails(group);
      this.scene.add(group);
      this.attachLabel(this.makeLabel(loc.name), () => new THREE.Vector3(loc.x, 2, loc.z));
      return; // it IS the hub -- nothing to connect a road to
    }

    const height = loc.type === "house" ? 3.6 : 6;
    const size = loc.type === "public" ? 8 : 6;
    const wallMat = loc.modern
      ? new THREE.MeshStandardMaterial({
          color: MODERN_COLOR,
          emissive: MODERN_EMISSIVE,
          emissiveIntensity: 0.6,
          metalness: 0.4,
          roughness: 0.25,
        })
      : new THREE.MeshStandardMaterial({ color: BUILDING_COLORS[loc.type] });

    const walls = new THREE.Mesh(new THREE.BoxGeometry(size, height, size), wallMat);
    walls.position.y = height / 2;
    walls.castShadow = true;
    walls.receiveShadow = true;
    group.add(walls);

    if (loc.type === "house") {
      this.addHouseDetails(group, size, height);
    } else {
      this.addFacadeDetails(group, loc, size, height);
    }

    this.scene.add(group);

    const label = this.makeLabel(loc.modern ? `✨ ${loc.name}` : loc.name);
    const labelHeight = height + (loc.type === "house" ? 2.6 : 1.2);
    this.attachLabel(label, () => new THREE.Vector3(loc.x, labelHeight, loc.z));

    if (this.townHub && loc.id !== this.townHub.id) {
      this.buildRoad(this.townHub, loc);
    }
  }

  /** Pitched roof, door, and lit windows -- a house silhouette instead of a bare box. */
  private addHouseDetails(group: THREE.Group, size: number, height: number): void {
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(size * 0.78, 1.8, 4),
      new THREE.MeshStandardMaterial({ color: 0x5a3a2e })
    );
    roof.rotation.y = Math.PI / 4;
    roof.position.y = height + 0.9;
    roof.castShadow = true;
    group.add(roof);

    const door = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1.8),
      new THREE.MeshStandardMaterial({ color: 0x2c2018 })
    );
    door.position.set(0, 0.9, size / 2 + 0.02);
    group.add(door);

    const windowMat = new THREE.MeshStandardMaterial({
      color: 0xbfe3ff,
      emissive: 0x6fa8dc,
      emissiveIntensity: 0.45,
    });
    for (const ox of [-size / 4, size / 4]) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), windowMat);
      win.position.set(ox, height * 0.62, size / 2 + 0.02);
      group.add(win);
    }
  }

  /** Roof trim + a window grid on the front facade, plus an awning for shops/cafes. */
  private addFacadeDetails(group: THREE.Group, loc: WorldLocation, size: number, height: number): void {
    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(size + 0.4, 0.3, size + 0.4),
      new THREE.MeshStandardMaterial({ color: 0x1c2534 })
    );
    trim.position.y = height + 0.15;
    group.add(trim);

    const windowMat = new THREE.MeshStandardMaterial({
      color: loc.modern ? 0xdff7ff : 0xbfe3ff,
      emissive: loc.modern ? 0x2fa8c9 : 0x6fa8dc,
      emissiveIntensity: 0.5,
    });
    const cols = 3;
    const rows = loc.type === "public" ? 3 : 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.95), windowMat);
        const ox = (c - (cols - 1) / 2) * (size / (cols + 0.6));
        const oy = height * (0.3 + r * 0.28);
        win.position.set(ox, Math.min(height - 0.5, oy), size / 2 + 0.02);
        group.add(win);
      }
    }

    if (loc.type === "shop" || loc.type === "cafe") {
      const awning = new THREE.Mesh(
        new THREE.BoxGeometry(size + 0.6, 0.25, 1.2),
        new THREE.MeshStandardMaterial({ color: loc.type === "cafe" ? 0x7a3040 : 0x7a5c28 })
      );
      awning.position.set(0, height * 0.55, size / 2 + 0.6);
      awning.rotation.x = -0.15;
      awning.castShadow = true;
      group.add(awning);
    }
  }

  private addParkDetails(group: THREE.Group): void {
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(5, 5, 0.4, 24),
      new THREE.MeshStandardMaterial({ color: BUILDING_COLORS.park })
    );
    disc.position.y = 0.2;
    disc.receiveShadow = true;
    group.add(disc);
    for (let i = 0; i < 6; i++) {
      const tree = makeTree();
      const angle = (i / 6) * Math.PI * 2;
      tree.position.set(Math.cos(angle) * 4, 0, Math.sin(angle) * 4);
      group.add(tree);
    }
    const bench = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.5, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x6b4a34 })
    );
    bench.position.set(0, 0.45, 0);
    bench.castShadow = true;
    group.add(bench);
  }

  /** The town square: open pavement with a small fountain, not a building. */
  private addPlazaDetails(group: THREE.Group): void {
    const pavement = new THREE.Mesh(
      new THREE.CylinderGeometry(7, 7, 0.25, 32),
      new THREE.MeshStandardMaterial({ color: 0x8a8a86 })
    );
    pavement.position.y = 0.12;
    pavement.receiveShadow = true;
    group.add(pavement);

    const basin = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.8, 0.5, 20),
      new THREE.MeshStandardMaterial({ color: 0x5a6672 })
    );
    basin.position.y = 0.5;
    basin.castShadow = true;
    group.add(basin);

    const spout = new THREE.Mesh(
      new THREE.ConeGeometry(0.25, 1.1, 12),
      new THREE.MeshStandardMaterial({ color: 0xbfe3ff, emissive: 0x3d7ea8, emissiveIntensity: 0.3 })
    );
    spout.position.y = 1.2;
    group.add(spout);

    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const lamp = makeLampPost();
      lamp.position.set(Math.cos(angle) * 5.5, 0, Math.sin(angle) * 5.5);
      group.add(lamp);
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
      this.applyPanFlags();
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

function touchDistance(touches: TouchList): number {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
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

function makeLampPost(): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 2.4, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2e })
  );
  pole.position.y = 1.2;
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffcf6b, emissiveIntensity: 0.9 })
  );
  bulb.position.y = 2.45;
  g.add(pole, bulb);
  return g;
}
