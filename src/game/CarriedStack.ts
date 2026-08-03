import * as THREE from 'three';

export interface CarriedStackOptions {
  /** Group the carried items are parented to - normally the player. */
  owner: THREE.Group;
  /** Builds a fresh visual for a carried item. Must match the world object. */
  createVisual: (kind: string) => THREE.Object3D;
  /** Owner-local resting place of the nth carried item. */
  slot: (index: number) => THREE.Vector3;
}

type Phase = 'incoming' | 'settled' | 'outgoing';

interface Entry {
  object: THREE.Object3D;
  kind: string;
  phase: Phase;
  time: number;
  duration: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  arc: number;
  rotationFrom: THREE.Euler;
  rotationTo: THREE.Euler;
  onArrive?: (kind: string) => void;
}

/** Carried items are turned to point forwards so the pile reads as a stack. */
const CARRY_YAW = Math.PI / 2;

const PICK_UP_DURATION = 0.32;
const DROP_DURATION = 0.26;

/**
 * The pile of waste the player is holding.
 *
 * Items keep the exact visual they had on the ground - the stack clones the
 * same builder the world objects come from - and they fly along an arc between
 * the ground, the player's arms and whatever they are dropped into, so picking
 * up and dropping never happens as a silent counter change.
 */
export class CarriedStack {
  private readonly owner: THREE.Group;
  private readonly createVisual: (kind: string) => THREE.Object3D;
  private readonly slot: (index: number) => THREE.Vector3;
  private readonly entries: Entry[] = [];

  constructor(options: CarriedStackOptions) {
    this.owner = options.owner;
    this.createVisual = options.createVisual;
    this.slot = options.slot;
  }

  /** Items held or on their way in - what a capacity check should look at. */
  public get count(): number {
    return this.entries.filter((entry) => entry.phase !== 'outgoing').length;
  }

  public get isEmpty(): boolean {
    return this.count === 0;
  }

  /** The kinds currently held, oldest first. */
  public get kinds(): string[] {
    return this.entries.filter((entry) => entry.phase !== 'outgoing').map((entry) => entry.kind);
  }

  /** Sends an item flying from a world position into the player's arms. */
  public add(kind: string, worldPosition: THREE.Vector3): void {
    const object = this.createVisual(kind);
    const from = this.owner.worldToLocal(worldPosition.clone());
    const index = this.count;

    object.position.copy(from);
    this.owner.add(object);

    this.entries.push({
      object,
      kind,
      phase: 'incoming',
      time: 0,
      duration: PICK_UP_DURATION,
      from,
      to: this.slot(index),
      arc: 0.85,
      rotationFrom: new THREE.Euler(0, 0, 0),
      rotationTo: new THREE.Euler(0, CARRY_YAW, 0),
      onArrive: undefined,
    });
  }

  /**
   * Throws the most recently added item towards a world position. `onArrive`
   * runs when it lands, which is when the reward should be paid out.
   */
  public takeOne(worldTarget: THREE.Vector3, onArrive?: (kind: string) => void): string | null {
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const entry = this.entries[index];
      if (entry.phase === 'outgoing') continue;

      entry.phase = 'outgoing';
      entry.time = 0;
      entry.duration = DROP_DURATION;
      entry.from = entry.object.position.clone();
      entry.to = this.owner.worldToLocal(worldTarget.clone());
      entry.arc = 0.7;
      // Tumble on the way out instead of re-running the pick-up turn.
      entry.rotationFrom = entry.object.rotation.clone();
      entry.rotationTo = new THREE.Euler(Math.PI, CARRY_YAW, 0);
      entry.onArrive = onArrive;
      this.reflow();
      return entry.kind;
    }

    return null;
  }

  public update(delta: number): void {
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const entry = this.entries[index];

      if (entry.phase === 'settled') {
        // Keep following the slot in case the stack reflowed underneath it.
        entry.object.position.lerp(entry.to, 1 - Math.exp(-delta * 18));
        continue;
      }

      entry.time += delta;
      const t = THREE.MathUtils.clamp(entry.time / entry.duration, 0, 1);
      const eased = t * t * (3 - 2 * t);

      entry.object.position.lerpVectors(entry.from, entry.to, eased);
      // A parabola on top of the straight path reads as a real toss.
      entry.object.position.y += Math.sin(eased * Math.PI) * entry.arc;
      entry.object.rotation.set(
        THREE.MathUtils.lerp(entry.rotationFrom.x, entry.rotationTo.x, eased),
        THREE.MathUtils.lerp(entry.rotationFrom.y, entry.rotationTo.y, eased),
        THREE.MathUtils.lerp(entry.rotationFrom.z, entry.rotationTo.z, eased),
      );

      if (t < 1) continue;

      if (entry.phase === 'incoming') {
        entry.phase = 'settled';
        entry.object.position.copy(entry.to);
        continue;
      }

      entry.onArrive?.(entry.kind);
      this.owner.remove(entry.object);
      disposeObject(entry.object);
      this.entries.splice(index, 1);
    }
  }

  /** Re-assigns slots after an item leaves so the pile closes up its gaps. */
  private reflow(): void {
    let index = 0;
    for (const entry of this.entries) {
      if (entry.phase === 'outgoing') continue;
      entry.to = this.slot(index);
      index += 1;
    }
  }

  public clear(): void {
    for (const entry of this.entries) {
      this.owner.remove(entry.object);
      disposeObject(entry.object);
    }
    this.entries.length = 0;
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
