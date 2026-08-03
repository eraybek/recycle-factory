import * as THREE from 'three';

export interface PurchaseZoneOptions {
  /** Identifies the effect this zone unlocks. */
  id: string;
  title: string;
  cost: number;
  position: THREE.Vector3;
  radius?: number;
  color?: number;
}

const LABEL_WIDTH = 512;
const LABEL_HEIGHT = 256;
const THETA_SEGMENTS = 64;
/** RingGeometry emits two triangles - six indices - per theta segment. */
const INDICES_PER_SEGMENT = 6;

/**
 * A pad the player buys something from by standing on it. Money is spent
 * gradually while the player waits, and partial payments are kept so a zone can
 * be finished across several visits.
 *
 * Progress is drawn as an arc around the rim rather than a disc in the middle,
 * because the character stands in the centre and would hide it.
 */
export class PurchaseZone {
  public readonly group = new THREE.Group();
  public readonly id: string;
  public readonly title: string;
  public readonly cost: number;
  public readonly position: THREE.Vector3;

  private readonly radius: number;
  private readonly progressRing: THREE.Mesh;
  private readonly progressGeometry: THREE.RingGeometry;
  private readonly track: THREE.Mesh;
  private readonly label: THREE.Sprite;
  private readonly labelTexture: THREE.CanvasTexture;
  private readonly labelContext: CanvasRenderingContext2D | null;

  private paid = 0;
  private completed = false;
  private active = false;
  private fade = 1;
  private displayProgress = 0;
  private drawnRemaining = -1;

