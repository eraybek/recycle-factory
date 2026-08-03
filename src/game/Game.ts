import * as THREE from 'three';
import { MovementInput } from '../input/MovementInput';
import { PurchaseZone } from './PurchaseZone';
import { CarriedStack } from './CarriedStack';
import { buildHypercasualCharacter, carrySlot, type CharacterAnimator } from './HypercasualCharacter';

type WasteKind = 'plastic' | 'metal';

type PressState = 'idle' | 'processing';

interface WasteItem {
  object: THREE.Group;
  kind: WasteKind;
  active: boolean;
  respawnAt: number;
}

interface PressStation {
  kind: WasteKind;
  stock: number;
  output: number;
  state: PressState;
  timer: number;
  group: THREE.Group;
  piston: THREE.Mesh;
  inputStack: THREE.Group;
  outputStack: THREE.Group;
  pickupPosition: THREE.Vector3;
}

interface CleanSpot {
  mesh: THREE.Mesh;
  progress: number;
  done: boolean;
}

const COLORS = {
  grass: 0x98cf7a,
  street: 0x6f7b82,
  sidewalk: 0xc8c2b5,
  factory: 0xe8d7b5,
  darkGreen: 0x245b34,
  player: 0xf0b44d,
  plastic: 0x4db5f0,
  metal: 0xd9805b,
  sale: 0xf3cf4f,
  white: 0xf7f4e8,
};

export class Game {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly clock = new THREE.Clock();
  private readonly input: MovementInput;
  private readonly player = new THREE.Group();
  private carriedStack!: CarriedStack;
  private characterAnimator!: CharacterAnimator;
  private readonly wastes: WasteItem[] = [];
  private readonly presses: PressStation[] = [];
  private readonly cleanSpots: CleanSpot[] = [];
  private readonly purchaseZones: PurchaseZone[] = [];
  private readonly cameraLookTarget = new THREE.Vector3();
  private readonly cameraDesired = new THREE.Vector3();
  private readonly sortingPosition = new THREE.Vector3(0, 0, 1.1);
  private readonly salePosition = new THREE.Vector3(0, 0, -8.2);
  private readonly processedCargo: Record<WasteKind, number> = {
    plastic: 0,
    metal: 0,
  };
  private readonly moneyElement: HTMLElement;
  private readonly bagElement: HTMLElement;
  private readonly objectiveElement: HTMLElement;
  private readonly statusElement: HTMLElement;
  private readonly mapButton: HTMLButtonElement;
  private money = 0;
  /** Tunables raised by the purchase zones. */
  private carryCapacity = 8;
  private moveSpeed = 4.6;
  private pressDuration = 2.6;
  private isMapView = false;
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

    this.input = new MovementInput(
      this.requireElement('joystick-zone'),
      this.requireElement('joystick-base'),
      this.requireElement('joystick-knob'),
    );

