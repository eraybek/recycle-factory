import * as THREE from 'three';
import { MovementInput } from '../input/MovementInput';
import { PurchaseZone } from './PurchaseZone';
import { CarriedStack } from './CarriedStack';
import { buildHypercasualCharacter, carrySlot, type CharacterAnimator } from './HypercasualCharacter';

type WasteKind = 'plastic' | 'metal';

interface WasteItem {
  object: THREE.Group;
  kind: WasteKind;
  parcel: Parcel;
  active: boolean;
  respawnAt: number;
}

interface Parcel {
  col: number;
  row: number;
  centre: THREE.Vector3;
  unlocked: boolean;
  cost: number;
  ground: THREE.Mesh;
  /** Fence and tint shown while the parcel is still locked. */
  locked: THREE.Group;
  pad: PurchaseZone | null;
}

const COLORS = {
  base: 0xe8d7b5,
  field: 0x98cf7a,
  fieldAlt: 0x8ec472,
  lockedField: 0x7f9a75,
  fence: 0xb4772f,
  plastic: 0x4db5f0,
  metal: 0xd9805b,
  white: 0xf7f4e8,
};

/** Side length of one grid parcel. */
const PARCEL_SIZE = 15;
const HALF_PARCEL = PARCEL_SIZE / 2;
/** Keeps the character's body from clipping through a locked border. */
const PLAYER_RADIUS = 0.45;
const WASTE_PER_PARCEL = 18;
const WASTE_RESPAWN_SECONDS = 12;

const WASTE_VALUE: Record<WasteKind, number> = {
  plastic: 6,
  metal: 9,
};

