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

interface BonePose {
  bone: THREE.Bone;
  neutral: THREE.Quaternion;
  swingAxis: THREE.Vector3;
}

interface ProceduralRig {
  hips: THREE.Bone;
  hipsPosition: THREE.Vector3;
  spine: BonePose;
  leftArm: BonePose;
  rightArm: BonePose;
  leftForeArm: BonePose;
  rightForeArm: BonePose;
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
      resetSkeletonPose(model);

      const rig = createNeutralRig(model);
      const animationDriver = findFirstMesh(model);
      if (rig && animationDriver) {
        attachProceduralAnimation(animationDriver, rig, player, carryMeshes);
      } else {
        console.warn('The character rig is incomplete; the model will remain in its neutral pose.');
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

function resetSkeletonPose(model: THREE.Group): void {
  model.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) {
      object.skeleton.pose();
    }
  });
  model.updateMatrixWorld(true);
}

function createNeutralRig(model: THREE.Group): ProceduralRig | null {
  const hips = findBone(model, 'mixamorig:Hips');
  const spine = findBone(model, 'mixamorig:Spine1');
  const leftArm = findBone(model, 'mixamorig:LeftArm');
  const rightArm = findBone(model, 'mixamorig:RightArm');
  const leftForeArm = findBone(model, 'mixamorig:LeftForeArm');
  const rightForeArm = findBone(model, 'mixamorig:RightForeArm');
  const leftHand = findBone(model, 'mixamorig:LeftHand');
  const rightHand = findBone(model, 'mixamorig:RightHand');
  const leftIndex = findBone(model, 'mixamorig:LeftHandIndex1');
  const rightIndex = findBone(model, 'mixamorig:RightHandIndex1');
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
    !leftHand ||
    !rightHand ||
    !leftIndex ||
    !rightIndex ||
    !leftUpLeg ||
    !rightUpLeg ||
    !leftLeg ||
    !rightLeg
  ) {
    return null;
  }

  // The source bind pose has both hands resting on the hips. Re-aim the
  // actual Mixamo bones to create a relaxed, arms-down neutral stance.
  alignBone(model, leftArm, leftForeArm, new THREE.Vector3(-0.14, -1, 0.06));
  alignBone(model, rightArm, rightForeArm, new THREE.Vector3(0.14, -1, 0.06));
  alignBone(model, leftForeArm, leftHand, new THREE.Vector3(0.035, -1, 0.12));
  alignBone(model, rightForeArm, rightHand, new THREE.Vector3(-0.035, -1, 0.12));
  alignBone(model, leftHand, leftIndex, new THREE.Vector3(0.02, -1, 0.08));
  alignBone(model, rightHand, rightIndex, new THREE.Vector3(-0.02, -1, 0.08));
  model.updateMatrixWorld(true);

  const forwardSwingAxis = new THREE.Vector3(1, 0, 0);
  const sideSwayAxis = new THREE.Vector3(0, 0, 1);

  return {
    hips,
    hipsPosition: hips.position.clone(),
    spine: createBonePose(spine, model, sideSwayAxis),
    leftArm: createBonePose(leftArm, model, forwardSwingAxis),
    rightArm: createBonePose(rightArm, model, forwardSwingAxis),
    leftForeArm: createBonePose(leftForeArm, model, forwardSwingAxis),
    rightForeArm: createBonePose(rightForeArm, model, forwardSwingAxis),
    leftUpLeg: createBonePose(leftUpLeg, model, forwardSwingAxis),
    rightUpLeg: createBonePose(rightUpLeg, model, forwardSwingAxis),
    leftLeg: createBonePose(leftLeg, model, forwardSwingAxis),
    rightLeg: createBonePose(rightLeg, model, forwardSwingAxis),
  };
}

