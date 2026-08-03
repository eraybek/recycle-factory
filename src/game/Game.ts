import * as THREE from 'three';
import { MovementInput } from '../input/MovementInput';
import { PurchaseZone } from './PurchaseZone';
import { CarriedStack } from './CarriedStack';
import { buildHypercasualCharacter, carrySlot, type CharacterAnimator } from './HypercasualCharacter';

type WasteKind = 'plastic' | 'metal';

interface WasteItem {
  object: THREE.Group;
  kind: WasteKind;
  active: boolean;
  respawnAt: number;
}

interface BuildStage {
  id: string;
  name: string;
  cost: number;
  /** Where the finished building and its build pad sit. */
  position: THREE.Vector3;
  message: string;
}

const COLORS = {
  grass: 0x8ec472,
  grassAlt: 0x98cf7a,
  road: 0x6f7b82,
  yard: 0xe8d7b5,
  kerb: 0xc8c2b5,
  white: 0xf7f4e8,
  plastic: 0x4db5f0,
  metal: 0xd9805b,
};

/** Half-extent of the whole map. */
const WORLD_REACH = 22.5;
/** Half-extent of the paved yard the factory is built on. */
const YARD_REACH = 9;
const ROAD_WIDTH = 5;
const PLAYER_RADIUS = 0.45;

/**
 * Top surface of every stacked ground layer. Coplanar surfaces z-fight and make
 * the ground shimmer, so each layer gets its own height and decals always sit
 * clear of whatever they are painted on.
 */
const LAYER = {
  grass: 0,
  patch: 0.015,
  road: 0.05,
  marking: 0.075,
  kerb: 0.08,
  yard: 0.11,
  decal: 0.15,
};
const WASTE_COUNT = 150;
const WASTE_RESPAWN_SECONDS = 12;

const BASE_VALUE: Record<WasteKind, number> = {
  plastic: 6,
  metal: 9,
};

/**
 * The factory is raised one building at a time, and only the next stage's pad
 * is ever on the ground, so the route from an empty yard to a working plant
 * stays a single, obvious next step.
 */
const BUILD_STAGES: BuildStage[] = [
  {
    id: 'sorting',
    name: 'Ayrıştırma Alanı',
    cost: 150,
    position: new THREE.Vector3(-5.6, 0, 0.5),
    message: 'Ayrıştırma alanı kuruldu — atıklar daha değerli',
  },
  {
    id: 'plastic-press',
    name: 'Plastik Pres',
    cost: 380,
    position: new THREE.Vector3(-5.6, 0, -6.2),
    message: 'Plastik pres kuruldu — plastik iki katı',
  },
  {
    id: 'metal-press',
    name: 'Metal Pres',
    cost: 700,
    position: new THREE.Vector3(5.6, 0, -6.2),
    message: 'Metal pres kuruldu — metal iki katı',
  },
  {
    id: 'depot',
    name: 'Satış Noktası',
    cost: 1200,
    position: new THREE.Vector3(5.6, 0, 0.5),
    message: 'Satış noktası kuruldu — tüm ürünler daha pahalı',
  },
];

interface UpgradeDefinition {
  id: string;
  name: string;
  /** Value of the stat at each level, starting from the level the player owns. */
  values: number[];
  costs: number[];
  format: (value: number) => string;
}

/**
 * Numeric upgrades are bought from the panel rather than from a pad on the
 * ground; the ground is reserved for physical purchases like raising a building.
 */
const UPGRADES: UpgradeDefinition[] = [
  {
    id: 'capacity',
    name: 'Taşıma Kapasitesi',
    values: [8, 11, 14, 18, 23],
    costs: [120, 260, 520, 950],
    format: (value) => `${value} atık`,
  },
  {
    id: 'speed',
    name: 'Hareket Hızı',
    values: [4.6, 5.2, 5.8, 6.5, 7.3],
    costs: [150, 320, 640, 1150],
    format: (value) => `${value.toFixed(1)} birim/sn`,
  },
  {
    id: 'reach',
    name: 'Toplama Menzili',
    values: [1.16, 1.35, 1.6, 1.9],
    costs: [110, 280, 600],
    format: (value) => `${value.toFixed(2)} birim`,
  },
];