    this.configureScene();
    this.createWorld();
    this.createPlayer();
    this.createWasteField();
    this.bindEvents();
    this.resize();
    this.updateHud();
    this.renderer.setAnimationLoop(this.tick);
  }

  private configureScene(): void {
    this.scene.background = new THREE.Color(0xd8f0c8);
    this.scene.fog = new THREE.Fog(0xd8f0c8, 24, 48);

    const hemisphere = new THREE.HemisphereLight(0xffffff, 0x6d825a, 2.2);
    this.scene.add(hemisphere);

    const sun = new THREE.DirectionalLight(0xfff3d2, 3.2);
    sun.position.set(-8, 16, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(512, 512);
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    this.scene.add(sun);
  }

  private createWorld(): void {
    const grass = this.createBox(20, 0.3, 30, COLORS.grass);
    grass.position.set(0, -0.2, 2.5);
    grass.receiveShadow = true;
    this.scene.add(grass);

    const street = this.createBox(16, 0.12, 12, COLORS.street);
    street.position.set(0, 0, 10);
    street.receiveShadow = true;
    this.scene.add(street);

    const factoryFloor = this.createBox(16, 0.18, 12, COLORS.factory);
    factoryFloor.position.set(0, 0.02, -4);
    factoryFloor.receiveShadow = true;
    this.scene.add(factoryFloor);

    const sidewalk = this.createBox(16, 0.16, 2, COLORS.sidewalk);
    sidewalk.position.set(0, 0.08, 3);
    sidewalk.receiveShadow = true;
    this.scene.add(sidewalk);

    this.createRoadMarkings();
    this.createFactoryWalls();
    this.createDecorations();
    this.createSortingZone();
    this.presses.push(this.createPress('plastic', -3.2, -4));
    this.presses.push(this.createPress('metal', 3.2, -4));
    this.createSaleZone();
    this.createCleaningSpots();
    this.createPurchaseZones();
  }

  private createPurchaseZones(): void {
    const definitions = [
      {
        id: 'capacity',
        title: 'Taşıma Kapasitesi',
        cost: 60,
        position: new THREE.Vector3(-6.5, 0, -0.4),
        color: 0x4db5f0,
      },
      {
        id: 'press',
        title: 'Pres Hızı',
        cost: 150,
        position: new THREE.Vector3(-6.5, 0, -3.6),
        color: 0xd9805b,
      },
      {
        id: 'speed',
        title: 'Hareket Hızı',
        cost: 90,
        position: new THREE.Vector3(6.5, 0, -3.6),
        color: 0x4fc36b,
      },
    ];

    for (const definition of definitions) {
      const zone = new PurchaseZone(definition);
      this.purchaseZones.push(zone);
      this.scene.add(zone.group);
    }
  }

  private createRoadMarkings(): void {
    for (let index = 0; index < 5; index += 1) {
      const marking = this.createBox(0.3, 0.04, 1.3, COLORS.white);
      marking.position.set(0, 0.11, 5.5 + index * 2.2);
      this.scene.add(marking);
    }
  }

  private createFactoryWalls(): void {
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xf4ead4, flatShading: true });
    const wallGeometry = new THREE.BoxGeometry(0.35, 1.5, 12);

    const leftWall = new THREE.Mesh(wallGeometry, wallMaterial);
    leftWall.position.set(-8, 0.75, -4);
    leftWall.castShadow = true;
    leftWall.receiveShadow = true;
    this.scene.add(leftWall);

    const rightWall = leftWall.clone();
    rightWall.position.x = 8;
    this.scene.add(rightWall);

    const backWall = this.createBox(16, 1.5, 0.35, 0xf4ead4);
    backWall.position.set(0, 0.75, -10);
    backWall.castShadow = true;
    backWall.receiveShadow = true;
    this.scene.add(backWall);
  }

  private createDecorations(): void {
    for (const x of [-8.8, 8.8]) {
      for (const z of [-8, -2, 5, 11, 16]) {
        const trunk = this.createBox(0.35, 1.3, 0.35, 0x7b5635);
        trunk.position.set(x, 0.65, z);
        trunk.castShadow = true;
        this.scene.add(trunk);

        const crown = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1.15, 0),
          new THREE.MeshStandardMaterial({ color: 0x4f9b55, flatShading: true }),
        );
        crown.position.set(x, 1.8, z);
        crown.castShadow = true;
        this.scene.add(crown);
      }
    }

    const sign = this.createBox(4.8, 1.5, 0.25, COLORS.darkGreen);
    sign.position.set(0, 2.2, -9.7);
    sign.castShadow = true;
    this.scene.add(sign);
  }

  private createSortingZone(): void {
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(1.45, 1.45, 0.08, 32),
      new THREE.MeshStandardMaterial({ color: 0x58bd68, flatShading: true }),
    );
    ring.position.copy(this.sortingPosition).setY(0.14);
    ring.receiveShadow = true;
    this.scene.add(ring);

    const table = this.createBox(2.4, 0.8, 1.2, 0x4e8255);
    table.position.set(0, 0.55, -0.1);
    table.castShadow = true;
    this.scene.add(table);
  }

  private createPress(kind: WasteKind, x: number, z: number): PressStation {
    const color = kind === 'plastic' ? COLORS.plastic : COLORS.metal;
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const base = this.createBox(2.2, 0.55, 2.2, 0x40545a);
    base.position.y = 0.3;
    base.castShadow = true;
    group.add(base);

    const body = this.createBox(1.55, 1.8, 1.45, color);
    body.position.y = 1.4;
    body.castShadow = true;
    group.add(body);

    const piston = this.createBox(1.2, 0.35, 1.2, 0x26373d);
    piston.position.y = 2.45;
    piston.castShadow = true;
    group.add(piston);

    const inputStack = new THREE.Group();
    inputStack.position.set(-1.55, 0.2, 0.1);
    group.add(inputStack);
    this.populateStack(inputStack, color, 12, 0.32);

    const outputStack = new THREE.Group();
    outputStack.position.set(1.55, 0.25, 0.1);
    group.add(outputStack);
    this.populateBaleStack(outputStack, color, 6);

    this.scene.add(group);

    return {
      kind,
      stock: 0,
      output: 0,
      state: 'idle',
      timer: 0,
      group,
      piston,
      inputStack,
      outputStack,
      pickupPosition: new THREE.Vector3(x + 1.55, 0, z),
    };
  }

  private createSaleZone(): void {
    const zone = new THREE.Mesh(
      new THREE.CylinderGeometry(1.65, 1.65, 0.08, 32),
      new THREE.MeshStandardMaterial({ color: COLORS.sale, flatShading: true }),
    );
    zone.position.copy(this.salePosition).setY(0.15);
    zone.receiveShadow = true;
    this.scene.add(zone);

    const counter = this.createBox(3, 1, 0.8, 0x9c6f3c);
    counter.position.set(0, 0.6, -9.2);
    counter.castShadow = true;
    this.scene.add(counter);
  }

  private createCleaningSpots(): void {
    const positions = [
      new THREE.Vector3(-5.2, 0.14, -1.8),
      new THREE.Vector3(5.2, 0.14, -7.2),
      new THREE.Vector3(-5.5, 0.14, -7.4),
    ];

    for (const position of positions) {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.65, 0.9, 0.04, 12),
        new THREE.MeshStandardMaterial({
          color: 0x6f5b46,
          transparent: true,
          opacity: 0.78,
          flatShading: true,
        }),
      );
      mesh.position.copy(position);
      this.scene.add(mesh);
      this.cleanSpots.push({ mesh, progress: 0, done: false });
    }
  }

  private createPlayer(): void {
    this.player.position.set(0, 0.05, 12.5);
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

  private createWasteField(): void {
    for (let index = 0; index < 24; index += 1) {
      const kind: WasteKind = index % 2 === 0 ? 'plastic' : 'metal';
      const object = this.createWasteObject(kind);
      this.randomizeWastePosition(object);
      this.scene.add(object);
      this.wastes.push({ object, kind, active: true, respawnAt: 0 });
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

  private readonly tick = (): void => {
    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += delta;
    this.interactionCooldown = Math.max(0, this.interactionCooldown - delta);
    this.messageTimeout = Math.max(0, this.messageTimeout - delta);

    this.updatePlayer(delta);
    this.characterAnimator.update(delta);
    this.carriedStack.update(delta);
    this.updateWasteRespawns();
    this.updateInteractions(delta);
    this.updatePresses(delta);
    this.updateCleaning(delta);
    this.updatePurchases(delta);
    this.updateCamera(delta);
    this.updateHud();

    if (this.messageTimeout === 0) {
      this.statusElement.classList.remove('visible');
    }

    this.renderer.render(this.scene, this.camera);
  };

  private updatePlayer(delta: number): void {
    if (this.isMapView) return;

    const movement = this.input.sample();
    const length = Math.hypot(movement.x, movement.z);
    if (length < 0.05) return;

    const speed = this.moveSpeed;
    this.player.position.x = THREE.MathUtils.clamp(
      this.player.position.x + movement.x * speed * delta,
      -7.3,
      7.3,
    );
    this.player.position.z = THREE.MathUtils.clamp(
      this.player.position.z + movement.z * speed * delta,
      -9.2,
      15.4,
    );

    const targetRotation = Math.atan2(movement.x, movement.z);
    this.player.rotation.y = this.lerpAngle(this.player.rotation.y, targetRotation, 10 * delta);
    this.player.position.y = 0.05 + Math.sin(this.elapsed * 12) * 0.035;
  }

  private updateWasteRespawns(): void {
    for (const waste of this.wastes) {
      if (!waste.active && this.elapsed >= waste.respawnAt) {
        waste.active = true;
        waste.object.visible = true;
        this.randomizeWastePosition(waste.object);
      }
    }
  }

  private updateInteractions(_delta: number): void {
    if (this.isMapView || this.interactionCooldown > 0) return;

    if (this.carriedStack.count < this.carryCapacity) {
      const nearbyWaste = this.wastes.find(
        (waste) => waste.active && waste.object.position.distanceToSquared(this.player.position) < 0.72,
      );
      if (nearbyWaste) {
        nearbyWaste.active = false;
        nearbyWaste.object.visible = false;
        nearbyWaste.respawnAt = this.elapsed + 8;
        // The item flies from exactly where it was lying into the player's arms.
        this.carriedStack.add(nearbyWaste.kind, nearbyWaste.object.position);
        this.characterAnimator.playPickup();
        this.interactionCooldown = 0.12;
        this.showMessage(nearbyWaste.kind === 'plastic' ? 'Plastik toplandı' : 'Metal toplandı');
        return;
      }
    }

    if (!this.carriedStack.isEmpty && this.player.position.distanceToSquared(this.sortingPosition) < 2.1) {
      const target = this.sortingPosition.clone().setY(0.95);
      this.carriedStack.takeOne(target, (kind) => {
        // Credited when the item actually lands on the table, not on contact.
        const press = this.presses.find((station) => station.kind === kind);
        if (press) press.stock += 1;
      });
      this.characterAnimator.playDrop();
      this.interactionCooldown = 0.17;
      return;
    }

    const processedTotal = this.processedCargo.plastic + this.processedCargo.metal;
    if (processedTotal < 3) {
      const press = this.presses.find(
        (station) =>
          station.output > 0 &&
          station.pickupPosition.distanceToSquared(this.player.position) < 1.8,
      );
      if (press) {
        press.output -= 1;
        this.processedCargo[press.kind] += 1;
        this.interactionCooldown = 0.22;
        this.showMessage('İşlenmiş balya alındı');
        return;
      }
    }

    if (processedTotal > 0 && this.player.position.distanceToSquared(this.salePosition) < 2.5) {
      const kind: WasteKind = this.processedCargo.metal > 0 ? 'metal' : 'plastic';
      this.processedCargo[kind] -= 1;
      this.money += kind === 'metal' ? 18 : 12;
      this.interactionCooldown = 0.2;
      this.showMessage(kind === 'metal' ? '+18 metal satışı' : '+12 plastik satışı');
    }
  }

  private updatePresses(delta: number): void {
    for (const press of this.presses) {
      if (press.state === 'idle' && press.stock >= 5 && press.output < 6) {
        press.stock -= 5;
        press.state = 'processing';
        press.timer = this.pressDuration;
      }

      if (press.state === 'processing') {
        press.timer -= delta;
        const progress = 1 - Math.max(0, press.timer) / this.pressDuration;
        press.piston.position.y = 2.45 - Math.sin(progress * Math.PI) * 0.75;

        if (press.timer <= 0) {
          press.state = 'idle';
          press.output += 1;
          press.piston.position.y = 2.45;
          this.showMessage(press.kind === 'plastic' ? 'Plastik balya hazır' : 'Metal balya hazır');
        }
      }

      this.updateStackVisibility(press.inputStack, press.stock);
      this.updateStackVisibility(press.outputStack, press.output);
    }
  }

  private updateCleaning(delta: number): void {
    if (this.isMapView) return;

    for (const spot of this.cleanSpots) {
      if (spot.done) continue;

      const isNearby = spot.mesh.position.distanceToSquared(this.player.position) < 1.15;
      if (isNearby) {
        spot.progress += delta;
        const material = spot.mesh.material as THREE.MeshStandardMaterial;
        material.opacity = THREE.MathUtils.clamp(0.78 * (1 - spot.progress / 1.4), 0, 0.78);

        if (spot.progress >= 1.4) {
          spot.done = true;
          spot.mesh.visible = false;
          this.money += 3;
          this.showMessage('Alan temizlendi +3');
        }
      } else {
        spot.progress = Math.max(0, spot.progress - delta * 0.3);
      }
    }
  }

  private updatePurchases(delta: number): void {
    for (const zone of this.purchaseZones) {
      const inside = !this.isMapView && !zone.isComplete && zone.contains(this.player.position);
      zone.setActive(inside);

      if (inside && this.money > 0) {
        // Spend over roughly two and a half seconds so the wait is readable but
        // never tedious, and never faster than the player can afford.
        const rate = Math.max(20, zone.cost / 2.5);
        const spent = zone.contribute(Math.min(rate * delta, this.money));
        this.money -= spent;

        if (zone.isComplete) {
          this.applyPurchase(zone);
        }
      }

      zone.update(delta);
    }
  }

  private applyPurchase(zone: PurchaseZone): void {
    switch (zone.id) {
      case 'capacity':
        this.carryCapacity = 12;
        this.showMessage('Taşıma kapasitesi 12 oldu');
        break;
      case 'speed':
        this.moveSpeed = 5.9;
        this.showMessage('Hareket hızı arttı');
        break;
      case 'press':
        this.pressDuration = 1.7;
        this.showMessage('Presler daha hızlı çalışıyor');
        break;
      default:
        break;
    }
  }

  private updateCamera(delta: number): void {
    if (this.isMapView) {
      this.cameraDesired.set(0, 23, 19);
      this.cameraLookTarget.set(0, 0, 2.5);
    } else {
      this.cameraDesired.set(
        this.player.position.x,
        this.player.position.y + 12.5,
        this.player.position.z + 9.5,
      );
      this.cameraLookTarget.copy(this.player.position).add(new THREE.Vector3(0, 0.7, -1.8));
    }

    const smoothing = 1 - Math.exp(-delta * 5.5);
    this.camera.position.lerp(this.cameraDesired, smoothing);
    this.camera.lookAt(this.cameraLookTarget);
  }

  private updateHud(): void {
    const processedTotal = this.processedCargo.plastic + this.processedCargo.metal;
    this.moneyElement.textContent = String(Math.floor(this.money));
    this.bagElement.textContent = `${this.carriedStack.count}/${this.carryCapacity}${
      processedTotal > 0 ? ` • 📦 ${processedTotal}/3` : ''
    }`;

    if (this.isMapView) {
      this.objectiveElement.textContent = 'Tesis görünümü — Harita düğmesiyle oyuncuya dön';
    } else if (processedTotal > 0) {
      this.objectiveElement.textContent = 'Balya ürünlerini sarı satış alanına götür';
    } else if (!this.carriedStack.isEmpty) {
      this.objectiveElement.textContent = 'Atıkları yeşil ayırma alanına götür';
    } else if (this.presses.some((press) => press.output > 0)) {
      this.objectiveElement.textContent = 'Hazır balyayı makinenin yanından al';
    } else {
      this.objectiveElement.textContent = 'Sokaktaki plastik ve metalleri topla';
    }
  }

  private populateStack(group: THREE.Group, color: number, count: number, size: number): void {
    for (let index = 0; index < count; index += 1) {
      const item = this.createBox(size, size, size, color);
      item.position.set(
        (index % 3) * (size + 0.04),
        Math.floor(index / 6) * (size + 0.04),
        (Math.floor(index / 3) % 2) * (size + 0.04),
      );
      item.visible = false;
      item.castShadow = true;
      group.add(item);
    }
  }

  private populateBaleStack(group: THREE.Group, color: number, count: number): void {
    for (let index = 0; index < count; index += 1) {
      const bale = this.createBox(0.65, 0.34, 0.48, color);
      bale.position.set(
        (index % 2) * 0.7,
        Math.floor(index / 2) * 0.36,
        0,
      );
      bale.visible = false;
      bale.castShadow = true;
      group.add(bale);
    }
  }

  private updateStackVisibility(group: THREE.Group, count: number): void {
    for (let index = 0; index < group.children.length; index += 1) {
      group.children[index].visible = index < count;
    }
  }

  private randomizeWastePosition(object: THREE.Object3D): void {
    object.position.set(
      THREE.MathUtils.randFloat(-6.8, 6.8),
      0.12,
      THREE.MathUtils.randFloat(5, 15),
    );
    object.rotation.y = Math.random() * Math.PI * 2;
  }

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
      this.mapButton.setAttribute('aria-pressed', String(this.isMapView));
      this.mapButton.textContent = this.isMapView ? 'Oyuncuya Dön' : 'Harita';
    });
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
    this.messageTimeout = 1.35;
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
