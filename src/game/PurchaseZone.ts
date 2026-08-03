import * as THREE from 'three';

export interface PurchaseZoneOptions {
  /** Identifies the effect this zone unlocks. */
  id: string;
  title: string;
  cost: number;
  position: THREE.Vector3;
  radius?: number;
}

const LABEL_SIZE = 512;
const FILL_SEGMENTS = 72;
/** CircleGeometry fans out from the centre: three indices per theta segment. */
const INDICES_PER_SEGMENT = 3;

const COLOR_EMPTY = 0xf2f5f0;
const COLOR_FILL = 0x4fc36b;

/**
 * A pad the player buys something from by standing on it. Money is spent
 * gradually while the player waits, and partial payments are kept so a zone can
 * be finished across several visits.
 *
 * Everything is printed flat on the ground: the disc sweeps green as it is paid
 * off and the price sits on top of it as a decal, so the pad reads as part of
 * the floor rather than as a billboard floating over it.
 */
export class PurchaseZone {
  public readonly group = new THREE.Group();
  public readonly id: string;
  public readonly title: string;
  public readonly cost: number;
  public readonly position: THREE.Vector3;

  private readonly radius: number;
  private readonly base: THREE.Mesh;
  private readonly fill: THREE.Mesh;
  private readonly fillGeometry: THREE.CircleGeometry;
  private readonly label: THREE.Mesh;
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

    // Unpaid part of the pad.
    this.base = new THREE.Mesh(
      new THREE.CircleGeometry(this.radius, FILL_SEGMENTS),
      new THREE.MeshBasicMaterial({ color: COLOR_EMPTY, transparent: true, opacity: 0.95 }),
    );
    this.base.rotation.x = -Math.PI / 2;
    this.base.position.y = 0.12;
    this.group.add(this.base);

    // Paid part. Rather than rebuilding geometry every frame, the disc is built
    // once and only a prefix of its indices is drawn, which sweeps it round
    // like a clock from twelve o'clock.
    this.fillGeometry = new THREE.CircleGeometry(
      this.radius,
      FILL_SEGMENTS,
      Math.PI / 2,
      Math.PI * 2,
    );
    this.fill = new THREE.Mesh(
      this.fillGeometry,
      new THREE.MeshBasicMaterial({ color: COLOR_FILL, transparent: true }),
    );
    this.fill.rotation.x = -Math.PI / 2;
    this.fill.position.y = 0.13;
    this.fillGeometry.setDrawRange(0, 0);
    this.group.add(this.fill);

    const canvas = document.createElement('canvas');
    canvas.width = LABEL_SIZE;
    canvas.height = LABEL_SIZE;
    this.labelContext = canvas.getContext('2d');
    this.labelTexture = new THREE.CanvasTexture(canvas);
    this.labelTexture.colorSpace = THREE.SRGBColorSpace;

    // Printed on the floor. The plane's local +Y maps to world -Z once it is
    // laid flat, which is up the screen for this game's fixed camera angle, so
    // the text always reads the right way up.
    this.label = new THREE.Mesh(
      new THREE.PlaneGeometry(this.radius * 2, this.radius * 2),
      new THREE.MeshBasicMaterial({
        map: this.labelTexture,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.label.rotation.x = -Math.PI / 2;
    this.label.position.y = 0.14;
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

    const segments = Math.round(this.displayProgress * FILL_SEGMENTS);
    this.fillGeometry.setDrawRange(0, segments * INDICES_PER_SEGMENT);

    const baseMaterial = this.base.material as THREE.MeshBasicMaterial;
    const fillMaterial = this.fill.material as THREE.MeshBasicMaterial;
    const labelMaterial = this.label.material as THREE.MeshBasicMaterial;

    if (this.completed) {
      // Fade the finished pad away so it stops competing for attention.
      this.fade = Math.max(0, this.fade - delta * 1.4);
      baseMaterial.opacity = this.fade * 0.95;
      fillMaterial.opacity = this.fade;
      labelMaterial.opacity = this.fade;
      this.group.visible = this.fade > 0.01;
      this.redrawLabel();
      return;
    }

    // A gentle pulse while the player is paying, so the wait reads as progress.
    fillMaterial.opacity = this.active
      ? 0.85 + Math.sin(performance.now() * 0.008) * 0.15
      : 1;

    this.redrawLabel();
  }

  private redrawLabel(): void {
    const context = this.labelContext;
    if (!context) return;

    const remaining = this.completed ? 0 : Math.ceil(this.remaining);
    if (remaining === this.drawnRemaining) return;
    this.drawnRemaining = remaining;

    context.clearRect(0, 0, LABEL_SIZE, LABEL_SIZE);
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    if (this.completed) {
      context.fillStyle = '#1f5b2f';
      context.font = 'bold 72px system-ui, -apple-system, Segoe UI, sans-serif';
      context.fillText('AÇILDI', LABEL_SIZE / 2, LABEL_SIZE / 2);
      this.labelTexture.needsUpdate = true;
      return;
    }

    context.fillStyle = '#26402c';
    context.font = 'bold 52px system-ui, -apple-system, Segoe UI, sans-serif';
    context.fillText(this.title, LABEL_SIZE / 2, LABEL_SIZE * 0.36, LABEL_SIZE * 0.82);

    // Amount above, price below, as on the reference pads.
    context.fillStyle = '#14301c';
    context.font = 'bold 96px system-ui, -apple-system, Segoe UI, sans-serif';
    context.fillText(`${remaining}`, LABEL_SIZE / 2, LABEL_SIZE * 0.58);

    context.fillStyle = '#3c7a4a';
    context.font = 'bold 44px system-ui, -apple-system, Segoe UI, sans-serif';
    context.fillText('PARA', LABEL_SIZE / 2, LABEL_SIZE * 0.73);

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
  }
}
