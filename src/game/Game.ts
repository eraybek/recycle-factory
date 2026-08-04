import * as THREE from 'three';
import { MovementInput } from '../input/MovementInput';
import { PurchaseZone } from './PurchaseZone';
import { CarriedStack } from './CarriedStack';
import { buildHypercasualCharacter, carrySlot, type CharacterAnimator } from './HypercasualCharacter';
import { CoinFlow } from './CoinFlow';
import { QuestMarker } from './QuestMarker';

type WasteKind = 'plastic' | 'metal';

interface WasteItem {
  object: THREE.Group;
  kind: WasteKind;
  active: boolean;
  respawnAt: number;
  /** Litter on the future factory plot: cleared once, never comes back. */
  inYard: boolean;
}

/** A grimy stain on the plot that the player sweeps away by standing on it. */
interface DirtPatch {
  mesh: THREE.Mesh;
  progress: number;
  done: boolean;
}

interface BuildStage {
  id: string;
  name: string;
  cost: number;
  /** Where the finished building stands. */
  position: THREE.Vector3;
  /** Where the player stands to pay - in front of the plot, never inside it. */
  padPosition: THREE.Vector3;
  /** Footprint blocked once the building is up. */
  footprint: { width: number; depth: number };
  message: string;
}

/** Axis-aligned footprint the player cannot walk into. */
interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface RecycleBin {
  position: THREE.Vector3;
  mouth: THREE.Vector3;
}

/**
 * The region starts drab and polluted and turns lush as it is cleaned up. Every
 * colour that transforms is listed as a dirty/clean pair and blended by the
 * greening level, so the whole change is driven from one number.
 */
const DIRTY = {
  grass: 0x9a9a6a,
  grassAlt: 0xa3a172,
  sky: 0xd6d9bd,
};

const CLEAN = {
  grass: 0x8ec472,
  grassAlt: 0xa8db86,
  sky: 0xd8f0c8,
};

/** The factory plot before and after the player clears it. */
const YARD_DERELICT = 0x8a7a5e;
const YARD_PAVED = 0xe8d7b5;
const YARD_LITTER_COUNT = 22;
const DIRT_PATCH_COUNT = 6;
/** Half-extent of the factory shell raised on the cleared plot. */
const FACTORY_REACH = 6;

/** Recycled items needed to fully green the region. */
const GREEN_TARGET = 120;

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
    id: 'walls',
    name: 'Fabrika Duvarları',
    cost: 200,
    position: new THREE.Vector3(0, 0, 0),
    padPosition: new THREE.Vector3(0, 0, 7.4),
    footprint: { width: 0, depth: 0 },
    message: 'Fabrika duvarları çekildi',
  },
  {
    id: 'sorting',
    name: 'Ayrıştırma Alanı',
    cost: 320,
    position: new THREE.Vector3(-4.2, 0, -4),
    padPosition: new THREE.Vector3(-4.2, 0, -1.2),
    footprint: { width: 3.4, depth: 2.1 },
    message: 'Ayrıştırma alanı kuruldu — atıklar daha değerli',
  },
  {
    id: 'plastic-press',
    name: 'Plastik Pres',
    cost: 600,
    position: new THREE.Vector3(0, 0, -4.5),
    padPosition: new THREE.Vector3(0, 0, -1.8),
    footprint: { width: 2.9, depth: 2.9 },
    message: 'Plastik pres kuruldu — plastik iki katı',
  },
  {
    id: 'metal-press',
    name: 'Metal Pres',
    cost: 1000,
    position: new THREE.Vector3(4.2, 0, -4),
    padPosition: new THREE.Vector3(4.2, 0, -1.2),
    footprint: { width: 2.9, depth: 2.9 },
    message: 'Metal pres kuruldu — metal iki katı',
  },
  {
    id: 'depot',
    name: 'Satış Noktası',
    cost: 1600,
    position: new THREE.Vector3(3.6, 0, 3.4),
    padPosition: new THREE.Vector3(0.2, 0, 3.4),
    footprint: { width: 3.4, depth: 2.2 },
    message: 'Satış noktası kuruldu — tüm ürünler daha pahalı',
  },
];

/**
 * One objective at a time, in a fixed order. The chain is what teaches the
 * loop, so each step names a single thing to do and points at where to do it.
 */
