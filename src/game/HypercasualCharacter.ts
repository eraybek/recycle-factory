import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const COLORS = {
  body: 0xaeb4bc,
  light: 0xd9dde2,
  dark: 0x747b85,
  shadow: 0x30343a,
  cargo: 0x4db5f0,
};

const MODEL_URL = `${import.meta.env.BASE_URL}models/hyper-casual-character.glb`;
const TARGET_MODEL_HEIGHT = 2.35;

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

  const fallback = createFallbackCharacter(player, carryMeshes);
  player.add(fallback);
  createCargoMeshes(player, carryMeshes);

  const loader = new GLTFLoader();
  loader.load(
    MODEL_URL,
    (gltf) => {
      const model = gltf.scene;
      prepareModel(model);

      const mixer = new THREE.AnimationMixer(model);
      const idleClip =
        gltf.animations.find((clip) => clip.name.toLowerCase().includes('idle')) ??
        gltf.animations[0];

      if (idleClip) {
        const idleAction = mixer.clipAction(idleClip);
        idleAction.reset().setLoop(THREE.LoopRepeat, Infinity).play();
        mixer.update(0);
      }

      const animationDriver = findFirstMesh(model);
      let previousTime = performance.now() * 0.001;
      if (animationDriver) {
        animationDriver.onBeforeRender = () => {
          const currentTime = performance.now() * 0.001;
          const delta = Math.min(Math.max(currentTime - previousTime, 0), 0.05);
          mixer.update(delta);
          previousTime = currentTime;
        };
      }

      player.add(model);
      player.remove(fallback);
      disposeGroup(fallback);
    },
    undefined,
    (error) => {
      console.error('Hypercasual character model could not be loaded.', error);
    },
  );
}

function prepareModel(model: THREE.Group): void {
  // The source model faces local +X; the game uses local +Z as forward.
  model.rotation.y = -Math.PI / 2;
  model.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = size.y > 0 ? TARGET_MODEL_HEIGHT / size.y : 1;
  model.scale.multiplyScalar(scale);
  model.updateMatrixWorld(true);

  bounds.setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.y -= bounds.min.y;
  model.position.z -= center.z;
  model.updateMatrixWorld(true);

  model.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = false;
    }
  });
}

function createFallbackCharacter(
  player: THREE.Group,
  carryMeshes: THREE.Mesh[],
): THREE.Group {
  const fallback = new THREE.Group();

  const torso = capsule(0.31, 0.58, COLORS.body);
  torso.position.y = 1.12;
  fallback.add(torso);

  const head = sphere(0.49, COLORS.light);
  head.position.y = 1.98;
  fallback.add(head);

  const backpack = box(0.56, 0.6, 0.25, COLORS.dark);
  backpack.position.set(0, 1.1, 0.37);
  fallback.add(backpack);

  const leftArm = limb(-0.47, 1.45, -0.15, COLORS.light, 0.11, 0.62);
  const rightArm = limb(0.47, 1.45, 0.15, COLORS.light, 0.11, 0.62);
  const leftLeg = limb(-0.18, 0.83, 0, COLORS.dark, 0.13, 0.67);
  const rightLeg = limb(0.18, 0.83, 0, COLORS.dark, 0.13, 0.67);
  fallback.add(leftArm, rightArm, leftLeg, rightLeg);

  fallback.traverse((object) => {
    if (object instanceof THREE.Mesh) {
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

  return fallback;
}

function createCargoMeshes(player: THREE.Group, carryMeshes: THREE.Mesh[]): void {
  carryMeshes.length = 0;
  for (let index = 0; index < 8; index += 1) {
    const cargo = box(0.22, 0.18, 0.18, COLORS.cargo);
    cargo.position.set(
      (index % 2 === 0 ? -1 : 1) * 0.16,
      1.35 + Math.floor(index / 2) * 0.18,
      0.53,
    );
    cargo.visible = false;
    cargo.castShadow = true;
    cargo.receiveShadow = true;
    carryMeshes.push(cargo);
    player.add(cargo);
  }
}

function findFirstMesh(root: THREE.Object3D): THREE.Mesh | null {
  let result: THREE.Mesh | null = null;
  root.traverse((object) => {
    if (!result && object instanceof THREE.Mesh) result = object;
  });
  return result;
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const item of materials) item.dispose();
  });
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