function alignBone(
  model: THREE.Group,
  bone: THREE.Bone,
  child: THREE.Bone,
  desiredModelDirection: THREE.Vector3,
): void {
  model.updateMatrixWorld(true);

  const bonePosition = bone.getWorldPosition(new THREE.Vector3());
  const childPosition = child.getWorldPosition(new THREE.Vector3());
  const currentDirection = childPosition.sub(bonePosition).normalize();

  const modelWorldQuaternion = model.getWorldQuaternion(new THREE.Quaternion());
  const desiredWorldDirection = desiredModelDirection
    .clone()
    .normalize()
    .applyQuaternion(modelWorldQuaternion);

  const correction = new THREE.Quaternion().setFromUnitVectors(
    currentDirection,
    desiredWorldDirection,
  );
  const currentWorldQuaternion = bone.getWorldQuaternion(new THREE.Quaternion());
  const desiredWorldQuaternion = correction.multiply(currentWorldQuaternion);

  const parentWorldQuaternion = bone.parent
    ? bone.parent.getWorldQuaternion(new THREE.Quaternion())
    : new THREE.Quaternion();
  bone.quaternion.copy(parentWorldQuaternion.invert().multiply(desiredWorldQuaternion));
  bone.updateMatrixWorld(true);
}

function createBonePose(
  bone: THREE.Bone,
  model: THREE.Group,
  modelAxis: THREE.Vector3,
): BonePose {
  const modelWorldQuaternion = model.getWorldQuaternion(new THREE.Quaternion());
  const worldAxis = modelAxis.clone().normalize().applyQuaternion(modelWorldQuaternion);
  const parentWorldQuaternion = bone.parent
    ? bone.parent.getWorldQuaternion(new THREE.Quaternion())
    : new THREE.Quaternion();
  const swingAxis = worldAxis.applyQuaternion(parentWorldQuaternion.invert()).normalize();

  return {
    bone,
    neutral: bone.quaternion.clone(),
    swingAxis,
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
    const blendAlpha = 1 - Math.exp(-delta * 13);
    movementBlend = THREE.MathUtils.lerp(movementBlend, targetMovement, blendAlpha);

    idlePhase += delta * 2.15;
    walkPhase += delta * THREE.MathUtils.lerp(4.2, 10.5, movementBlend);

    const step = Math.sin(walkPhase);
    const carrying = carryMeshes.some((mesh) => mesh.visible);
    const armAmplitude = carrying ? 0.34 : 0.52;
    const legAmplitude = 0.46;
    const idleArmMotion = Math.sin(idlePhase) * 0.025 * (1 - movementBlend);
    const poseAlpha = 1 - Math.exp(-delta * 20);

    applyBonePose(
      rig.leftArm,
      (step * armAmplitude * movementBlend) + idleArmMotion,
      poseAlpha,
    );
    applyBonePose(
      rig.rightArm,
      (-step * armAmplitude * movementBlend) - idleArmMotion,
      poseAlpha,
    );

    const leftElbow = (0.045 + Math.max(0, -step) * 0.1) * movementBlend;
    const rightElbow = (0.045 + Math.max(0, step) * 0.1) * movementBlend;
    applyBonePose(rig.leftForeArm, leftElbow, poseAlpha);
    applyBonePose(rig.rightForeArm, rightElbow, poseAlpha);

    applyBonePose(rig.leftUpLeg, -step * legAmplitude * movementBlend, poseAlpha);
    applyBonePose(rig.rightUpLeg, step * legAmplitude * movementBlend, poseAlpha);

    const leftKnee = Math.max(0, step) * 0.58 * movementBlend;
    const rightKnee = Math.max(0, -step) * 0.58 * movementBlend;
    applyBonePose(rig.leftLeg, leftKnee, poseAlpha);
    applyBonePose(rig.rightLeg, rightKnee, poseAlpha);

    const sideSway = Math.sin(walkPhase * 0.5) * 0.035 * movementBlend;
    const idleSway = Math.sin(idlePhase * 0.55) * 0.01 * (1 - movementBlend);
    applyBonePose(rig.spine, sideSway + idleSway, poseAlpha);

    const walkBob = Math.abs(Math.sin(walkPhase)) * 0.006 * movementBlend;
    const idleBreath = Math.sin(idlePhase) * 0.0015 * (1 - movementBlend);
    rig.hips.position.copy(rig.hipsPosition);
    rig.hips.position.y += walkBob + idleBreath;

    previousPosition.copy(player.position);
    previousTime = currentTime;
  };
}

function applyBonePose(pose: BonePose, angle: number, alpha: number): void {
  const offset = new THREE.Quaternion().setFromAxisAngle(pose.swingAxis, angle);
  const target = offset.multiply(pose.neutral);
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