interface Quest {
  id: string;
  text: string;
  goal: number;
  progress: () => number;
  /** Where the beacon should stand, or null to hide it. */
  target: () => THREE.Vector3 | null;
  reward: number;
}

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
  // A single kerbside bin, off the plot so the factory can be built over it.
  private readonly bins: RecycleBin[] = [
    { position: new THREE.Vector3(0, 0, 11.4), mouth: new THREE.Vector3(0, 1.2, 11.4) },
  ];
  private readonly colliders: Collider[] = [];
  private coinFlow!: CoinFlow;
  private questMarker!: QuestMarker;
  private coinTimer = 0;
  private readonly quests: Quest[] = [];
  private questIndex = 0;
  private collectedCount = 0;
  private recycledCount = 0;
  private greenLevel = 0;
  private shownGreen = -1;
  private yardMaterial!: THREE.MeshStandardMaterial;
  private readonly dirtPatches: DirtPatch[] = [];
  private yardLitterTotal = 0;
  private yardLitterCleared = 0;
  private yardCleaned = false;
  private readonly greenSurfaces: THREE.MeshStandardMaterial[] = [];
  private readonly saplings: Array<{ object: THREE.Group; revealAt: number; grown: number }> = [];
  private readonly greenElement: HTMLElement;
  private readonly greenFillElement: HTMLElement;
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
    // The purchase pads clip their fill with a per-material plane.
    this.renderer.localClippingEnabled = true;
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
    this.greenElement = this.requireElement('green-value');
    this.greenFillElement = this.requireElement('green-fill');

    this.input = new MovementInput(
      this.requireElement('joystick-zone'),
      this.requireElement('joystick-base'),
      this.requireElement('joystick-knob'),
    );

    this.coinFlow = new CoinFlow(this.scene);
    this.questMarker = new QuestMarker(this.scene);

    this.configureScene();
    this.createTerrain();
    this.createYard();
    this.createWasteField();
    this.openNextBuildPad();
    this.createPlayer();
    this.createQuests();
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
    this.registerGreenSurface(grass, DIRTY.grass, CLEAN.grass);

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
      this.registerGreenSurface(patch, DIRTY.grassAlt, CLEAN.grassAlt);
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
      // Sized to the trunk rather than the crown, so brushing past a canopy
      // does not feel like hitting a wall.
      this.addCollider(tree.position, 0.9, 0.9);
    }

    this.createSaplings();
  }

  /**
   * Trees that are not there at the start. They sprout one by one as the region
   * greens, so cleaning up visibly changes the place rather than just a counter.
   */
  private createSaplings(): void {
    const spots: Array<[number, number]> = [
      [-13, 4], [13, 5], [-5, 14], [6, 14], [-14, -4], [14, -5],
      [-5, -14], [5, -14], [-11, 11], [11, 11], [-11, -11], [11, -12],
      [-18, 6], [18, -7], [7, -18], [-7, 18],
    ];

    spots.forEach(([x, z], index) => {
      const tree = this.createTree();
      tree.position.set(x, 0, z);
      tree.scale.setScalar(0.001);
      tree.visible = false;
      this.scene.add(tree);
      this.addCollider(tree.position, 0.9, 0.9);

      // Spread the sprouting evenly across the whole greening curve.
      this.saplings.push({
        object: tree,
        revealAt: (index + 1) / (spots.length + 1),
        grown: 0,
      });
    });
  }

  private registerGreenSurface(mesh: THREE.Mesh, dirty: number, clean: number): void {
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.userData.dirty = new THREE.Color(dirty);
    material.userData.clean = new THREE.Color(clean);
    material.color.copy(material.userData.dirty);
    this.greenSurfaces.push(material);
  }

  /** Blends every transforming colour and sprouts saplings for the given level. */
  private applyGreening(delta: number): void {
    const target = THREE.MathUtils.clamp(this.recycledCount / GREEN_TARGET, 0, 1);
    this.greenLevel = THREE.MathUtils.lerp(this.greenLevel, target, 1 - Math.exp(-delta * 2.5));

    for (const material of this.greenSurfaces) {
      material.color
        .copy(material.userData.dirty as THREE.Color)
        .lerp(material.userData.clean as THREE.Color, this.greenLevel);
    }

    const sky = new THREE.Color(DIRTY.sky).lerp(new THREE.Color(CLEAN.sky), this.greenLevel);
    (this.scene.background as THREE.Color).copy(sky);
    this.groundFog.color.copy(sky);

    for (const sapling of this.saplings) {
      if (this.greenLevel < sapling.revealAt) continue;

      sapling.object.visible = true;
      sapling.grown = Math.min(1, sapling.grown + delta * 1.4);
      // Overshoot slightly so a tree pops rather than inflates.
      const scale = sapling.grown * (1 + Math.sin(sapling.grown * Math.PI) * 0.18);
      sapling.object.scale.setScalar(Math.max(scale, 0.001));
    }
  }

  /** The paved plot in the middle where the factory gets built. */
  private createYard(): void {
    // The plot starts derelict and is paved by the act of clearing it.
    const yard = this.createBox(YARD_REACH * 2, 0.22, YARD_REACH * 2, YARD_DERELICT);
    yard.position.y = LAYER.yard - 0.11;
    yard.receiveShadow = true;
    this.scene.add(yard);
    this.yardMaterial = yard.material as THREE.MeshStandardMaterial;

    this.createDirtPatches();

    const kerb = this.createBox(YARD_REACH * 2 + 0.7, 0.16, YARD_REACH * 2 + 0.7, COLORS.kerb);
    kerb.position.y = LAYER.kerb - 0.08;
    kerb.receiveShadow = true;
    this.scene.add(kerb);

    for (const bin of this.bins) this.createRecycleBin(bin);
  }

  private createDirtPatches(): void {
    const spots: Array<[number, number]> = [
      [-4.5, -4], [4, -4.5], [0, -1], [-4, 3], [4.5, 3.5], [0.5, 5.5],
    ];

    for (let index = 0; index < DIRT_PATCH_COUNT; index += 1) {
      const [x, z] = spots[index % spots.length];
      const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(THREE.MathUtils.randFloat(1.1, 1.6), 14),
        new THREE.MeshStandardMaterial({
          color: 0x5d4f3a,
          transparent: true,
          opacity: 0.8,
          flatShading: true,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, LAYER.yard + 0.01, z);
      this.scene.add(mesh);
      this.dirtPatches.push({ mesh, progress: 0, done: false });
    }
  }

  /** 0 to 1 across the plot's litter and stains together. */
  private get yardProgress(): number {
    const total = this.yardLitterTotal + this.dirtPatches.length;
    if (total === 0) return 1;
    const done = this.yardLitterCleared + this.dirtPatches.filter((patch) => patch.done).length;
    return done / total;
  }

  private updateSweeping(delta: number): void {
    if (this.isMapView || this.isPanelOpen) return;

    for (const patch of this.dirtPatches) {
      if (patch.done) continue;

      const material = patch.mesh.material as THREE.MeshStandardMaterial;
      const near = patch.mesh.position.distanceToSquared(this.player.position) < 2.6;

      if (near) {
        patch.progress += delta;
        material.opacity = THREE.MathUtils.clamp(0.8 * (1 - patch.progress / 1.6), 0, 0.8);

        if (patch.progress >= 1.6) {
          patch.done = true;
          patch.mesh.visible = false;
          this.showMessage('Alan süpürüldü');
        }
      } else if (patch.progress > 0) {
        patch.progress = Math.max(0, patch.progress - delta * 0.4);
        material.opacity = THREE.MathUtils.clamp(0.8 * (1 - patch.progress / 1.6), 0, 0.8);
      }
    }

    // Paving keeps pace with the clearing, so the plot visibly becomes a site.
    const progress = this.yardProgress;
    this.yardMaterial.color
      .copy(new THREE.Color(YARD_DERELICT))
      .lerp(new THREE.Color(YARD_PAVED), progress);

    if (!this.yardCleaned && progress >= 1) {
      this.yardCleaned = true;
      this.showMessage('Alan temizlendi — fabrikayı kurabilirsin');
      this.openNextBuildPad();
    }
  }

  /** Simple first-prototype drop-off: either bin accepts whatever the player is holding. */
  private createRecycleBin(bin: RecycleBin): void {
    const width = 1.5;
    const depth = 1.2;
    const height = 1.1;
    const color = 0x3f7f52;

    const group = new THREE.Group();
    group.position.copy(bin.position);

    const body = this.createBox(width, height, depth, color);
    body.position.y = height / 2;
    group.add(body);

    const rim = this.createBox(width + 0.18, 0.16, depth + 0.18, 0x3a4a44);
    rim.position.y = height + 0.02;
    group.add(rim);

    const mouth = this.createBox(width - 0.34, 0.1, depth - 0.34, 0x18201c);
    mouth.position.y = height + 0.11;
    group.add(mouth);

    // Lid propped open at the back so the bin reads as something to throw into.
    const lid = this.createBox(width, 0.12, depth, 0x2f3d38);
    lid.position.set(0, height + 0.42, -depth * 0.45);
    lid.rotation.x = -1.05;
    group.add(lid);

    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    this.scene.add(group);

    bin.mouth.set(bin.position.x, height + 0.5, bin.position.z);
    this.addCollider(bin.position, width, depth);
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
      const waste: WasteItem = { object, kind, active: true, respawnAt: 0, inYard: false };
      this.placeWaste(waste);
      this.scene.add(object);
      this.wastes.push(waste);
    }

    // Litter on the plot itself. It never respawns - clearing it is the job.
    for (let index = 0; index < YARD_LITTER_COUNT; index += 1) {
      const kind: WasteKind = index % 2 === 0 ? 'plastic' : 'metal';
      const object = this.createWasteObject(kind);
      const inset = YARD_REACH - 1.2;
      object.position.set(
        THREE.MathUtils.randFloat(-inset, inset),
        LAYER.yard + 0.12,
        THREE.MathUtils.randFloat(-inset, inset),
      );
      this.scene.add(object);
      this.wastes.push({ object, kind, active: true, respawnAt: 0, inYard: true });
      this.yardLitterTotal += 1;
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

  private addCollider(centre: THREE.Vector3, width: number, depth: number): void {
    this.colliders.push({
      minX: centre.x - width / 2,
      maxX: centre.x + width / 2,
      minZ: centre.z - depth / 2,
      maxZ: centre.z + depth / 2,
    });
  }

  /** True when the player's body would overlap something solid. */
  private blocked(x: number, z: number): boolean {
    return this.colliders.some(
      (collider) =>
        x > collider.minX - PLAYER_RADIUS &&
        x < collider.maxX + PLAYER_RADIUS &&
        z > collider.minZ - PLAYER_RADIUS &&
        z < collider.maxZ + PLAYER_RADIUS,
    );
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
    // Nothing can be built until the plot has actually been cleared.
    const stage = this.yardCleaned ? this.nextStage : undefined;
    if (!stage) {
      this.buildPad = null;
      return;
    }

    this.buildPad = new PurchaseZone({
      id: `build:${stage.id}`,
      title: stage.name,
      cost: stage.cost,
      position: stage.padPosition.clone(),
      radius: 1.3,
      groundHeight: LAYER.decal,
    });
    this.scene.add(this.buildPad.group);
  }

  private completeStage(stage: BuildStage): void {
    this.builtStages.add(stage.id);
    this.scene.add(this.createBuilding(stage));
    // The factory shell registers its own walls; everything else is one block.
    if (stage.footprint.width > 0) {
      this.addCollider(stage.position, stage.footprint.width, stage.footprint.depth);
    }
    this.showMessage(stage.message);

    if (this.buildPad) {
      this.scene.remove(this.buildPad.group);
      this.buildPad.dispose();
      this.buildPad = null;
    }

    this.openNextBuildPad();
  }

  /**
   * Four walls with a gap for a door and deliberately no roof, so the whole
   * production floor stays visible from the game's overhead camera.
   */
  private createFactoryShell(): THREE.Group {
    const group = new THREE.Group();
    const height = 2.4;
    const thickness = 0.4;
    const span = FACTORY_REACH * 2;
    const doorHalf = 1.6;

    const wall = (width: number, depth: number, x: number, z: number) => {
      const mesh = this.createBox(width, height, depth, 0xf1e6cd);
      mesh.position.set(x, height / 2, z);
      group.add(mesh);
      this.addCollider(new THREE.Vector3(x, 0, z), width, depth);
    };

    wall(span, thickness, 0, -FACTORY_REACH);
    wall(thickness, span, -FACTORY_REACH, 0);
    wall(thickness, span, FACTORY_REACH, 0);

    // Front wall split either side of the doorway.
    const sideWidth = FACTORY_REACH - doorHalf;
    wall(sideWidth, thickness, -(doorHalf + sideWidth / 2), FACTORY_REACH);
    wall(sideWidth, thickness, doorHalf + sideWidth / 2, FACTORY_REACH);

    // Door posts and a lintel, marking the entrance without closing it.
    for (const x of [-doorHalf, doorHalf]) {
      const post = this.createBox(0.34, height + 0.3, 0.34, 0x9c6f3c);
      post.position.set(x, (height + 0.3) / 2, FACTORY_REACH);
      group.add(post);
    }

    const lintel = this.createBox(doorHalf * 2 + 0.5, 0.34, 0.5, 0x9c6f3c);
    lintel.position.set(0, height + 0.3, FACTORY_REACH);
    group.add(lintel);

    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    return group;
  }

  private createBuilding(stage: BuildStage): THREE.Group {
    if (stage.id === 'walls') return this.createFactoryShell();

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

  // --- Quests ------------------------------------------------------------

  private createQuests(): void {
    const nearestWaste = (): THREE.Vector3 | null => {
      let best: THREE.Vector3 | null = null;
      let bestDistance = Infinity;

      for (const waste of this.wastes) {
        if (!waste.active) continue;
        const distance = waste.object.position.distanceToSquared(this.player.position);
        if (distance >= bestDistance) continue;
        bestDistance = distance;
        best = waste.object.position;
      }

      return best;
    };

    const nearestBin = (): THREE.Vector3 | null => {
      let best: THREE.Vector3 | null = null;
      let bestDistance = Infinity;

      for (const bin of this.bins) {
        const distance = bin.position.distanceToSquared(this.player.position);
        if (distance >= bestDistance) continue;
        bestDistance = distance;
        best = bin.position;
      }

      return best;
    };

    const buildPadTarget = () => this.buildPad?.position ?? null;

    /** Litter still lying on the factory plot, nearest first. */
    const nearestYardLitter = (): THREE.Vector3 | null => {
      let best: THREE.Vector3 | null = null;
      let bestDistance = Infinity;

      for (const waste of this.wastes) {
        if (!waste.active || !waste.inYard) continue;
        const distance = waste.object.position.distanceToSquared(this.player.position);
        if (distance >= bestDistance) continue;
        bestDistance = distance;
        best = waste.object.position;
      }

      return best;
    };

    const nearestDirt = (): THREE.Vector3 | null => {
      let best: THREE.Vector3 | null = null;
      let bestDistance = Infinity;

      for (const patch of this.dirtPatches) {
        if (patch.done) continue;
        const distance = patch.mesh.position.distanceToSquared(this.player.position);
        if (distance >= bestDistance) continue;
        bestDistance = distance;
        best = patch.mesh.position;
      }

      return best;
    };

    /** While carrying, point at the bin; otherwise at the next thing to clear. */
    const clearingTarget = (): THREE.Vector3 | null => {
      if (this.carriedStack.count >= this.carryCapacity) return nearestBin();
      return nearestYardLitter() ?? nearestDirt() ?? nearestBin();
    };

    this.quests.push(
      {
        id: 'collect-first',
        text: 'Arsadaki atıklardan 5 tane topla',
        goal: 5,
        progress: () => this.collectedCount,
        target: nearestYardLitter,
        reward: 0,
      },
      {
        id: 'recycle-first',
        text: 'Atıkları kenardaki geri dönüşüm kutusuna at',
        goal: 5,
        progress: () => this.recycledCount,
        target: nearestBin,
        reward: 20,
      },
      {
        id: 'clear-yard',
        text: 'Arsayı tamamen temizle ve süpür',
        goal: 100,
        progress: () => Math.floor(this.yardProgress * 100),
        target: clearingTarget,
        reward: 150,
      },
      {
        id: 'build-walls',
        text: 'Fabrikanın duvarlarını çek',
        goal: 1,
        progress: () => (this.builtStages.has('walls') ? 1 : 0),
        target: buildPadTarget,
        reward: 0,
      },
      {
        id: 'earn-outside',
        text: 'Çevredeki çöpleri topla: 40 atık geri dönüştür',
        goal: 40,
        progress: () => this.recycledCount,
        target: () => (this.carriedStack.isEmpty ? nearestWaste() : nearestBin()),
        reward: 120,
      },
      {
        id: 'build-sorting',
        text: 'Ayrıştırma alanını kur',
        goal: 1,
        progress: () => (this.builtStages.has('sorting') ? 1 : 0),
        target: buildPadTarget,
        reward: 0,
      },
      {
        id: 'green-quarter',
        text: 'Bölgenin dörtte birini yeşert',
        goal: 25,
        progress: () => Math.floor(this.greenLevel * 100),
        target: () => (this.carriedStack.isEmpty ? nearestWaste() : nearestBin()),
        reward: 200,
      },
      {
        id: 'build-plastic-press',
        text: 'Plastik presi kur',
        goal: 1,
        progress: () => (this.builtStages.has('plastic-press') ? 1 : 0),
        target: buildPadTarget,
        reward: 0,
      },
    );
  }

  private get currentQuest(): Quest | undefined {
    return this.quests[this.questIndex];
  }

  private updateQuests(delta: number): void {
    const quest = this.currentQuest;

    if (!quest) {
      this.questMarker.setTarget(null);
      this.questMarker.update(delta);
      return;
    }

    if (quest.progress() >= quest.goal) {
      this.questIndex += 1;
      if (quest.reward > 0) {
        this.money += quest.reward;
        this.showMessage(`Görev tamam — +${quest.reward}`);
      } else {
        this.showMessage('Görev tamam');
      }
    }

    this.questMarker.setTarget(this.currentQuest?.target() ?? null);
    this.questMarker.update(delta);
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
    this.updateSweeping(delta);
    this.updateBuildPad(delta);
    this.coinFlow.update(delta);
    this.applyGreening(delta);
    this.updateQuests(delta);
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

    // Resolved one axis at a time so the player slides along an obstacle
    // instead of sticking to it.
    const step = this.moveSpeed * delta;
    const edge = WORLD_REACH - PLAYER_RADIUS;

    const nextX = THREE.MathUtils.clamp(this.player.position.x + movement.x * step, -edge, edge);
    if (!this.blocked(nextX, this.player.position.z)) {
      this.player.position.x = nextX;
    }

    const nextZ = THREE.MathUtils.clamp(this.player.position.z + movement.z * step, -edge, edge);
    if (!this.blocked(this.player.position.x, nextZ)) {
      this.player.position.z = nextZ;
    }

    const targetRotation = Math.atan2(movement.x, movement.z);
    this.player.rotation.y = this.lerpAngle(this.player.rotation.y, targetRotation, 10 * delta);
    this.player.position.y = 0.05 + Math.sin(this.elapsed * 12) * 0.035;
  }

  private updateWasteRespawns(): void {
    for (const waste of this.wastes) {
      if (waste.inYard || waste.active || this.elapsed < waste.respawnAt) continue;
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
        if (nearby.inYard) this.yardLitterCleared += 1;
        // The item flies from exactly where it was lying into the player's arms.
        this.carriedStack.add(nearby.kind, nearby.object.position);
        this.characterAnimator.playPickup();
        this.collectedCount += 1;
        this.interactionCooldown = 0.12;
        return;
      }
    }

    const bin = this.bins.find(
      (candidate) => candidate.position.distanceToSquared(this.player.position) < 4.6,
    );

    if (bin && !this.carriedStack.isEmpty) {
      this.carriedStack.takeOne(bin.mouth, (kind) => {
        // Paid when the item actually lands in the bin, not on contact.
        const value = this.valueOf(kind as WasteKind);
        this.money += value;
        this.recycledCount += 1;
        this.showMessage(`+${value}`);
        // Earnings fly out of the bin up to the counter.
        this.coinFlow.emitToHud(bin.mouth, this.camera);
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

      // A steady stream of notes from the player to the pad while it fills.
      if (spent > 0) {
        this.coinTimer += delta;
        while (this.coinTimer >= 0.07) {
          this.coinTimer -= 0.07;
          this.coinFlow.emit(this.player.position, pad.position);
        }
      }

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

    const green = Math.round(this.greenLevel * 100);
    if (green !== this.shownGreen) {
      this.shownGreen = green;
      this.greenElement.textContent = `%${green}`;
      this.greenFillElement.style.width = `${green}%`;
    }

    if (this.isMapView) {
      this.objectiveElement.textContent = 'Bölge görünümü — Harita düğmesiyle oyuncuya dön';
      return;
    }

    const quest = this.currentQuest;

    if (!quest) {
      this.objectiveElement.textContent = 'Bölge senin — temizlemeye devam et';
      return;
    }

    const progress = Math.min(quest.progress(), quest.goal);
    this.objectiveElement.textContent =
      quest.goal > 1 ? `${quest.text}  (${progress}/${quest.goal})` : quest.text;
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
