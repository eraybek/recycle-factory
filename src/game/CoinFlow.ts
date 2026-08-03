import * as THREE from 'three';

interface Coin {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  time: number;
  duration: number;
  arc: number;
  spin: number;
}

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

  public emit(from: THREE.Vector3, to: THREE.Vector3): void {
    const mesh = new THREE.Mesh(this.geometry, this.material);

    const stripe = new THREE.Mesh(this.stripeGeometry, this.stripeMaterial);
    mesh.add(stripe);

    // A little scatter so a stream of notes does not look like one repeated one.
    mesh.position.copy(from);
    this.scene.add(mesh);

    this.coins.push({
      mesh,
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