export class Game {
  private readonly scene = new THREE.Scene();
  // The follow camera never gets closer than about twenty units, so a near
  // plane of one costs nothing and buys a lot of depth precision.
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 1, 160);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly clock = new THREE.Clock();
  private readonly input: MovementInput;
  private readonly player = new THREE.Group();
  private carriedStack!: CarriedStack;
  private characterAnimator!: CharacterAnimator;
  private readonly wastes: WasteItem[] = [];
  private readonly builtStages = new Set<string>();
  private buildPad: PurchaseZone | null = null;
  private readonly cameraLookTarget = new THREE.Vector3();
  private readonly cameraDesired = new THREE.Vector3();
  /** Only used at ground level: the map view sits far beyond its far plane. */
  private readonly groundFog = new THREE.Fog(0xd8f0c8, 46, 100);
  private readonly recyclePosition = new THREE.Vector3(0, 0, -3.4);
  private readonly recycleMouth = new THREE.Vector3(0, 1.6, -3.4);
  private readonly moneyElement: HTMLElement;
  private readonly bagElement: HTMLElement;
  private readonly objectiveElement: HTMLElement;
  private readonly statusElement: HTMLElement;
  private readonly mapButton: HTMLButtonElement;
  private readonly upgradeButton: HTMLButtonElement;
  private readonly upgradeCloseButton: HTMLButtonElement;
  private readonly upgradePanel: HTMLElement;
  private readonly upgradeList: HTMLElement;
  private money = 0;
  /** Level owned for each upgrade id, raised from the upgrade panel. */
  private readonly upgradeLevels = new Map<string, number>();
  private shownMoney = -1;
  private isMapView = false;
  private isPanelOpen = false;
  private interactionCooldown = 0;
  private messageTimeout = 0;
  private elapsed = 0;

  constructor(private readonly root: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: window.devicePixelRatio <= 1.5,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.root.appendChild(this.renderer.domElement);

    this.moneyElement = this.requireElement('money-value');
    this.bagElement = this.requireElement('bag-value');
    this.objectiveElement = this.requireElement('objective');
    this.statusElement = this.requireElement('status-message');
    this.mapButton = this.requireElement('map-button') as HTMLButtonElement;
    this.upgradeButton = this.requireElement('upgrade-button') as HTMLButtonElement;
    this.upgradeCloseButton = this.requireElement('upgrade-close') as HTMLButtonElement;
    this.upgradePanel = this.requireElement('upgrade-panel');
    this.upgradeList = this.requireElement('upgrade-list');

    this.input = new MovementInput(
      this.requireElement('joystick-zone'),
      this.requireElement('joystick-base'),
      this.requireElement('joystick-knob'),
    );

    this.configureScene();
    this.createTerrain();
    this.createYard();
    this.createWasteField();
    this.openNextBuildPad();
    this.createPlayer();
    this.bindEvents();
    this.buildUpgradePanel();
    this.resize();
    this.updateHud();
    this.renderer.setAnimationLoop(this.tick);
  }

  private configureScene(): void {
    this.scene.background = new THREE.Color(0xd8f0c8);
    this.scene.fog = this.groundFog;

    const hemisphere = new THREE.HemisphereLight(0xffffff, 0x6d825a, 2.2);
    this.scene.add(hemisphere);

    const sun = new THREE.DirectionalLight(0xfff3d2, 3.2);
    sun.position.set(-14, 26, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    sun.shadow.camera.far = 80;
    this.scene.add(sun);
  }

  // --- World -------------------------------------------------------------

  /**
   * One continuous, open landscape: grass everywhere, a ring road around the
   * yard and four roads running out to the edges. Nothing is fenced off - the
   * whole map is walkable and littered from the first second.
   */
  private createTerrain(): void {
    const span = WORLD_REACH * 2;

    const grass = this.createBox(span, 0.3, span, COLORS.grass);
    grass.position.y = LAYER.grass - 0.15;
    grass.receiveShadow = true;
    this.scene.add(grass);

    // Patches so the green is not a single flat colour.
    for (const [x, z] of [[-15, -15], [15, -14], [-14, 15], [16, 16], [0, -18], [-18, 2]] as Array<
      [number, number]
    >) {
      const patch = new THREE.Mesh(
        new THREE.CircleGeometry(THREE.MathUtils.randFloat(4, 6.5), 18),
        new THREE.MeshStandardMaterial({ color: COLORS.grassAlt, flatShading: true }),
      );
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(x, LAYER.patch, z);
      patch.receiveShadow = true;
      this.scene.add(patch);
    }

    const ringOuter = YARD_REACH + ROAD_WIDTH;

    // Ring road hugging the yard, built from four strips.
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
      const along = ringOuter * 2;
      const road = this.createBox(
        dx !== 0 ? ROAD_WIDTH : along,
        0.14,
        dz !== 0 ? ROAD_WIDTH : along,
        COLORS.road,
      );
      road.position.set(
        dx * (YARD_REACH + ROAD_WIDTH / 2),
        LAYER.road - 0.07,
        dz * (YARD_REACH + ROAD_WIDTH / 2),
      );
      road.receiveShadow = true;
      this.scene.add(road);
    }

    // Four roads leading out of the ring towards the edges of the map.
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
      const length = WORLD_REACH - ringOuter;
      const spoke = this.createBox(
        dx !== 0 ? length : ROAD_WIDTH,
        0.14,
        dz !== 0 ? length : ROAD_WIDTH,
        COLORS.road,
      );
      spoke.position.set(
        dx * (ringOuter + length / 2),
        LAYER.road - 0.07,
        dz * (ringOuter + length / 2),
      );
      spoke.receiveShadow = true;
      this.scene.add(spoke);

      for (let index = 0; index < 4; index += 1) {
        const offset = ringOuter + 2 + index * (length / 4);
        const marking = this.createBox(
          dx !== 0 ? 1.3 : 0.3,
          0.04,
          dz !== 0 ? 1.3 : 0.3,
          COLORS.white,
        );
        marking.position.set(dx * offset, LAYER.marking - 0.02, dz * offset);
        this.scene.add(marking);
      }
    }

    for (const [x, z] of [
      [-17, -8], [-8, -17], [17, -9], [9, -17],
      [-17, 9], [-9, 17], [17, 8], [8, 17],
      [-20, 20], [20, -20], [-20, -20], [20, 20],
    ] as Array<[number, number]>) {
      const tree = this.createTree();
      tree.position.set(x, 0, z);
      this.scene.add(tree);
    }
  }

  /** The paved plot in the middle where the factory gets built. */
  private createYard(): void {
    const yard = this.createBox(YARD_REACH * 2, 0.22, YARD_REACH * 2, COLORS.yard);
    yard.position.y = LAYER.yard - 0.11;
    yard.receiveShadow = true;
    this.scene.add(yard);

    const kerb = this.createBox(YARD_REACH * 2 + 0.7, 0.16, YARD_REACH * 2 + 0.7, COLORS.kerb);
    kerb.position.y = LAYER.kerb - 0.08;
    kerb.receiveShadow = true;
    this.scene.add(kerb);

    this.createRecycleBox();
  }

  private createRecycleBox(): void {
    const box = new THREE.Group();
    box.position.copy(this.recyclePosition);

    const body = this.createBox(2.6, 1.9, 1.9, 0x3f7f52);
    body.position.y = 0.95;
    box.add(body);

    const rim = this.createBox(2.9, 0.3, 2.2, 0x2c5c3b);
    rim.position.y = 2.0;
    box.add(rim);

    const mouth = this.createBox(2.1, 0.16, 1.4, 0x18301f);
    mouth.position.y = 2.14;
    box.add(mouth);

    for (const x of [-1.05, 1.05]) {
      const stripe = this.createBox(0.16, 1.1, 0.16, COLORS.white);
      stripe.position.set(x, 1.0, 0.98);
      box.add(stripe);
    }

    box.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    this.scene.add(box);

    const marker = new THREE.Mesh(
      new THREE.CircleGeometry(2.4, 40),
      new THREE.MeshBasicMaterial({ color: 0x63c97c, transparent: true, opacity: 0.5 }),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(this.recyclePosition.x, LAYER.decal, this.recyclePosition.z + 1.8);
    this.scene.add(marker);
  }

  private createTree(): THREE.Group {
    const tree = new THREE.Group();

    const trunk = this.createBox(0.35, 1.3, 0.35, 0x7b5635);
    trunk.position.y = 0.65;
    trunk.castShadow = true;
    tree.add(trunk);

    const crown = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.15, 0),
      new THREE.MeshStandardMaterial({ color: 0x4f9b55, flatShading: true }),
    );
    crown.position.y = 1.8;
    crown.castShadow = true;
    tree.add(crown);

    return tree;
  }

  private createWasteField(): void {
    for (let index = 0; index < WASTE_COUNT; index += 1) {
      const kind: WasteKind = index % 2 === 0 ? 'plastic' : 'metal';
      const object = this.createWasteObject(kind);
      const waste: WasteItem = { object, kind, active: true, respawnAt: 0 };
      this.placeWaste(waste);
      this.scene.add(object);
      this.wastes.push(waste);
    }
  }

  private placeWaste(waste: WasteItem): void {
    const edge = WORLD_REACH - 1.5;

    do {
      waste.object.position.set(
        THREE.MathUtils.randFloat(-edge, edge),
        0.12,
        THREE.MathUtils.randFloat(-edge, edge),
      );
      // Keep the yard's working area clear so buildings and pads stay readable.
    } while (this.isInsideYard(waste.object.position, 1.5));

    waste.object.rotation.y = Math.random() * Math.PI * 2;
  }

  private isInsideYard(point: THREE.Vector3, margin = 0): boolean {
    return (
      Math.abs(point.x) < YARD_REACH + margin && Math.abs(point.z) < YARD_REACH + margin
    );
  }

  private createWasteObject(kind: WasteKind, randomiseRotation = true): THREE.Group {
    const group = new THREE.Group();
    const color = kind === 'plastic' ? COLORS.plastic : COLORS.metal;

    if (kind === 'plastic') {
      const bottle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.16, 0.52, 8),
        new THREE.MeshStandardMaterial({ color, flatShading: true }),
      );
      bottle.rotation.z = Math.PI / 2;
      bottle.position.y = 0.2;
      bottle.castShadow = true;
      group.add(bottle);

      const cap = this.createBox(0.11, 0.16, 0.11, 0xf4f0d0);
      cap.position.set(0.33, 0.2, 0);
      cap.castShadow = true;
      group.add(cap);
    } else {
      const can = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.16, 0.4, 10),
        new THREE.MeshStandardMaterial({ color, flatShading: true }),
      );
      can.rotation.z = Math.PI / 2;
      can.position.y = 0.2;
      can.castShadow = true;
      group.add(can);
    }

    if (randomiseRotation) group.rotation.y = Math.random() * Math.PI;
    return group;
  }

  private createPlayer(): void {
    this.player.position.set(0, 0.05, 5.5);
    this.scene.add(this.player);

    this.carriedStack = new CarriedStack({
      owner: this.player,
      // Carried items are built by the same function the world objects use, so
      // what the player holds is exactly what they picked up off the ground.
      createVisual: (kind) => {
        const visual = this.createWasteObject(kind as WasteKind, false);
        visual.scale.setScalar(0.8);
        return visual;
      },
      slot: carrySlot,
    });

    this.characterAnimator = buildHypercasualCharacter(
      this.player,
      () => this.carriedStack.count,
    );
  }

  // --- Building the factory ----------------------------------------------

  private get nextStage(): BuildStage | undefined {
    return BUILD_STAGES.find((stage) => !this.builtStages.has(stage.id));
  }

  /** Puts the pad for the next unbuilt stage on the ground, and nothing else. */
  private openNextBuildPad(): void {
    const stage = this.nextStage;
    if (!stage) {
      this.buildPad = null;
      return;
    }

    this.buildPad = new PurchaseZone({
      id: `build:${stage.id}`,
      title: stage.name,
      cost: stage.cost,
      position: stage.position.clone(),
      radius: 1.3,
      groundHeight: LAYER.decal,
    });
    this.scene.add(this.buildPad.group);
  }

  private completeStage(stage: BuildStage): void {
    this.builtStages.add(stage.id);
    this.scene.add(this.createBuilding(stage));
    this.showMessage(stage.message);

    if (this.buildPad) {
      this.scene.remove(this.buildPad.group);
      this.buildPad.dispose();
      this.buildPad = null;
    }

    this.openNextBuildPad();
  }

  private createBuilding(stage: BuildStage): THREE.Group {
    const group = new THREE.Group();
    group.position.copy(stage.position);

    if (stage.id === 'sorting') {
      const table = this.createBox(3.4, 0.9, 2.1, 0x4e8255);
      table.position.y = 0.6;
      group.add(table);

      const belt = this.createBox(3.0, 0.18, 1.5, 0x2f4f36);
      belt.position.y = 1.12;
      group.add(belt);

      for (const x of [-1.3, 1.3]) {
        const leg = this.createBox(0.3, 0.6, 0.3, 0x3b6442);
        leg.position.set(x, 0.3, 0);
        group.add(leg);
      }
    } else if (stage.id === 'depot') {
      const counter = this.createBox(3.4, 1.1, 1.6, 0x9c6f3c);
      counter.position.y = 0.55;
      group.add(counter);

      const roof = this.createBox(4.0, 0.24, 2.4, 0xf3cf4f);
      roof.position.y = 2.3;
      group.add(roof);

      for (const x of [-1.7, 1.7]) {
        const post = this.createBox(0.22, 2.3, 0.22, 0xd8b23c);
        post.position.set(x, 1.15, -0.9);
        group.add(post);
      }
    } else {
      const color = stage.id === 'plastic-press' ? COLORS.plastic : COLORS.metal;

      const base = this.createBox(2.9, 0.55, 2.9, 0x40545a);
      base.position.y = 0.3;
      group.add(base);

      const body = this.createBox(2.2, 2.0, 2.0, color);
      body.position.y = 1.6;
      group.add(body);

      const piston = this.createBox(1.6, 0.4, 1.6, 0x26373d);
      piston.position.y = 2.85;
      group.add(piston);
    }

    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    return group;
  }

  /**
   * Each finished building makes what the player banks worth more. The physical
   * per-machine logistics chain comes later; for now the plant's value shows up
   * in the payout.
   */
  private valueOf(kind: WasteKind): number {
    let value = BASE_VALUE[kind];
    if (this.builtStages.has('sorting')) value *= 1.5;
    if (kind === 'plastic' && this.builtStages.has('plastic-press')) value *= 2;
    if (kind === 'metal' && this.builtStages.has('metal-press')) value *= 2;
    if (this.builtStages.has('depot')) value *= 1.4;
    return Math.round(value);
  }

  // --- Upgrades ----------------------------------------------------------

  private upgradeLevel(id: string): number {
    return this.upgradeLevels.get(id) ?? 0;
  }

  /** Current value of an upgraded stat. */
  private statOf(id: string): number {
    const definition = UPGRADES.find((item) => item.id === id);
    if (!definition) return 0;
    return definition.values[Math.min(this.upgradeLevel(id), definition.values.length - 1)];
  }

  /** Price of the next level, or null when the upgrade is maxed out. */
  private nextCost(definition: UpgradeDefinition): number | null {
    const level = this.upgradeLevel(definition.id);
    return level < definition.costs.length ? definition.costs[level] : null;
  }

  private get carryCapacity(): number {
    return this.statOf('capacity');
  }

  private get moveSpeed(): number {
    return this.statOf('speed');
  }

  private get pickupReach(): number {
    return this.statOf('reach');
  }

  private buildUpgradePanel(): void {
    this.upgradeList.replaceChildren();

    for (const definition of UPGRADES) {
      const row = document.createElement('li');
      row.className = 'upgrade-row';

      const text = document.createElement('div');
      text.className = 'upgrade-text';

      const name = document.createElement('div');
      name.className = 'upgrade-name';
      name.textContent = definition.name;

      const detail = document.createElement('div');
      detail.className = 'upgrade-detail';
      detail.dataset.role = 'detail';

      text.append(name, detail);

      const buy = document.createElement('button');
      buy.type = 'button';
      buy.className = 'upgrade-buy';
      buy.dataset.role = 'buy';
      buy.addEventListener('click', () => this.buyUpgrade(definition));

      row.dataset.upgrade = definition.id;
      row.append(text, buy);
      this.upgradeList.append(row);
    }

    this.refreshUpgradePanel();
  }

  private refreshUpgradePanel(): void {
    for (const definition of UPGRADES) {
      const row = this.upgradeList.querySelector<HTMLElement>(
        `[data-upgrade="${definition.id}"]`,
      );
      if (!row) continue;

      const detail = row.querySelector<HTMLElement>('[data-role="detail"]');
      const buy = row.querySelector<HTMLButtonElement>('[data-role="buy"]');
      if (!detail || !buy) continue;

      const level = this.upgradeLevel(definition.id);
      const cost = this.nextCost(definition);
      const current = definition.format(this.statOf(definition.id));

      if (cost === null) {
        detail.textContent = `${current} • en yüksek seviye`;
        buy.textContent = 'TAM';
        buy.disabled = true;
        continue;
      }

      const next = definition.format(definition.values[level + 1]);
      detail.textContent = `${current} → ${next}`;
      buy.textContent = `💵 ${cost}`;
      buy.disabled = this.money < cost;
    }

    const anyAffordable = UPGRADES.some((definition) => {
      const cost = this.nextCost(definition);
      return cost !== null && this.money >= cost;
    });
    this.upgradeButton.dataset.affordable = String(anyAffordable);
  }

  private buyUpgrade(definition: UpgradeDefinition): void {
    const cost = this.nextCost(definition);
    if (cost === null || this.money < cost) return;

    this.money -= cost;
    this.upgradeLevels.set(definition.id, this.upgradeLevel(definition.id) + 1);
    this.showMessage(`${definition.name} yükseltildi`);
    this.refreshUpgradePanel();
    this.updateHud();
  }

  private setPanelOpen(open: boolean): void {
    this.isPanelOpen = open;
    this.upgradePanel.hidden = !open;
    this.upgradeButton.setAttribute('aria-expanded', String(open));
    if (open) this.refreshUpgradePanel();
  }

  // --- Loop --------------------------------------------------------------

  private readonly tick = (): void => {
    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += delta;
    this.interactionCooldown = Math.max(0, this.interactionCooldown - delta);
    this.messageTimeout = Math.max(0, this.messageTimeout - delta);

    this.updatePlayer(delta);
    this.characterAnimator.update(delta);
    this.carriedStack.update(delta);
    this.updateWasteRespawns();
    this.updateInteractions();
    this.updateBuildPad(delta);
    this.updateCamera(delta);
    this.updateHud();

    if (this.messageTimeout === 0) {
      this.statusElement.classList.remove('visible');
    }

    this.renderer.render(this.scene, this.camera);
  };

  private updatePlayer(delta: number): void {
    if (this.isMapView || this.isPanelOpen) return;

    const movement = this.input.sample();
    const length = Math.hypot(movement.x, movement.z);
    if (length < 0.05) return;

    const step = this.moveSpeed * delta;
    const edge = WORLD_REACH - PLAYER_RADIUS;
    this.player.position.x = THREE.MathUtils.clamp(
      this.player.position.x + movement.x * step,
      -edge,
      edge,
    );
    this.player.position.z = THREE.MathUtils.clamp(
      this.player.position.z + movement.z * step,
      -edge,
      edge,
    );

    const targetRotation = Math.atan2(movement.x, movement.z);
    this.player.rotation.y = this.lerpAngle(this.player.rotation.y, targetRotation, 10 * delta);
    this.player.position.y = 0.05 + Math.sin(this.elapsed * 12) * 0.035;
  }

  private updateWasteRespawns(): void {
    for (const waste of this.wastes) {
      if (waste.active || this.elapsed < waste.respawnAt) continue;
      waste.active = true;
      waste.object.visible = true;
      this.placeWaste(waste);
    }
  }

  private updateInteractions(): void {
    if (this.isMapView || this.isPanelOpen || this.interactionCooldown > 0) return;

    if (this.carriedStack.count < this.carryCapacity) {
      const reach = this.pickupReach;
      const nearby = this.wastes.find(
        (waste) =>
          waste.active &&
          waste.object.position.distanceToSquared(this.player.position) < reach * reach,
      );
      if (nearby) {
        nearby.active = false;
        nearby.object.visible = false;
        nearby.respawnAt = this.elapsed + WASTE_RESPAWN_SECONDS;
        // The item flies from exactly where it was lying into the player's arms.
        this.carriedStack.add(nearby.kind, nearby.object.position);
        this.characterAnimator.playPickup();
        this.interactionCooldown = 0.12;
        return;
      }
    }

    if (
      !this.carriedStack.isEmpty &&
      this.player.position.distanceToSquared(this.recyclePosition) < 7.3
    ) {
      this.carriedStack.takeOne(this.recycleMouth, (kind) => {
        // Paid when the item actually lands in the box, not on contact.
        const value = this.valueOf(kind as WasteKind);
        this.money += value;
        this.showMessage(`+${value}`);
      });
      this.characterAnimator.playDrop();
      this.interactionCooldown = 0.16;
    }
  }

  private updateBuildPad(delta: number): void {
    const pad = this.buildPad;
    if (!pad) return;

    const inside = !this.isMapView && !this.isPanelOpen && pad.contains(this.player.position);
    pad.setActive(inside);

    if (inside && this.money > 0 && !pad.isComplete) {
      // Spend over roughly two and a half seconds so the wait is readable but
      // never tedious, and never faster than the player can afford.
      const rate = Math.max(20, pad.cost / 2.5);
      const spent = pad.contribute(Math.min(rate * delta, this.money));
      this.money -= spent;

      if (pad.isComplete) {
        const stage = this.nextStage;
        if (stage) this.completeStage(stage);
        return;
      }
    }

    pad.update(delta);
  }

  private updateCamera(delta: number): void {
    if (this.isMapView) {
      // Far enough back to frame the whole map.
      this.cameraDesired.set(0, 60, 44);
      this.cameraLookTarget.set(0, 0, 0);
    } else {
      this.cameraDesired.set(
        this.player.position.x,
        this.player.position.y + 17.5,
        this.player.position.z + 13.5,
      );
      this.cameraLookTarget.set(
        this.player.position.x,
        this.player.position.y + 0.55,
        this.player.position.z - 2.4,
      );
    }

    const smoothing = 1 - Math.exp(-delta * 4.5);
    this.camera.position.lerp(this.cameraDesired, smoothing);
    this.camera.lookAt(this.cameraLookTarget);
  }

  private updateHud(): void {
    const shownMoney = Math.floor(this.money);
    this.moneyElement.textContent = String(shownMoney);
    this.bagElement.textContent = `${this.carriedStack.count}/${this.carryCapacity}`;

    // Affordability is the only thing money changes in the panel, so the rows
    // are rewritten when the displayed figure moves rather than every frame.
    if (shownMoney !== this.shownMoney) {
      this.shownMoney = shownMoney;
      this.refreshUpgradePanel();
    }

    if (this.isMapView) {
      this.objectiveElement.textContent = 'Tesis görünümü — Harita düğmesiyle oyuncuya dön';
      return;
    }

    const stage = this.nextStage;

    if (this.carriedStack.count >= this.carryCapacity) {
      this.objectiveElement.textContent = 'Çanta dolu — atıkları dönüşüm kutusuna boşalt';
    } else if (stage && this.money >= stage.cost) {
      this.objectiveElement.textContent = `${stage.name} alanında bekleyerek inşa et`;
    } else if (!this.carriedStack.isEmpty) {
      this.objectiveElement.textContent = 'Atıkları dönüşüm kutusuna götür';
    } else if (stage) {
      this.objectiveElement.textContent = `Atık topla — sıradaki: ${stage.name}`;
    } else {
      this.objectiveElement.textContent = 'Tesis tamam — atık toplamaya devam et';
    }
  }

  // --- Helpers -----------------------------------------------------------

  private createBox(width: number, height: number, depth: number, color: number): THREE.Mesh {
    return new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({ color, flatShading: true }),
    );
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.resize);
    this.mapButton.addEventListener('click', () => {
      this.isMapView = !this.isMapView;
      this.scene.fog = this.isMapView ? null : this.groundFog;
      this.mapButton.setAttribute('aria-pressed', String(this.isMapView));
      this.mapButton.textContent = this.isMapView ? 'Oyuncuya Dön' : 'Harita';
      if (this.isMapView) this.setPanelOpen(false);
    });

    this.upgradeButton.addEventListener('click', () => {
      this.setPanelOpen(!this.isPanelOpen);
    });
    this.upgradeCloseButton.addEventListener('click', () => this.setPanelOpen(false));
  }

  private readonly resize = (): void => {
    const width = this.root.clientWidth;
    const height = this.root.clientHeight;
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private showMessage(message: string): void {
    this.statusElement.textContent = message;
    this.statusElement.classList.add('visible');
    this.messageTimeout = 1.2;
  }

  private lerpAngle(current: number, target: number, amount: number): number {
    const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
    return current + difference * Math.min(amount, 1);
  }

  private requireElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Required element #${id} was not found.`);
    return element;
  }
}
