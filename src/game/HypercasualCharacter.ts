import * as THREE from 'three';

const COLORS = {
  body: 0xaeb4bc,
  light: 0xd9dde2,
  dark: 0x747b85,
  shadow: 0x30343a,
  cargo: 0x4db5f0,
};

export function buildHypercasualCharacter(
  player: THREE.Group,
  carryMeshes: THREE.Mesh[],
): void {
  player.clear();

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.65, 24),
    new THREE.MeshBasicMaterial({
      color: COLORS.shadow,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.015;
  player.add(shadow);

  const torso = capsule(0.31, 0.58, COLORS.body);
  torso.position.y = 1.12;
  player.add(torso);

  const head = sphere(0.49, COLORS.light);
  head.position.y = 1.98;
  player.add(head);

  const backpack = box(0.56, 0.6, 0.25, COLORS.dark);
  backpack.position.set(0, 1.1, 0.37);
  player.add(backpack);

  const leftArm = limb(-0.47, 1.45, -0.15, COLORS.light, 0.11, 0.62);
  const rightArm = limb(0.47, 1.45, 0.15, COLORS.light, 0.11, 0.62);
  const leftLeg = limb(-0.18, 0.83, 0, COLORS.dark, 0.13, 0.67);
  const rightLeg = limb(0.18, 0.83, 0, COLORS.dark, 0.13, 0.67);
  player.add(leftArm, rightArm, leftLeg, rightLeg);

  carryMeshes.length = 0;
  for (let index = 0; index < 8; index += 1) {
    const cargo = box(0.22, 0.18, 0.18, COLORS.cargo);
    cargo.position.set(
      (index % 2 === 0 ? -1 : 1) * 0.16,
      1.35 + Math.floor(index / 2) * 0.18,
      0.53,
    );
    cargo.visible = false;
    carryMeshes.push(cargo);
    player.add(cargo);
  }

  player.traverse((object) => {
    if (object instanceof THREE.Mesh && object !== shadow) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  let previousPosition = player.position.clone();
  let previousTime = performance.now() * 0.001;
  let phase = 0;
  let movementBlend = 0;

  torso.onBeforeRender = () => {
    const currentTime = performance.now() * 0.001;
    const delta = Math.min(currentTime - previousTime, 0.05);
    const distance = player.position.distanceTo(previousPosition);
    const targetBlend = delta > 0 ? THREE.MathUtils.clamp(distance / (delta * 4.7), 0, 1) : 0;
    movementBlend = THREE.MathUtils.lerp(movementBlend, targetBlend, 0.22);
    phase += delta * (3 + movementBlend * 8.5);

    const carrying = carryMeshes.some((mesh) => mesh.visible);
    const armAmount = carrying ? 0.48 : 0.72;
    const swing = Math.sin(phase);

    leftArm.rotation.x = THREE.MathUtils.lerp(leftArm.rotation.x, swing * armAmount * movementBlend, 0.28);
    rightArm.rotation.x = THREE.MathUtils.lerp(rightArm.rotation.x, -swing * armAmount * movementBlend, 0.28);
    leftLeg.rotation.x = THREE.MathUtils.lerp(leftLeg.rotation.x, -swing * 0.62 * movementBlend, 0.3);
    rightLeg.rotation.x = THREE.MathUtils.lerp(rightLeg.rotation.x, swing * 0.62 * movementBlend, 0.3);

    previousPosition.copy(player.position);
    previousTime = currentTime;
  };
}

function limb(
  x: number,
  y: number,
  zRotation: number,
  color: number,
  radius: number,
  length: number,
): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  pivot.rotation.z = zRotation;

  const mesh = capsule(radius, length, color);
  mesh.position.y = -(length * 0.5 + radius);
  pivot.add(mesh);
  return pivot;
}

function capsule(radius: number, length: number, color: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, length, 6, 12),
    material(color),
  );
}

function sphere(radius: number, color: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 20, 16),
    material(color),
  );
}

function box(width: number, height: number, depth: number, color: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth, 2, 2, 2),
    material(color),
  );
}

function material(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.82,
    metalness: 0,
    flatShading: false,
  });
}