  constructor(options: PurchaseZoneOptions) {
    this.id = options.id;
    this.title = options.title;
    this.cost = options.cost;
    this.position = options.position.clone();
    this.radius = options.radius ?? 1.05;

    const color = options.color ?? 0x4fc36b;

    const base = new THREE.Mesh(
      new THREE.CircleGeometry(this.radius, 32),
      new THREE.MeshStandardMaterial({ color: 0xe4ebe2, flatShading: true }),
    );
    base.rotation.x = -Math.PI / 2;
    base.position.y = 0.13;
    base.receiveShadow = true;
    this.group.add(base);

    // Unfilled part of the rim, so the remaining cost stays visible.
    this.track = new THREE.Mesh(
      new THREE.RingGeometry(this.radius * 0.76, this.radius, THETA_SEGMENTS, 1),
      new THREE.MeshBasicMaterial({
        color: 0x9aa8a0,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    this.track.rotation.x = -Math.PI / 2;
    this.track.position.y = 0.142;
    this.group.add(this.track);

    // Filled arc. Rather than rebuilding the geometry every frame, the ring is
    // built once and only a prefix of its indices is drawn.
    this.progressGeometry = new THREE.RingGeometry(
      this.radius * 0.76,
      this.radius,
      THETA_SEGMENTS,
      1,
      Math.PI / 2,
      Math.PI * 2,
    );
    this.progressRing = new THREE.Mesh(
      this.progressGeometry,
      new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }),
    );
    this.progressRing.rotation.x = -Math.PI / 2;
    this.progressRing.position.y = 0.15;
    this.progressGeometry.setDrawRange(0, 0);
    this.group.add(this.progressRing);

    const canvas = document.createElement('canvas');
    canvas.width = LABEL_WIDTH;
    canvas.height = LABEL_HEIGHT;
    this.labelContext = canvas.getContext('2d');
    this.labelTexture = new THREE.CanvasTexture(canvas);
    this.labelTexture.colorSpace = THREE.SRGBColorSpace;

    this.label = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.labelTexture, transparent: true, depthTest: false }),
    );
    this.label.scale.set(1.7, 0.85, 1);
    // Clears the character's head so the two never overlap.
    this.label.position.set(0, 2.45, 0);
    this.label.renderOrder = 10;
    this.group.add(this.label);

    this.group.position.copy(this.position);
    this.redrawLabel();
  }

  public get isComplete(): boolean {
    return this.completed;
  }

  public get remaining(): number {
    return Math.max(0, this.cost - this.paid);
  }

  public contains(point: THREE.Vector3): boolean {
    const dx = point.x - this.position.x;
    const dz = point.z - this.position.z;
    return dx * dx + dz * dz < this.radius * this.radius;
  }

  public setActive(active: boolean): void {
    this.active = active;
  }

  /** Applies a payment and returns how much of it the zone actually took. */
  public contribute(amount: number): number {
    if (this.completed || amount <= 0) return 0;

    const taken = Math.min(amount, this.remaining);
    this.paid += taken;

    if (this.remaining <= 1e-6) {
      this.completed = true;
      this.paid = this.cost;
    }

    return taken;
  }

  public update(delta: number): void {
    const progress = THREE.MathUtils.clamp(this.paid / this.cost, 0, 1);
    this.displayProgress = THREE.MathUtils.lerp(
      this.displayProgress,
      progress,
      1 - Math.exp(-delta * 12),
    );

    const segments = Math.round(this.displayProgress * THETA_SEGMENTS);
    this.progressGeometry.setDrawRange(0, segments * INDICES_PER_SEGMENT);

    const progressMaterial = this.progressRing.material as THREE.MeshBasicMaterial;
    const trackMaterial = this.track.material as THREE.MeshBasicMaterial;
    const labelMaterial = this.label.material as THREE.SpriteMaterial;

    if (this.completed) {
      // Fade the finished pad away so it stops competing for attention.
      this.fade = Math.max(0, this.fade - delta * 1.6);
      progressMaterial.opacity = this.fade;
      trackMaterial.opacity = this.fade * 0.55;
      labelMaterial.opacity = this.fade;
      this.label.position.y = THREE.MathUtils.lerp(this.label.position.y, 3.1, 1 - Math.exp(-delta * 3));
      this.group.visible = this.fade > 0.01;
      this.redrawLabel();
      return;
    }

    // A gentle pulse while the player is paying, so the wait reads as progress.
    const pulse = this.active ? 0.82 + Math.sin(performance.now() * 0.008) * 0.18 : 1;
    progressMaterial.opacity = pulse;
    this.label.position.y = 2.45 + (this.active ? Math.sin(performance.now() * 0.006) * 0.05 : 0);

    this.redrawLabel();
  }

  private redrawLabel(): void {
    const context = this.labelContext;
    if (!context) return;

    const remaining = this.completed ? 0 : Math.ceil(this.remaining);
    if (remaining === this.drawnRemaining) return;
    this.drawnRemaining = remaining;

    context.clearRect(0, 0, LABEL_WIDTH, LABEL_HEIGHT);

    context.fillStyle = 'rgba(255, 255, 255, 0.94)';
    context.beginPath();
    context.roundRect(12, 24, LABEL_WIDTH - 24, LABEL_HEIGHT - 72, 36);
    context.fill();

    context.textAlign = 'center';
    context.textBaseline = 'middle';

    context.fillStyle = '#2f4f36';
    context.font = 'bold 44px system-ui, -apple-system, Segoe UI, sans-serif';
    context.fillText(this.title, LABEL_WIDTH / 2, 80, LABEL_WIDTH - 60);

    if (this.completed) {
      context.fillStyle = '#3f9c54';
      context.font = 'bold 56px system-ui, -apple-system, Segoe UI, sans-serif';
      context.fillText('AÇILDI', LABEL_WIDTH / 2, 150);
    } else {
      context.fillStyle = '#1f2d24';
      context.font = 'bold 64px system-ui, -apple-system, Segoe UI, sans-serif';
      context.fillText(`💵 ${remaining}`, LABEL_WIDTH / 2, 152);
    }

    this.labelTexture.needsUpdate = true;
  }

  public dispose(): void {
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const item of materials) item.dispose();
      }
    });
    this.labelTexture.dispose();
    (this.label.material as THREE.SpriteMaterial).dispose();
  }
}
