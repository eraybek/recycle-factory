import * as THREE from 'three';
import { MovementInput } from '../input/MovementInput';
import { PurchaseZone } from './PurchaseZone';
import { CarriedStack } from './CarriedStack';
import { buildHypercasualCharacter, carrySlot, type CharacterAnimator } from './HypercasualCharacter';
import { CoinFlow } from './CoinFlow';
import { QuestMarker } from './QuestMarker';
import { CustomerQueue } from './CustomerQueue';

type WasteKind = 'plastic' | 'metal';
type BaleKind = `${WasteKind}-bale`;
/** Anything the player can be holding. */
type CarriedKind = WasteKind | BaleKind;
type WorkerRole = 'counter' | 'porter';
type WorkerState = 'idle' | 'to-counter' | 'serving' | 'to-machine' | 'to-bin';

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
  kind?: WasteKind;
  workerRole?: WorkerRole;
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
 * A baler. The player tips loose waste into its input, it presses a bale, and
 * the player carries that bale to the bin for far more than the loose waste was
 * worth. This is the first step out of pure collecting - and it stays manual:
 * the player is the conveyor until workers arrive.
 */
interface Machine {
  position: THREE.Vector3;
  /** Single interaction range around the machine body. */
  workPoint: THREE.Vector3;
  /** Where finished bales visibly stack, in front of the machine. */
  outputPoint: THREE.Vector3;
  kind: WasteKind;
  stock: number;
  bales: number;
  shownBales: number;
  timer: number;
  piston: THREE.Mesh;
  outputStack: THREE.Group;
  display: MachineDisplay;
}

interface MachineDisplay {
  sprite: THREE.Sprite;
  texture: THREE.CanvasTexture;
  context: CanvasRenderingContext2D | null;
  lastKey: string;
}

interface FactoryWorker {
  group: THREE.Group;
  role: WorkerRole;
  home: THREE.Vector3;
  target: THREE.Vector3;
  state: WorkerState;
  wait: number;
  carryKinds: CarriedKind[];
  carryVisuals: THREE.Object3D[];
}

function isBale(kind: string): kind is BaleKind {
  return kind === 'plastic-bale' || kind === 'metal-bale';
}

/**
 * Loose waste needed for one bale and how long the press takes. Neither the
 * input nor the output is capped - the machine takes everything it is given and
 * keeps every bale until the player comes for them.
 */
const BALE_INPUT = 5;
const BALE_SECONDS = 2.6;
/** Roughly double the loose waste that went in, so baling is worth it. */
const BALE_VALUE = 45;

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
/** Kept light: clearing the plot is the tutorial, not a chore. */
const YARD_LITTER_COUNT = 8;
const DIRT_PATCH_COUNT = 5;
/** Half-extent of the factory shell raised on the cleared plot. */
const FACTORY_REACH = 10;

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
const YARD_REACH = 12;
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
  plastic: 4,
  metal: 6,
};

/**
 * Where customers hand their bags over, and where the player stands to serve.
 * Lined up with the doorway so the queue walks straight in through it.
 */
const COUNTER_POSITION = new THREE.Vector3(0, 0, 1.1);
const COUNTER_SERVICE = new THREE.Vector3(0, 0, -0.65);
const QUEUE_HEAD = new THREE.Vector3(0, 0, 2.75);
const COUNTER_STOCK_POINT = new THREE.Vector3(0, 1.24, 1.1);
const COUNTER_WORKER_POINT = new THREE.Vector3(2.05, 0, 1.1);
const COUNTER_STOCK_SERVICE = new THREE.Vector3(1.9, 0, 1.1);
const WORKER_SERVICE_RANGE = 1.45;
const WORKER_CARRY_CAPACITY = 8;
const COUNTER_STOCK_CAP_PER_KIND = 10;
const BUILD_PAD_RADIUS = 1.3;

/**
 * The factory is raised one building at a time, and only the next stage's pad
 * is ever on the ground, so the route from an empty yard to a working plant
 * stays a single, obvious next step.
 */
