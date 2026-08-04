import * as THREE from 'three';

export type CustomerWaste = 'plastic' | 'metal';

interface Customer {
  group: THREE.Group;
  bagMesh: THREE.Mesh;
  kind: CustomerWaste;
  bag: number;
  state: 'walking' | 'waiting' | 'leaving';
  target: THREE.Vector3;
}

const WALK_SPEED = 4.2;
/**
 * Fast enough that the line refills quicker than the player can empty it, so
 * there is normally somebody already standing at the desk rather than the
 * player waiting for the next person to walk across the yard.
 */
const SPAWN_SECONDS = 1.6;
/** Never leave the desk empty for longer than this once someone has left. */
const REFILL_SECONDS = 0.3;
const MAX_QUEUE = 4;
const BAG_MIN = 2;
const BAG_MAX = 4;
/** Gap between people standing in line. */
const SLOT_GAP = 1.6;
/**
 * How close to the head slot counts as "at the desk".
 */
const ARRIVAL_REACH = 0.35;

/**
 * People who bring their waste to the counter instead of the player walking out
 * to find it. They queue up facing the desk, hand their bag over one piece at a
 * time when the player is behind it, and leave once it is empty.
 */
export class CustomerQueue {
  public enabled = false;

  private readonly customers: Customer[] = [];
  private readonly group = new THREE.Group();
  // The first person is already on their way when the counter opens.
  private spawnTimer = 0.8;

  constructor(
    private readonly scene: THREE.Scene,
    /** Front of the desk - the first person in line stands here. */
    private readonly head: THREE.Vector3,
    /** Direction the queue runs away from the desk, towards the entrance. */
    private readonly away: THREE.Vector3,
  ) {
    this.scene.add(this.group);
  }

  /** The person at the head of the line, if they are ready to hand something over. */
  public get servable(): Customer | null {
    // Whoever is at the front of the line and still has something - skipping
    // anyone already walking away. Reading index zero meant a customer who had
    // just been emptied blocked the whole queue until they were off the map.
    const first = this.customers.find((item) => item.state !== 'leaving' && item.bag > 0);
    if (!first) return null;

    // Only the settled customer at the desk can hand items over. While someone
    // is still walking up, their bag stays with them.
    return first.state === 'waiting' && first.group.position.distanceTo(this.head) < ARRIVAL_REACH
      ? first
      : null;
  }

  public get length(): number {
    return this.customers.length;
  }

  /** Takes one item from the front customer and returns what it was. */
  public takeItem(customer: Customer): { kind: CustomerWaste; from: THREE.Vector3 } {
    customer.bag -= 1;
    const from = customer.group.position.clone().setY(1.1);

    if (customer.bag <= 0) {
      customer.state = 'leaving';
      customer.bagMesh.visible = false;
      customer.target = this.head.clone().addScaledVector(this.away, 17);
    }

    return { kind: customer.kind, from };
  }

  public update(delta: number): void {
    if (!this.enabled) return;

    const waiting = this.customers.filter((item) => item.state !== 'leaving').length;

    // An empty desk refills almost at once, so the player is never left idle.
    if (waiting === 0) this.spawnTimer = Math.min(this.spawnTimer, REFILL_SECONDS);

    this.spawnTimer -= delta;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = SPAWN_SECONDS;
      if (waiting < MAX_QUEUE) this.spawn();
    }

    // Everyone still in line shuffles forward as people are served.
    let slot = 0;
    for (const customer of this.customers) {
      if (customer.state === 'leaving') continue;
      customer.target = this.head.clone().addScaledVector(this.away, slot * SLOT_GAP);
      slot += 1;
    }

    for (let index = this.customers.length - 1; index >= 0; index -= 1) {
      const customer = this.customers[index];
      const position = customer.group.position;
      const toTarget = customer.target.clone().sub(position);
      toTarget.y = 0;

      const distance = toTarget.length();
      if (distance > 0.06) {
        position.addScaledVector(toTarget.normalize(), Math.min(WALK_SPEED * delta, distance));
        // Face the way they are going.
        customer.group.rotation.y = Math.atan2(toTarget.x, toTarget.z);
        // A small bob so they read as walking rather than sliding.
        position.y = Math.sin(performance.now() * 0.012) * 0.05;
      } else if (customer.state === 'walking') {
        customer.state = 'waiting';
        position.y = 0;
        // Turn to face the desk.
        customer.group.rotation.y = Math.atan2(-this.away.x, -this.away.z);
      }

      if (customer.state === 'leaving' && distance <= 0.06) {
        this.group.remove(customer.group);
        this.customers.splice(index, 1);
      }
    }
  }

  private spawn(): void {
    const kind: CustomerWaste = Math.random() < 0.5 ? 'plastic' : 'metal';
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.3, 0.62, 5, 10),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(Math.random(), 0.45, 0.55),
        roughness: 0.85,
      }),
    );
    body.position.y = 1.05;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 14, 12),
      new THREE.MeshStandardMaterial({ color: 0xe9c9a8, roughness: 0.9 }),
    );
    head.position.y = 1.75;
    group.add(head);

    const bagMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.5, 0.34),
      new THREE.MeshStandardMaterial({
        color: kind === 'plastic' ? 0x4db5f0 : 0xd9805b,
        flatShading: true,
      }),
    );
    bagMesh.position.set(0.42, 0.85, 0.1);
    group.add(bagMesh);

    group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = true;
    });

    // Walk in from just beyond the entrance - far enough to be seen arriving,
    // close enough that the counter is never standing idle.
    group.position.copy(this.head).addScaledVector(this.away, 8);
    this.group.add(group);

    this.customers.push({
      group,
      bagMesh,
      kind,
      bag: THREE.MathUtils.randInt(BAG_MIN, BAG_MAX),
      state: 'walking',
      target: this.head.clone(),
    });
  }
}