/** Unlock prices, cheapest first, handed out in ring order around the base. */
const PARCEL_COSTS = [80, 160, 280, 440, 640, 880, 1160, 1480];

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
 * ground; the ground is reserved for physical purchases like opening a parcel.
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
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly clock = new THREE.Clock();
  private readonly input: MovementInput;
  private readonly player = new THREE.Group();
  private carriedStack!: CarriedStack;
  private characterAnimator!: CharacterAnimator;
  private readonly wastes: WasteItem[] = [];
  private readonly parcels: Parcel[] = [];
  private readonly purchaseZones: PurchaseZone[] = [];
  private readonly cameraLookTarget = new THREE.Vector3();
  private readonly cameraDesired = new THREE.Vector3();
  /** Only used at ground level: the map view sits far beyond its far plane. */
  private readonly groundFog = new THREE.Fog(0xd8f0c8, 40, 90);
  private readonly recyclePosition = new THREE.Vector3(0, 0, -3.2);
  private readonly recycleMouth = new THREE.Vector3(0, 1.5, -3.2);
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
    this.createParcels();
    this.createWorldBoundary();
    this.createBase();
    this.createWasteField();
    this.refreshParcelPads();
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

  private createParcels(): void {
    // Ring order around the base: the four edges first, then the corners, so
    // the cheapest parcels are always the ones sharing a full border.
    const order: Array<[number, number]> = [
      [1, 0], [2, 1], [1, 2], [0, 1],
      [0, 0], [2, 0], [2, 2], [0, 2],
    ];

    for (const [col, row] of [[1, 1] as [number, number], ...order]) {
      const isBase = col === 1 && row === 1;
      const centre = new THREE.Vector3(
        (col - 1) * PARCEL_SIZE,
        0,
        (row - 1) * PARCEL_SIZE,
      );

      const ground = new THREE.Mesh(
        new THREE.BoxGeometry(PARCEL_SIZE, 0.3, PARCEL_SIZE),
        new THREE.MeshStandardMaterial({
          color: isBase ? COLORS.base : COLORS.lockedField,
          flatShading: true,
        }),
      );
      ground.position.copy(centre).setY(-0.15);
      ground.receiveShadow = true;
      this.scene.add(ground);

      const locked = new THREE.Group();
      if (!isBase) {
        this.buildFence(locked, centre);
        this.scene.add(locked);
      }

      const index = order.findIndex(([c, r]) => c === col && r === row);
      const parcel: Parcel = {
        col,
        row,
        centre,
        unlocked: isBase,
        cost: isBase ? 0 : PARCEL_COSTS[index],
        ground,
        locked,
        pad: null,
      };

      if (!isBase) {
        parcel.pad = new PurchaseZone({
          id: `parcel:${col}:${row}`,
          title: 'Yeni Alan',
          cost: parcel.cost,
          position: centre.clone(),
          radius: 1.15,
        });
        parcel.pad.group.visible = false;
        this.scene.add(parcel.pad.group);
        this.purchaseZones.push(parcel.pad);
      }

      this.parcels.push(parcel);
    }
  }

  /**
   * Permanent fence around the whole grid. A parcel's own fence disappears when
   * it is bought, so without this its outer edge would become an invisible wall.
   */
  private createWorldBoundary(): void {
    const span = PARCEL_SIZE * 3;
    const reach = span / 2;
    const material = new THREE.MeshStandardMaterial({
      color: COLORS.fence,
      flatShading: true,
    });

    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(dx !== 0 ? 0.3 : span, 0.7, dz !== 0 ? 0.3 : span),
        material,
      );
      rail.position.set(dx * reach, 0.5, dz * reach);
      rail.castShadow = true;
      rail.receiveShadow = true;
      this.scene.add(rail);
    }
  }

  private buildFence(target: THREE.Group, centre: THREE.Vector3): void {
    const material = new THREE.MeshStandardMaterial({
      color: COLORS.fence,
      flatShading: true,
    });

    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(
          dx !== 0 ? 0.25 : PARCEL_SIZE,
          0.55,
          dz !== 0 ? 0.25 : PARCEL_SIZE,
        ),
        material,
      );
      rail.position.set(
        centre.x + dx * HALF_PARCEL,
        0.45,
        centre.z + dz * HALF_PARCEL,
      );
      rail.castShadow = true;
      target.add(rail);
    }
  }

  private createBase(): void {
    // The recycling box: everything the player collects turns into money here.
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

    // Flat marker so the drop-off reads from a distance.
    const marker = new THREE.Mesh(
      new THREE.CircleGeometry(2.3, 40),
      new THREE.MeshBasicMaterial({ color: 0x63c97c, transparent: true, opacity: 0.55 }),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(this.recyclePosition.x, 0.02, this.recyclePosition.z + 1.7);
    this.scene.add(marker);

    for (const [x, z] of [[-6, -6], [6, -6], [-6, 6], [6, 6]] as Array<[number, number]>) {
      const tree = this.createTree();
      tree.position.set(x, 0, z);
      this.scene.add(tree);
    }
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
    for (const parcel of this.parcels) {
      for (let index = 0; index < WASTE_PER_PARCEL; index += 1) {
        const kind: WasteKind = index % 2 === 0 ? 'plastic' : 'metal';
        const object = this.createWasteObject(kind);
        const waste: WasteItem = { object, kind, parcel, active: true, respawnAt: 0 };
        this.placeWaste(waste);
        object.visible = parcel.unlocked;
        this.scene.add(object);
        this.wastes.push(waste);
      }
    }
  }

  private placeWaste(waste: WasteItem): void {
    const inset = HALF_PARCEL - 1.6;
    waste.object.position.set(
      waste.parcel.centre.x + THREE.MathUtils.randFloat(-inset, inset),
      0.12,
      waste.parcel.centre.z + THREE.MathUtils.randFloat(-inset, inset),
    );
    waste.object.rotation.y = Math.random() * Math.PI * 2;

    // Keep the base parcel's clutter away from the recycling box and the pads.
    if (waste.parcel.unlocked && waste.parcel.col === 1 && waste.parcel.row === 1) {
      while (waste.object.position.distanceTo(this.recyclePosition) < 4) {
        waste.object.position.x += 1.2;
      }
    }
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
    this.player.position.set(0, 0.05, 4.5);
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

  // --- Parcels -----------------------------------------------------------

  private parcelAt(col: number, row: number): Parcel | undefined {
    return this.parcels.find((parcel) => parcel.col === col && parcel.row === row);
  }

  /**
   * A locked parcel can only be bought from a parcel that already shares a full
   * border with it, so its pad is parked on that border - and stays hidden
   * until such a neighbour exists. Corner parcels therefore wait for one of
   * their edge neighbours, which is also what keeps them walkable: the player
   * can never squeeze through a bare corner.
   */
  private refreshParcelPads(): void {
    for (const parcel of this.parcels) {
      if (parcel.unlocked || !parcel.pad) continue;

      const neighbours: Array<[number, number]> = [
        [parcel.col + 1, parcel.row],
        [parcel.col - 1, parcel.row],
        [parcel.col, parcel.row + 1],
        [parcel.col, parcel.row - 1],
      ];

      const open = neighbours
        .map(([col, row]) => this.parcelAt(col, row))
        .find((candidate) => candidate?.unlocked);

      if (!open) {
        parcel.pad.group.visible = false;
        continue;
      }

      const towardsParcel = parcel.centre.clone().sub(open.centre).normalize();
      parcel.pad.setPosition(
        open.centre.clone().addScaledVector(towardsParcel, HALF_PARCEL - 1.6).setY(0),
      );
      parcel.pad.group.visible = true;
    }
  }

  private unlockParcel(parcel: Parcel): void {
    parcel.unlocked = true;
    (parcel.ground.material as THREE.MeshStandardMaterial).color.setHex(
      (parcel.col + parcel.row) % 2 === 0 ? COLORS.field : COLORS.fieldAlt,
    );

    this.scene.remove(parcel.locked);
    parcel.locked.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });

    for (const waste of this.wastes) {
      if (waste.parcel !== parcel) continue;
      waste.active = true;
      waste.object.visible = true;
    }

    this.refreshParcelPads();
    this.showMessage('Yeni alan açıldı');
  }

  /** True when the point sits inside a parcel the player has already opened. */
  private isWalkable(x: number, z: number): boolean {
    return this.parcels.some(
      (parcel) =>
        parcel.unlocked &&
        Math.abs(x - parcel.centre.x) < HALF_PARCEL - PLAYER_RADIUS &&
        Math.abs(z - parcel.centre.z) < HALF_PARCEL - PLAYER_RADIUS,
    );
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
    this.updatePurchases(delta);
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

    // Resolved one axis at a time so the player slides along a locked border
    // instead of sticking to it.
    const step = this.moveSpeed * delta;
    const nextX = this.player.position.x + movement.x * step;
    if (this.isWalkable(nextX, this.player.position.z)) {
      this.player.position.x = nextX;
    }

    const nextZ = this.player.position.z + movement.z * step;
    if (this.isWalkable(this.player.position.x, nextZ)) {
      this.player.position.z = nextZ;
    }

    const targetRotation = Math.atan2(movement.x, movement.z);
    this.player.rotation.y = this.lerpAngle(this.player.rotation.y, targetRotation, 10 * delta);
    this.player.position.y = 0.05 + Math.sin(this.elapsed * 12) * 0.035;
  }

  private updateWasteRespawns(): void {
    for (const waste of this.wastes) {
      if (waste.active || !waste.parcel.unlocked || this.elapsed < waste.respawnAt) continue;
      waste.active = true;
      waste.object.visible = true;
      this.placeWaste(waste);
    }
  }

  private updateInteractions(): void {
    if (this.isMapView || this.isPanelOpen || this.interactionCooldown > 0) return;

    if (this.carriedStack.count < this.carryCapacity) {
      const nearby = this.wastes.find(
        (waste) =>
          waste.active &&
          waste.object.position.distanceToSquared(this.player.position) <
            this.pickupReach * this.pickupReach,
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
        const value = WASTE_VALUE[kind as WasteKind];
        this.money += value;
        this.showMessage(`+${value}`);
      });
      this.characterAnimator.playDrop();
      this.interactionCooldown = 0.16;
    }
  }

  private updatePurchases(delta: number): void {
    for (const zone of this.purchaseZones) {
      const inside =
        !this.isMapView &&
        zone.group.visible &&
        !zone.isComplete &&
        zone.contains(this.player.position);
      zone.setActive(inside);

      if (inside && this.money > 0) {
        // Spend over roughly two and a half seconds so the wait is readable but
        // never tedious, and never faster than the player can afford.
        const rate = Math.max(20, zone.cost / 2.5);
        const spent = zone.contribute(Math.min(rate * delta, this.money));
        this.money -= spent;

        if (zone.isComplete) this.applyPurchase(zone);
      }

      zone.update(delta);
    }
  }

  private applyPurchase(zone: PurchaseZone): void {
    if (!zone.id.startsWith('parcel:')) return;

    const [, col, row] = zone.id.split(':');
    const parcel = this.parcelAt(Number(col), Number(row));
    if (parcel) this.unlockParcel(parcel);
  }

  private updateCamera(delta: number): void {
    if (this.isMapView) {
      // Far enough back to frame the whole three-by-three grid.
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

    const nextParcel = this.parcels
      .filter((parcel) => !parcel.unlocked && parcel.pad?.group.visible)
      .sort((a, b) => a.cost - b.cost)[0];

    if (this.carriedStack.count >= this.carryCapacity) {
      this.objectiveElement.textContent = 'Çanta dolu — atıkları dönüşüm kutusuna boşalt';
    } else if (nextParcel && this.money >= nextParcel.cost) {
      this.objectiveElement.textContent = 'Yeşil alanda bekleyerek yeni bir saha aç';
    } else if (!this.carriedStack.isEmpty) {
      this.objectiveElement.textContent = 'Atıkları dönüşüm kutusuna götür';
    } else {
      this.objectiveElement.textContent = 'Yerdeki plastik ve metalleri topla';
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
