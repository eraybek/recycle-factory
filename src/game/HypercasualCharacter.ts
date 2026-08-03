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
const MODEL_FORWARD_SPEED = 4.7;
const LOCAL_SWING_AXIS = new THREE.Vector3(0, 0, 1);
const LOCAL_TWIST_AXIS = new THREE.Vector3(0, 1, 0);

interface BonePose {
  bone: THREE.Bone;
  neutral: THREE.Quaternion;
  axis: THREE.Vector3;
}

interface ProceduralRig {
  hips: THREE.Bone;
  hipsPosition: THREE.Vector3;
  spine: BonePose;
  leftArm: BonePose;
  rightArm: BonePose;
  leftUpLeg: BonePose;
  rightUpLeg: BonePose;
  leftLeg: BonePose;
  rightLeg: BonePose;
}

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

      const rig = createSafeNeutralRig(model);
      const animationDriver = findFirstMesh(model);
      if (rig && animationDriver) {
        attachProceduralAnimation(animationDriver, rig, player, carryMeshes);
      } else {
        console.warn('The character rig is incomplete; the imported model will remain visible without animation.');
      }

      model.visible = true;
      model.traverse((object) => {
        object.visible = true;
      });

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

function createSafeNeutralRig(model: THREE.Group): ProceduralRig | null {
  const hips = findBone(model, 'mixamorig:Hips');
  const spine = findBone(model, 'mixamorig:Spine1');
  const leftArm = findBone(model, 'mixamorig:LeftArm');
  const rightArm = findBone(model, 'mixamorig:RightArm');
  const leftForeArm = findBone(model, 'mixamorig:LeftForeArm');
  const rightForeArm = findBone(model, 'mixamorig:RightForeArm');
  const leftUpLeg = findBone(model, 'mixamorig:LeftUpLeg');
  const rightUpLeg = findBone(model, 'mixamorig:RightUpLeg');
  const leftLeg = findBone(model, 'mixamorig:LeftLeg');
  const rightLeg = findBone(model, 'mixamorig:RightLeg');

  if (
    !hips ||
    !spine ||
    !leftArm ||
    !rightArm ||
    !leftForeArm ||
    !rightForeArm ||
    !leftUpLeg ||
    !rightUpLeg ||
    !leftLeg ||
    !rightLeg
  ) {
    return null;
  }

  // These local quaternions were calculated directly from this GLB's bind
  // transforms. They put the arms beside the torso without changing bone
  // positions or reconstructing the skeleton in world space.
  leftArm.quaternion.set(
    0.514609040844121,
    -0.06938079420932994,
    -0.015809553004225704,
    0.8544670259935039,
  );
  leftForeArm.quaternion.set(
    0.03683327763099304,
    0.017645418734948123,
    0.015873483803660646,
    0.9990395294324251,
  );
  rightArm.quaternion.set(
    0.5105742618040504,
    -0.06703580380975946,
    -0.06579503304319079,
    0.8546877428731934,
  );
  rightForeArm.quaternion.set(
    0.025960883264251725,
    -0.15508179740811862,
    -0.03057245772925411,
    0.9870871255776769,
  );
  model.updateMatrixWorld(true);

  return {
    hips,
    hipsPosition: hips.position.clone(),
    spine: createBonePose(spine, LOCAL_TWIST_AXIS),
    leftArm: createBonePose(leftArm, LOCAL_SWING_AXIS),
    rightArm: createBonePose(rightArm, LOCAL_SWING_AXIS),
    leftUpLeg: createBonePose(leftUpLeg, LOCAL_SWING_AXIS),
    rightUpLeg: createBonePose(rightUpLeg, LOCAL_SWING_AXIS),
    leftLeg: createBonePose(leftLeg, LOCAL_SWING_AXIS),
    rightLeg: createBonePose(rightLeg, LOCAL_SWING_AXIS),
  };
}

function createBonePose(bone: THREE.Bone, axis: THREE.Vector3): BonePose {
  return {
    bone,
    neutral: bone.quaternion.clone(),
    axis: axis.clone(),
  };
}

function attachProceduralAnimation(
  animationDriver: THREE.Mesh,
  rig: ProceduralRig,
  player: THREE.Group,
  carryMeshes: THREE.Mesh[],
): void {
  let previousPosition = player.position.clone();
  let previousTime = performance.now() * 0.001;
  let walkPhase = 0;
  let idlePhase = 0;
  let movementBlend = 0;

  animationDriver.onBeforeRender = () => {
    const currentTime = performance.now() * 0.001;
    const delta = Math.min(Math.max(currentTime - previousTime, 0), 0.05);
    if (delta <= 0) return;

    const distance = player.position.distanceTo(previousPosition);
    const targetMovement = THREE.MathUtils.clamp(
      distance / (delta * MODEL_FORWARD_SPEED),
      0,
      1,
    );
    const blendAlpha = 1 - Math.exp(-delta * 12);
    movementBlend = THREE.MathUtils.lerp(movementBlend, targetMovement, blendAlpha);

    idlePhase += delta * 2;
    walkPhase += delta * THREE.MathUtils.lerp(4, 9.5, movementBlend);

    const step = Math.sin(walkPhase);
    const carrying = carryMeshes.some((mesh) => mesh.visible);
    const armAmplitude = carrying ? 0.18 : 0.28;
    const legAmplitude = 0.3;
    const idleArmMotion = Math.sin(idlePhase) * 0.012 * (1 - movementBlend);
    const poseAlpha = 1 - Math.exp(-delta * 18);

    applyLocalBonePose(
      rig.leftArm,
      (-step * armAmplitude * movementBlend) + idleArmMotion,
      poseAlpha,
    );
    applyLocalBonePose(
      rig.rightArm,
      (step * armAmplitude * movementBlend) - idleArmMotion,
      poseAlpha,
    );

    applyLocalBonePose(rig.leftUpLeg, step * legAmplitude * movementBlend, poseAlpha);
    applyLocalBonePose(rig.rightUpLeg, -step * legAmplitude * movementBlend, poseAlpha);

    const leftKnee = Math.max(0, -step) * 0.22 * movementBlend;
    const rightKnee = Math.max(0, step) * 0.22 * movementBlend;
    applyLocalBonePose(rig.leftLeg, leftKnee, poseAlpha);
    applyLocalBonePose(rig.rightLeg, rightKnee, poseAlpha);

    const torsoTwist = step * 0.025 * movementBlend;
    const idleSway = Math.sin(idlePhase * 0.55) * 0.006 * (1 - movementBlend);
    applyLocalBonePose(rig.spine, torsoTwist + idleSway, poseAlpha);

    const walkBob = Math.abs(Math.sin(walkPhase)) * 0.004 * movementBlend;
    const idleBreath = Math.sin(idlePhase) * 0.0012 * (1 - movementBlend);
    rig.hips.position.copy(rig.hipsPosition);
    rig.hips.position.y += walkBob + idleBreath;

    previousPosition.copy(player.position);
    previousTime = currentTime;
  };
}

function applyLocalBonePose(pose: BonePose, angle: number, alpha: number): void {
  const offset = new THREE.Quaternion().setFromAxisAngle(pose.axis, angle);
  const target = pose.neutral.clone().multiply(offset);
  pose.bone.quaternion.slerp(target, alpha);
}

function findBone(root: THREE.Object3D, name: string): THREE.Bone | null {
  const object = root.getObjectByName(name);
  return object instanceof THREE.Bone ? object : null;
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
