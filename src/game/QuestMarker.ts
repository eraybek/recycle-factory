import * as THREE from 'three';

/**
 * Floating beacon over whatever the current objective points at. A written
 * objective alone leaves the player scanning the map for where to go; this
 * answers "where" without a minimap.
 */
export class QuestMarker {
  private readonly group = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private phase = 0;
  private visible = false;

  constructor(scene: THREE.Scene) {
    const material = new THREE.MeshBasicMaterial({ color: 0xf3cf4f });

    // Downward-pointing pin so the eye lands on the ground, not the marker.
    const pin = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.85, 5), material);
    pin.rotation.x = Math.PI;
    pin.position.y = 2.5;
    this.group.add(pin);

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 6), material);
    stem.position.y = 3.15;
    this.group.add(stem);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 0.95, 28),
      new THREE.MeshBasicMaterial({
        color: 0xf3cf4f,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.2;
    this.group.add(this.ring);

    this.group.visible = false;
    scene.add(this.group);
  }

  /** Point at a world position, or pass null to hide the marker. */
  public setTarget(target: THREE.Vector3 | null): void {
    this.visible = target !== null;
    this.group.visible = this.visible;
    if (target) this.group.position.set(target.x, 0, target.z);
  }

  public update(delta: number): void {
    if (!this.visible) return;

    this.phase += delta * 3;
    this.group.children[0].position.y = 2.5 + Math.sin(this.phase) * 0.18;
    this.group.children[1].position.y = 3.15 + Math.sin(this.phase) * 0.18;
    this.group.rotation.y += delta * 1.2;

    // Ring breathes so a stationary target still reads as active.
    const pulse = 1 + Math.sin(this.phase * 0.8) * 0.12;
    this.ring.scale.set(pulse, pulse, 1);
  }
}
