import * as THREE from 'three';

interface Coin {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  time: number;
  duration: number;
  arc: number;
  spin: number;
  /** Shrinks away on arrival, for notes flying off to the counter. */
  shrink: boolean;
}

/** Where earnings fly to: roughly the money pill in the top-left of the HUD. */
const HUD_NDC = new THREE.Vector2(-0.62, 0.82);
/** Distance in front of the camera to aim at, so notes keep a sane size. */
const HUD_DEPTH = 17;

const COIN_DURATION = 0.42;
const COIN_COLOR = 0x4fbf6a;
const NOTE_COLOR = 0xe8f5d8;

/**
 * The stream of banknotes that flies from the player to whatever they are
 * paying for. Paying is otherwise a silent number going down, and the money has
 * to be seen leaving the player for the wait to read as a transaction.
 */
export class CoinFlow {
  private readonly coins: Coin[] = [];
  private readonly geometry = new THREE.BoxGeometry(0.34, 0.06, 0.22);
  private readonly material = new THREE.MeshStandardMaterial({
    color: COIN_COLOR,
    flatShading: true,
  });
  private readonly stripeGeometry = new THREE.BoxGeometry(0.12, 0.07, 0.23);
  private readonly stripeMaterial = new THREE.MeshStandardMaterial({
    color: NOTE_COLOR,
    flatShading: true,
  });

  constructor(private readonly scene: THREE.Scene) {}

  /**
   * Sends notes towards the money counter. The target is found by casting a ray
   * through the HUD's corner of the screen, so the notes fly to where the
   * player's balance actually is however the camera is sitting.
   */
  public emitToHud(from: THREE.Vector3, camera: THREE.Camera, count = 3): void {
    const ray = new THREE.Vector3(HUD_NDC.x, HUD_NDC.y, 0.5).unproject(camera);
    const target = camera
      .getWorldPosition(new THREE.Vector3())
      .add(ray.sub(camera.getWorldPosition(new THREE.Vector3())).normalize().multiplyScalar(HUD_DEPTH));

    for (let index = 0; index < count; index += 1) {
      this.emit(from, target, true);
    }
  }

  public emit(from: THREE.Vector3, to: THREE.Vector3, shrink = false): void {
    const mesh = new THREE.Mesh(this.geometry, this.material);

    const stripe = new THREE.Mesh(this.stripeGeometry, this.stripeMaterial);
    mesh.add(stripe);

    // A little scatter so a stream of notes does not look like one repeated one.
    mesh.position.copy(from);
    this.scene.add(mesh);

    this.coins.push({
      mesh,
      shrink,
      from: from.clone().add(
        new THREE.Vector3(
          THREE.MathUtils.randFloatSpread(0.5),
          THREE.MathUtils.randFloat(0.9, 1.5),
          THREE.MathUtils.randFloatSpread(0.5),
        ),
      ),
      to: to.clone().add(
        new THREE.Vector3(
          THREE.MathUtils.randFloatSpread(0.7),
          0.1,
          THREE.MathUtils.randFloatSpread(0.7),
        ),
      ),
      time: 0,
      duration: COIN_DURATION * THREE.MathUtils.randFloat(0.85, 1.15),
      arc: THREE.MathUtils.randFloat(0.7, 1.3),
      spin: THREE.MathUtils.randFloat(4, 9),
    });
  }

  public update(delta: number): void {
    for (let index = this.coins.length - 1; index >= 0; index -= 1) {
      const coin = this.coins[index];
      coin.time += delta;

      const t = THREE.MathUtils.clamp(coin.time / coin.duration, 0, 1);
      const eased = t * t * (3 - 2 * t);

      coin.mesh.position.lerpVectors(coin.from, coin.to, eased);
      coin.mesh.position.y += Math.sin(eased * Math.PI) * coin.arc;
      coin.mesh.rotation.y = eased * coin.spin;
      coin.mesh.rotation.z = eased * coin.spin * 0.4;

      if (coin.shrink) {
        // Pops out to full size, then vanishes into the counter.
        const grow = Math.min(1, t / 0.18);
        coin.mesh.scale.setScalar(grow * (1 - Math.max(0, (t - 0.75) / 0.25)));
      }

      if (t < 1) continue;

      this.scene.remove(coin.mesh);
      this.coins.splice(index, 1);
    }
  }

  public dispose(): void {
    for (const coin of this.coins) this.scene.remove(coin.mesh);
    this.coins.length = 0;
    this.geometry.dispose();
    this.material.dispose();
    this.stripeGeometry.dispose();
    this.stripeMaterial.dispose();
  }
}