const BUILD_STAGES: BuildStage[] = [
  {
    id: 'counter',
    name: 'Müşteri Tezgahı',
    cost: 10,
    position: COUNTER_POSITION.clone(),
    padPosition: new THREE.Vector3(0, 0, -1.6),
    footprint: { width: 3.2, depth: 1.2 },
    message: 'Tezgah açıldı — müşteriler atık getirmeye başladı',
  },
  {
    id: 'baler-1',
    name: 'Plastik Balya Makinesi',
    cost: 35,
    kind: 'plastic',
    position: new THREE.Vector3(-6.4, 0, -4.4),
    padPosition: new THREE.Vector3(-3.55, 0, -6.9),
    footprint: { width: 2.6, depth: 2.4 },
    message: 'Plastik balya makinesi kuruldu',
  },
  {
    id: 'walls',
    name: 'Fabrika Duvarları',
    cost: 80,
    position: new THREE.Vector3(0, 0, 0),
    // Well inside the shell: standing against the wall line meant the player
    // was trapped in it the moment the walls went up.
    padPosition: new THREE.Vector3(5, 0, 7),
    footprint: { width: 0, depth: 0 },
    message: 'Fabrika duvarları çekildi',
  },
  {
    id: 'worker-1',
    name: 'Tezgah Çalışanı',
    cost: 120,
    workerRole: 'counter',
    position: new THREE.Vector3(2.2, 0, -0.15),
    padPosition: new THREE.Vector3(4.9, 0, -1.9),
    footprint: { width: 0, depth: 0 },
    message: 'Tezgah çalışanı müşterilerden atık toplamaya başladı',
  },
  {
    id: 'worker-2',
    name: 'Taşıyıcı Çalışan',
    cost: 140,
    workerRole: 'porter',
    position: new THREE.Vector3(5.6, 0, -3.2),
    padPosition: new THREE.Vector3(6.9, 0, -1.9),
    footprint: { width: 0, depth: 0 },
    message: 'Taşıyıcı masadan makineye, hazır balyadan kutuya gidip geliyor',
  },
  {
    id: 'baler-2',
    name: 'Metal Balya Makinesi',
    cost: 160,
    kind: 'metal',
    position: new THREE.Vector3(-2.8, 0, -4.4),
    padPosition: new THREE.Vector3(-0.2, 0, -6.9),
    footprint: { width: 2.6, depth: 2.4 },
    message: 'Metal balya makinesi kuruldu',
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
  /** Recycled items before this upgrade is offered at all. */
  revealAfter: number;
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
    costs: [60, 150, 320, 650],
    format: (value) => `${value} atık`,
    revealAfter: 0,
  },
  {
    id: 'speed',
    name: 'Hareket Hızı',
    values: [4.6, 5.2, 5.8, 6.5, 7.3],
    costs: [90, 200, 420, 850],
    format: (value) => `${value.toFixed(1)} birim/sn`,
    revealAfter: 30,
  },
  {
    id: 'reach',
    name: 'Toplama Menzili',
    values: [1.16, 1.35, 1.6, 1.9],
    costs: [80, 180, 380],
    format: (value) => `${value.toFixed(2)} birim`,
    revealAfter: 70,
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
  // Back-right, but pulled away from the wall and build pads so it never pinches
  // the walking lane while the player is carrying bales.
  private readonly bins: RecycleBin[] = [
    { position: new THREE.Vector3(7.4, 0, -5.4), mouth: new THREE.Vector3(7.4, 1.2, -5.4) },
  ];
  private readonly colliders: Collider[] = [];
  private readonly machines: Machine[] = [];
  private readonly workers: FactoryWorker[] = [];
  private readonly counterStock: Record<WasteKind, number> = { plastic: 0, metal: 0 };
  private readonly counterStockGroup = new THREE.Group();
  private shownCounterStockKey = '';
  private customerQueue!: CustomerQueue;
  private servedCount = 0;
  private coinFlow!: CoinFlow;
  private questMarker!: QuestMarker;
  private coinTimer = 0;
  private readonly quests: Quest[] = [];
  private questIndex = 0;
  private collectedCount = 0;
  private recycledCount = 0;
  private baledCount = 0;
  private balesSold = 0;
  private greenLevel = 0;
  private yardMaterial!: THREE.MeshStandardMaterial;
  private readonly dirtPatches: DirtPatch[] = [];
  private yardLitterTotal = 0;
  private yardLitterCleared = 0;
  private yardCleaned = false;
  private readonly greenSurfaces: THREE.MeshStandardMaterial[] = [];
  private readonly saplings: Array<{ object: THREE.Group; revealAt: number; grown: number }> = [];
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
  private shownRecycled = -1;
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

    this.input = new MovementInput(
      this.requireElement('joystick-zone'),
      this.requireElement('joystick-base'),
      this.requireElement('joystick-knob'),
    );

    this.coinFlow = new CoinFlow(this.scene);
    this.questMarker = new QuestMarker(this.scene);
    // The line runs from the desk out towards the entrance.
    this.customerQueue = new CustomerQueue(
      this.scene,
      QUEUE_HEAD.clone(),
      new THREE.Vector3(0, 0, 1),
    );

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

    this.createExpansionPreviews();

    // No ring road around the plot. One service road runs from the factory
    // door out to the edge of the map - the way lorries will come and go.
    const roadStart = YARD_REACH;
    const roadLength = WORLD_REACH - roadStart;

    const road = this.createBox(ROAD_WIDTH, 0.14, roadLength, COLORS.road);
    road.position.set(0, LAYER.road - 0.07, roadStart + roadLength / 2);
    road.receiveShadow = true;
    this.scene.add(road);

    for (let index = 0; index < 5; index += 1) {
      const marking = this.createBox(0.3, 0.04, 1.3, COLORS.white);
      marking.position.set(0, LAYER.marking - 0.02, roadStart + 1.6 + index * (roadLength / 5));
      this.scene.add(marking);
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
  }

  private createExpansionPreviews(): void {
    const previews: Array<{ x: number; z: number; width: number; depth: number }> = [
      { x: -16.8, z: 0, width: 6.2, depth: 10 },
      { x: 16.8, z: 0, width: 6.2, depth: 10 },
      { x: 0, z: -17, width: 11, depth: 5.8 },
    ];

    for (const preview of previews) {
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(preview.width, 0.08, preview.depth),
        new THREE.MeshStandardMaterial({
          color: 0xb8c6a2,
          transparent: true,
          opacity: 0.72,
          flatShading: true,
        }),
      );
      base.position.set(preview.x, LAYER.patch, preview.z);
      base.receiveShadow = true;
      this.scene.add(base);

      const borderColor = 0x6d805f;
      for (const [x, z, width, depth] of [
        [preview.x, preview.z - preview.depth / 2, preview.width, 0.16],
        [preview.x, preview.z + preview.depth / 2, preview.width, 0.16],
        [preview.x - preview.width / 2, preview.z, 0.16, preview.depth],
        [preview.x + preview.width / 2, preview.z, 0.16, preview.depth],
      ] as Array<[number, number, number, number]>) {
        const border = this.createBox(width, 0.12, depth, borderColor);
        border.position.set(x, LAYER.patch + 0.08, z);
        border.receiveShadow = true;
        this.scene.add(border);
      }

      const lock = this.createBox(0.8, 0.55, 0.18, 0x506149);
      lock.position.set(preview.x, 0.42, preview.z);
      lock.castShadow = true;
      this.scene.add(lock);

      const shackle = new THREE.Mesh(
        new THREE.TorusGeometry(0.34, 0.06, 6, 14, Math.PI),
        new THREE.MeshStandardMaterial({ color: 0x506149, flatShading: true }),
      );
      shackle.position.set(preview.x, 0.78, preview.z - 0.03);
      shackle.rotation.x = Math.PI / 2;
      shackle.castShadow = true;
      this.scene.add(shackle);
    }
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
      [-7, -6], [6, -7], [-2, -2], [7, 2], [-8, 4], [3, 8], [-5, 9], [8, -2],
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
    this.player.position.set(5, 0.05, 8.5);
    this.scene.add(this.player);

    this.carriedStack = new CarriedStack({
      owner: this.player,
      world: this.scene,
      // Carried items are built by the same function the world objects use, so
      // what the player holds is exactly what they picked up off the ground.
      createVisual: (kind) => {
        const visual =
          isBale(kind)
            ? this.createBaleMesh(kind)
            : this.createWasteObject(kind as WasteKind, false);
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
      radius: BUILD_PAD_RADIUS,
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
    const doorHalf = 2.4;

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
    if (stage.id === 'counter') return this.createCounter(stage.position);
    if (stage.workerRole) return this.createWorker(stage.position, stage.workerRole);
    return this.createBaler(stage.position, stage.kind ?? 'plastic');
  }

  private createCounter(position: THREE.Vector3): THREE.Group {
    const group = new THREE.Group();
    group.position.copy(position);

    const top = this.createBox(3.2, 0.22, 1.2, 0xc99a5c);
    top.position.y = 1.05;
    group.add(top);

    const front = this.createBox(3.2, 1.0, 0.25, 0x9c6f3c);
    front.position.set(0, 0.5, 0.48);
    group.add(front);

    for (const x of [-1.4, 1.4]) {
      const leg = this.createBox(0.22, 1.0, 0.9, 0x8a5f31);
      leg.position.set(x, 0.5, -0.1);
      group.add(leg);
    }

    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    this.customerQueue.enabled = true;
    this.syncCustomerWasteKinds();
    this.counterStockGroup.position.copy(COUNTER_STOCK_POINT);
    if (!this.counterStockGroup.parent) this.scene.add(this.counterStockGroup);
    this.redrawCounterStock();
    return group;
  }

  private createBaler(position: THREE.Vector3, kind: WasteKind): THREE.Group {
    const group = new THREE.Group();
    group.position.copy(position);
    const color = kind === 'plastic' ? COLORS.plastic : COLORS.metal;

    const base = this.createBox(2.6, 0.5, 2.4, 0x40545a);
    base.position.y = 0.25;
    group.add(base);

    const body = this.createBox(2.1, 1.9, 1.9, color);
    body.position.y = 1.45;
    group.add(body);

    const piston = this.createBox(1.5, 0.36, 1.4, 0x26373d);
    piston.position.y = 2.6;
    group.add(piston);

    const door = this.createBox(1.4, 0.24, 0.18, 0x26373d);
    door.position.set(0, 0.8, 1.04);
    group.add(door);

    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    const display = this.createMachineDisplay();
    display.sprite.position.set(0, 3.35, 0.2);
    group.add(display.sprite);

    const outputStack = new THREE.Group();
    outputStack.position.set(0, 0.18, 1.92);
    group.add(outputStack);

    this.machines.push({
      position: position.clone(),
      workPoint: position.clone(),
      outputPoint: position.clone().add(new THREE.Vector3(0, 0, 1.92)),
      kind,
      stock: 0,
      bales: 0,
      shownBales: -1,
      timer: 0,
      piston,
      outputStack,
      display,
    });
    this.syncCustomerWasteKinds();

    return group;
  }

  private createWorker(position: THREE.Vector3, role: WorkerRole): THREE.Group {
    const group = new THREE.Group();
    group.position.copy(position);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 18),
      new THREE.MeshBasicMaterial({ color: 0x17351e, transparent: true, opacity: 0.16 }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    group.add(shadow);

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.28, 0.62, 4, 10),
      new THREE.MeshStandardMaterial({ color: 0x8d9490, flatShading: true }),
    );
    body.position.y = 0.78;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xd7b28a, flatShading: true }),
    );
    head.position.y = 1.32;
    head.castShadow = true;
    group.add(head);

    const cap = this.createBox(0.58, 0.14, 0.46, 0x4fc36b);
    cap.position.y = 1.58;
    cap.castShadow = true;
    group.add(cap);

    const badge = this.createBox(0.22, 0.08, 0.08, 0xf4f0d0);
    badge.position.set(0, 0.95, 0.29);
    badge.castShadow = true;
    group.add(badge);

    group.rotation.y = Math.PI;

    this.workers.push({
      group,
      role,
      home: position.clone(),
      target: position.clone(),
      state: 'idle',
      wait: 0,
      carryKinds: [],
      carryVisuals: [],
    });

    return group;
  }

  private createMachineDisplay(): MachineDisplay {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2.1, 2.1, 1);
    sprite.visible = false;

    return { sprite, texture, context, lastKey: '' };
  }

  private createBaleMesh(kind: BaleKind | WasteKind = 'plastic'): THREE.Group {
    const bale = new THREE.Group();
    const color = kind.startsWith('metal') ? 0xd9805b : 0x5fa9d8;

    const block = this.createBox(0.44, 0.3, 0.34, color);
    bale.add(block);

    for (const x of [-0.12, 0.12]) {
      const strap = this.createBox(0.05, 0.32, 0.36, 0xf4f0d0);
      strap.position.x = x;
      bale.add(strap);
    }

    return bale;
  }

  private syncCustomerWasteKinds(): void {
    const allowed: WasteKind[] = this.machines.some((machine) => machine.kind === 'metal')
      ? ['plastic', 'metal']
      : ['plastic'];
    this.customerQueue.setAllowedKinds(allowed);
  }

  private addCounterStock(kind: WasteKind): boolean {
    if (this.counterStock[kind] >= COUNTER_STOCK_CAP_PER_KIND) return false;

    this.counterStock[kind] += 1;
    this.redrawCounterStock();
    return true;
  }

  private takeCounterStock(kind?: WasteKind): WasteKind | null {
    const selected =
      kind ??
      (this.counterStock.plastic > 0 ? 'plastic' : this.counterStock.metal > 0 ? 'metal' : null);
    if (!selected || this.counterStock[selected] <= 0) return null;

    this.counterStock[selected] -= 1;
    this.redrawCounterStock();
    return selected;
  }

  private takeCounterStockBatch(kind: WasteKind, maxCount: number): WasteKind[] {
    const count = Math.min(this.counterStock[kind], maxCount);
    if (count <= 0) return [];

    this.counterStock[kind] -= count;
    this.redrawCounterStock();
    return Array.from({ length: count }, () => kind);
  }

  private redrawCounterStock(): void {
    const key = `${this.counterStock.plastic}:${this.counterStock.metal}`;
    if (key === this.shownCounterStockKey) return;
    this.shownCounterStockKey = key;

    for (const child of [...this.counterStockGroup.children]) {
      this.counterStockGroup.remove(child);
      disposeObject(child);
    }
    this.counterStockGroup.clear();

    const addKind = (kind: WasteKind, startX: number, count: number) => {
      const visible = Math.min(count, COUNTER_STOCK_CAP_PER_KIND);
      for (let index = 0; index < visible; index += 1) {
        const object = this.createWasteObject(kind, false);
        object.scale.setScalar(0.7);
        const column = index % 2;
        const row = Math.floor(index / 2);
        object.position.set(startX + column * 0.24, row * 0.11, -0.36 + row * 0.17);
        object.rotation.y = Math.PI / 2;
        object.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        this.counterStockGroup.add(object);
      }
    };

    addKind('plastic', -0.9, this.counterStock.plastic);
    addKind('metal', 0.38, this.counterStock.metal);
  }

  private updateMachines(delta: number): void {
    for (const machine of this.machines) {
      if (machine.timer > 0) {
        machine.timer -= delta;
        const progress = 1 - Math.max(0, machine.timer) / BALE_SECONDS;
        machine.piston.position.y = 2.6 - Math.sin(progress * Math.PI) * 0.7;

        if (machine.timer <= 0) {
          machine.bales += 1;
          machine.piston.position.y = 2.6;
        }
      } else if (machine.stock >= BALE_INPUT) {
        // Never blocks: it presses whatever is waiting, however many bales are
        // already stacked up on the far side.
        machine.stock -= BALE_INPUT;
        machine.timer = BALE_SECONDS;
      }

      this.redrawMachineStack(machine);
      this.redrawMachineDisplay(machine);
    }
  }

  private redrawMachineDisplay(machine: Machine): void {
    const progress = machine.timer > 0 ? 1 - machine.timer / BALE_SECONDS : 0;
    const seconds = machine.timer > 0 ? Math.ceil(machine.timer) : 0;
    const queuedJobs = Math.floor(machine.stock / BALE_INPUT);
    const active = machine.timer > 0 || queuedJobs > 0;
    machine.display.sprite.visible = active;

    const key = active ? `${progress.toFixed(2)}:${seconds}:${queuedJobs}` : 'hidden';
    if (key === machine.display.lastKey) return;
    machine.display.lastKey = key;

    const context = machine.display.context;
    if (!context) return;

    const size = 256;
    const centre = size / 2;
    context.clearRect(0, 0, size, size);
    if (!active) {
      machine.display.texture.needsUpdate = true;
      return;
    }

    context.beginPath();
    context.arc(centre, centre, 92, 0, Math.PI * 2);
    context.fillStyle = 'rgba(14, 42, 24, 0.45)';
    context.fill();

    context.lineWidth = 22;
    context.lineCap = 'round';
    context.beginPath();
    context.arc(centre, centre, 76, 0, Math.PI * 2);
    context.strokeStyle = 'rgba(236, 255, 233, 0.72)';
    context.stroke();

    if (progress > 0) {
      context.beginPath();
      context.arc(centre, centre, 76, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      context.strokeStyle = '#4fc36b';
      context.stroke();
    }

    context.beginPath();
    context.arc(centre, centre, 52, 0, Math.PI * 2);
    context.fillStyle = 'rgba(245, 255, 242, 0.95)';
    context.fill();

    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#17351e';
    context.font = '900 44px system-ui, -apple-system, Segoe UI, sans-serif';
    context.fillText(seconds > 0 ? `${seconds}s` : '', centre, centre + 3, 94);

    if (queuedJobs > 0) {
      context.beginPath();
      context.arc(190, 66, 30, 0, Math.PI * 2);
      context.fillStyle = '#4fc36b';
      context.fill();
      context.lineWidth = 6;
      context.strokeStyle = 'rgba(245, 255, 242, 0.95)';
      context.stroke();

      context.fillStyle = '#17351e';
      context.font = '900 28px system-ui, -apple-system, Segoe UI, sans-serif';
      context.fillText(String(queuedJobs), 190, 66, 42);
    }

    machine.display.texture.needsUpdate = true;
  }

  private redrawMachineStack(machine: Machine): void {
    const visibleBales = Math.min(machine.bales, 12);
    if (visibleBales === machine.shownBales) return;
    machine.shownBales = visibleBales;

    for (const child of [...machine.outputStack.children]) {
      machine.outputStack.remove(child);
      disposeObject(child);
    }
    machine.outputStack.clear();

    for (let index = 0; index < visibleBales; index += 1) {
      const bale = this.createBaleMesh(machine.kind);
      const column = index % 4;
      const row = Math.floor(index / 4);
      bale.position.set((column - 1.5) * 0.48, row * 0.34, 0);
      bale.rotation.y = (column % 2 === 0 ? -0.08 : 0.08);
      bale.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      machine.outputStack.add(bale);
    }
  }

  private updateWorkers(delta: number): void {
    for (const worker of this.workers) {
      if (worker.role === 'counter') {
        this.updateCounterWorker(worker, delta);
      } else {
        this.updatePorterWorker(worker, delta);
      }
    }
  }

  private updateCounterWorker(worker: FactoryWorker, delta: number): void {
    const customer = this.customerQueue.servable;
    const canServeCustomer =
      customer !== null && this.counterStock[customer.kind] < COUNTER_STOCK_CAP_PER_KIND;

    if (canServeCustomer) {
      worker.target.copy(COUNTER_WORKER_POINT);
      worker.state = worker.group.position.distanceToSquared(worker.target) > 0.08 ? 'to-counter' : 'serving';
    } else {
      worker.target.copy(worker.home);
      worker.state = 'idle';
    }

    const arrived = this.moveWorker(worker, delta);
    if (!arrived || worker.state !== 'serving') return;

    worker.wait -= delta;
    if (worker.wait > 0) return;
    worker.wait = 0.48;

    const nextCustomer = this.customerQueue.servable;
    if (!nextCustomer || this.counterStock[nextCustomer.kind] >= COUNTER_STOCK_CAP_PER_KIND) return;

    const { kind } = this.customerQueue.takeItem(nextCustomer);
    if (this.addCounterStock(kind)) {
      this.servedCount += 1;
    }
  }

  private updatePorterWorker(worker: FactoryWorker, delta: number): void {
    if (worker.carryKinds.length === 0) {
      const stockJob = this.findPorterStockJob();
      if (stockJob) {
        worker.target.copy(COUNTER_STOCK_SERVICE);
        worker.state = 'idle';
        if (this.moveWorker(worker, delta, WORKER_SERVICE_RANGE)) {
          const taken = this.takeCounterStockBatch(stockJob.kind, WORKER_CARRY_CAPACITY);
          if (taken.length > 0) {
            for (const kind of taken) this.attachWorkerCarry(worker, kind);
            worker.target.copy(stockJob.machine.workPoint);
            worker.state = 'to-machine';
          }
        }
        return;
      }

      const baleJob = this.findPorterBaleJob();
      if (baleJob) {
        worker.target.copy(baleJob.machine.outputPoint);
        worker.state = 'to-machine';
        if (this.moveWorker(worker, delta, WORKER_SERVICE_RANGE)) {
          const count = Math.min(baleJob.machine.bales, WORKER_CARRY_CAPACITY);
          baleJob.machine.bales -= count;
          this.redrawMachineStack(baleJob.machine);
          for (let index = 0; index < count; index += 1) {
            this.attachWorkerCarry(worker, `${baleJob.machine.kind}-bale`);
          }
          worker.target.copy(baleJob.bin.position);
          worker.state = 'to-bin';
        }
        return;
      }

      worker.target.copy(worker.home);
      worker.state = 'idle';
      this.moveWorker(worker, delta);
      return;
    }

    const first = worker.carryKinds[0];
    if (isBale(first)) {
      const bin = this.bins[0];
      worker.target.copy(bin.position);
      worker.state = 'to-bin';
      if (this.moveWorker(worker, delta, WORKER_SERVICE_RANGE)) {
        const delivered = [...worker.carryKinds];
        this.detachWorkerCarry(worker);
        for (const kind of delivered) {
          const value = this.valueOf(kind);
          this.money += value;
          this.recycledCount += 1;
          this.balesSold += 1;
        }
        this.coinFlow.emitToHud(bin.mouth, this.camera);
        worker.wait = 0.18;
      }
      return;
    }

    const machine = this.machines.find((item) => item.kind === first);
    if (!machine) {
      this.detachWorkerCarry(worker);
      worker.target.copy(worker.home);
      worker.state = 'idle';
      return;
    }

    worker.target.copy(machine.workPoint);
    worker.state = 'to-machine';
    if (this.moveWorker(worker, delta, WORKER_SERVICE_RANGE)) {
      machine.stock += worker.carryKinds.length;
      this.detachWorkerCarry(worker);
      worker.wait = 0.18;
    }
  }

  private findPorterStockJob(): { kind: WasteKind; machine: Machine } | null {
    for (const machine of this.machines) {
      if (this.counterStock[machine.kind] > 0) {
        return { kind: machine.kind, machine };
      }
    }

    return null;
  }

  private findPorterBaleJob(): { machine: Machine; bin: RecycleBin } | null {
    const bin = this.bins[0];
    if (!bin) return null;

    const machine = this.machines.find((item) => item.bales > 0);
    return machine ? { machine, bin } : null;
  }

  private moveWorker(worker: FactoryWorker, delta: number, reach = 0.08): boolean {
    const toTarget = worker.target.clone().sub(worker.group.position);
    toTarget.y = 0;
    const distance = toTarget.length();

    if (distance <= reach) {
      worker.group.position.y = 0;
      return true;
    }

    const direction = toTarget.normalize();
    worker.group.position.addScaledVector(direction, Math.min(3.2 * delta, distance));
    worker.group.rotation.y = Math.atan2(direction.x, direction.z);
    worker.group.position.y = Math.sin(this.elapsed * 11) * 0.035;
    return false;
  }

  private attachWorkerCarry(worker: FactoryWorker, kind: CarriedKind): void {
    const visual = isBale(kind) ? this.createBaleMesh(kind) : this.createWasteObject(kind, false);
    visual.scale.setScalar(isBale(kind) ? 0.78 : 0.68);
    const index = worker.carryKinds.length;
    visual.position.set((index % 3 - 1) * 0.22, 1.42 + Math.floor(index / 3) * 0.22, 0.3);
    visual.rotation.y = Math.PI / 2;
    worker.group.add(visual);
    worker.carryKinds.push(kind);
    worker.carryVisuals.push(visual);
  }

  private detachWorkerCarry(worker: FactoryWorker): void {
    for (const visual of worker.carryVisuals) {
      worker.group.remove(visual);
      disposeObject(visual);
    }
    worker.carryKinds = [];
    worker.carryVisuals = [];
  }

  /**
   * Each finished building makes what the player banks worth more. The physical
   * per-machine logistics chain comes later; for now the plant's value shows up
   * in the payout.
   */
  private valueOf(kind: CarriedKind): number {
    // A bale is worth far more than the loose waste that went into it, which is
    // the whole reason to bother with the machine.
    return isBale(kind) ? BALE_VALUE : BASE_VALUE[kind];
  }

  // --- Quests ------------------------------------------------------------

  private createQuests(): void {
    const nearestWaste = (kind?: WasteKind): THREE.Vector3 | null => {
      let best: THREE.Vector3 | null = null;
      let bestDistance = Infinity;

      for (const waste of this.wastes) {
        if (!waste.active) continue;
        if (kind !== undefined && waste.kind !== kind) continue;
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

    const machineForCarriedWaste = (): THREE.Vector3 | null =>
      this.machines.find((machine) => this.carriedStack.has(machine.kind))?.workPoint ?? null;

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
        id: 'build-counter',
        text: 'Müşteri tezgahını kur',
        goal: 1,
        progress: () => (this.builtStages.has('counter') ? 1 : 0),
        target: buildPadTarget,
        reward: 0,
      },
      {
        id: 'serve-customers',
        text: 'Tezgaha geç ve müşterilerden 5 atık al',
        goal: 5,
        progress: () => this.servedCount,
        target: () => COUNTER_SERVICE,
        reward: 80,
      },
      {
        id: 'build-baler',
        text: 'Plastik balya makinesini kur',
        goal: 1,
        progress: () => (this.builtStages.has('baler-1') ? 1 : 0),
        target: buildPadTarget,
        reward: 0,
      },
      {
        id: 'feed-baler',
        text: 'Plastik atıkları makineye boşalt ve ilk balyanı üret',
        goal: 1,
        progress: () => this.baledCount,
        target: () =>
          this.carriedStack.has('plastic') ? this.machines[0]?.workPoint ?? null : nearestWaste('plastic'),
        reward: 0,
      },
      {
        id: 'sell-bale',
        text: 'Balyayı geri dönüşüm kutusuna götür',
        goal: 1,
        progress: () => this.balesSold,
        target: nearestBin,
        reward: 0,
      },
      {
        id: 'sell-more-bales',
        text: 'Balya üretmeye devam et: 3 balya sat',
        goal: 3,
        progress: () => this.balesSold,
        target: () =>
          this.carriedStack.isEmpty ? nearestWaste('plastic') : machineForCarriedWaste() ?? nearestBin(),
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
        id: 'hire-worker',
        text: 'Tezgah çalışanını al',
        goal: 1,
        progress: () => (this.builtStages.has('worker-1') ? 1 : 0),
        target: buildPadTarget,
        reward: 0,
      },
      {
        id: 'hire-porter',
        text: 'Taşıyıcı çalışanı al',
        goal: 1,
        progress: () => (this.builtStages.has('worker-2') ? 1 : 0),
        target: buildPadTarget,
        reward: 0,
      },
      {
        id: 'build-metal-baler',
        text: 'Metal atıklar için ayrı makine kur',
        goal: 1,
        progress: () => (this.builtStages.has('baler-2') ? 1 : 0),
        target: buildPadTarget,
        reward: 0,
      },
      {
        id: 'green-quarter',
        text: 'Bölgenin dörtte birini yeşert',
        goal: 25,
        progress: () => Math.floor(this.greenLevel * 100),
        target: () => (this.carriedStack.isEmpty ? nearestWaste() : nearestBin()),
        reward: 250,
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

  private carryingBale(): boolean {
    return this.carriedStack.kinds.some((kind) => isBale(kind));
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

  private isUpgradeRevealed(definition: UpgradeDefinition): boolean {
    return this.recycledCount >= definition.revealAfter;
  }

  private refreshUpgradePanel(): void {
    for (const definition of UPGRADES) {
      const row = this.upgradeList.querySelector<HTMLElement>(
        `[data-upgrade="${definition.id}"]`,
      );
      if (!row) continue;

      // Upgrades appear one at a time rather than all at once on first open.
      row.hidden = !this.isUpgradeRevealed(definition);
      if (row.hidden) continue;

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

    // The whole panel stays out of the way until there is something in it.
    const revealed = UPGRADES.filter((definition) => this.isUpgradeRevealed(definition));
    const anyAffordable = revealed.some((definition) => {
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
    this.customerQueue.update(delta);
    this.updateWorkers(delta);
    this.updateMachines(delta);
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

    // Take accumulated waste from the counter stockpile once a worker starts
    // keeping the table supplied.
    if (
      this.carriedStack.count < this.carryCapacity &&
      !this.carryingBale() &&
      COUNTER_STOCK_SERVICE.distanceToSquared(this.player.position) < 2.4
    ) {
      const kind = this.takeCounterStock();
      if (kind) {
        this.carriedStack.add(kind, COUNTER_STOCK_POINT);
        this.characterAnimator.playPickup();
        this.interactionCooldown = 0.14;
        return;
      }
    }

    // Take a bag off the customer at the head of the queue.
    if (
      this.carriedStack.count < this.carryCapacity &&
      !this.carryingBale() &&
      COUNTER_SERVICE.distanceToSquared(this.player.position) < 2.1
    ) {
      const customer = this.customerQueue.servable;
      if (customer) {
        const { kind, from } = this.customerQueue.takeItem(customer);
        this.carriedStack.add(kind, from);
        this.characterAnimator.playPickup();
        this.collectedCount += 1;
        this.servedCount += 1;
        this.interactionCooldown = 0.18;
        return;
      }
    }

    // Tip loose waste into a baler's input.
    const feeding = this.machines.find(
      (machine) =>
        machine.workPoint.distanceToSquared(this.player.position) < 5.8 &&
        this.carriedStack.has(machine.kind),
    );

    if (feeding) {
      this.carriedStack.takeOne(
        feeding.workPoint.clone().setY(1.45),
        () => {
          feeding.stock += 1;
        },
        feeding.kind,
      );
      this.characterAnimator.playDrop();
      this.interactionCooldown = 0.14;
      return;
    }

    // Take a finished bale off a baler's output.
    const collecting = this.machines.find(
      (machine) => machine.bales > 0 && machine.workPoint.distanceToSquared(this.player.position) < 5.8,
    );

    if (collecting && this.carriedStack.count < this.carryCapacity) {
      collecting.bales -= 1;
      this.redrawMachineStack(collecting);
      this.carriedStack.add(`${collecting.kind}-bale`, collecting.outputPoint.clone().setY(1.25));
      this.characterAnimator.playPickup();
      this.baledCount += 1;
      this.interactionCooldown = 0.16;
      return;
    }

    const bin = this.bins.find(
      (candidate) => candidate.position.distanceToSquared(this.player.position) < 4.6,
    );

    if (bin && !this.carriedStack.isEmpty) {
      this.carriedStack.takeOne(bin.mouth, (kind) => {
        // Paid when the item actually lands in the bin, not on contact.
        const value = this.valueOf(kind as CarriedKind);
        this.money += value;
        this.recycledCount += 1;
        if (isBale(kind)) this.balesSold += 1;
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
      // Spend quickly once the player commits to the pad; the fill should feel
      // like money flowing, not like a timer gate.
      const rate = Math.max(32, pad.cost / 1.45);
      const spent = pad.contribute(Math.min(rate * delta, this.money));
      this.money -= spent;

      // A steady stream of notes from the player to the pad while it fills.
      if (spent > 0) {
        this.coinTimer += delta;
        while (this.coinTimer >= 0.045) {
          this.coinTimer -= 0.045;
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
    // Recycling is what reveals new upgrades, so it refreshes the rows too.
    if (shownMoney !== this.shownMoney || this.recycledCount !== this.shownRecycled) {
      this.shownMoney = shownMoney;
      this.shownRecycled = this.recycledCount;
      this.refreshUpgradePanel();
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

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const item of materials) item.dispose();
  });
}
