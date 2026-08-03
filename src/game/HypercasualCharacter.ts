import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const COLORS = {
  body: 0xaeb4bc,
  light: 0xd9dde2,
  dark: 0x747b85,
  shadow: 0x30343a,
};

const MODEL_URL = `${import.meta.env.BASE_URL}models/hyper-casual-character.glb`;
const TARGET_MODEL_HEIGHT = 2.35;
const WALK_REFERENCE_SPEED = 4.6;

/**
 * Resting place of the nth carried item, in the player's local space. Three
 * columns keep even a large stack inside the character's silhouette instead of
 * towering over their head, and the height lines up with the carrying pose's
 * forearms.
 */
export function carrySlot(index: number): THREE.Vector3 {
  return new THREE.Vector3(
    ((index % 3) - 1) * 0.24,
    // Low enough that a full stack stays under the chin, and far enough forward
    // that the items clear the chest instead of intersecting it.
    1.16 + Math.floor(index / 3) * 0.2,
    0.62,
  );
}

/** Character-space axes: +X is the character's left, +Y is up, +Z is forward. */
const CHARACTER_RIGHT = new THREE.Vector3(1, 0, 0);
const CHARACTER_UP = new THREE.Vector3(0, 1, 0);
const CHARACTER_FORWARD = new THREE.Vector3(0, 0, 1);
const DEFAULT_BONE_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Rest directions for the idle pose, expressed in character space. The imported
 * GLB is bound with both elbows folded and the hands resting on the hips, so the
 * arm chain has to be re-aimed before any animation can read as natural.
 */
const IDLE_AIM = {
  leftArm: new THREE.Vector3(0.2, -0.97, 0.02),
  leftForeArm: new THREE.Vector3(0.12, -0.98, 0.14),
  leftHand: new THREE.Vector3(0.08, -0.98, 0.16),
  rightArm: new THREE.Vector3(-0.2, -0.97, 0.02),
  rightForeArm: new THREE.Vector3(-0.12, -0.98, 0.14),
  rightHand: new THREE.Vector3(-0.08, -0.98, 0.16),
} as const;

export type CharacterUpdate = (delta: number) => void;

export interface CharacterAnimator {
  update(delta: number): void;
  /** Short bend towards the ground, played when an item is collected. */
  playPickup(): void;
  /** Short forward reach, played when an item is thrown into a station. */
  playDrop(): void;
}

type GestureKind = 'pickup' | 'drop';

interface GestureState {
  kind: GestureKind | null;
  time: number;
  duration: number;
}

const GESTURE_DURATION: Record<GestureKind, number> = {
  pickup: 0.55,
  drop: 0.42,
};

/** A bone plus the character-space axes resolved into its parent's space. */
interface AnimatedBone {
  bone: THREE.Bone;
  rest: THREE.Quaternion;
  /** Sagittal swing axis - forward/backward limb motion. */
  swing: THREE.Vector3;
  /** Vertical axis - twisting. */
  twist: THREE.Vector3;
  /** Lateral axis - sideways lean and splay. */
  lean: THREE.Vector3;
}

interface CharacterRig {
  hips: THREE.Bone;
  hipsRestPosition: THREE.Vector3;
  spine: AnimatedBone;
  spine2: AnimatedBone;
  leftArm: AnimatedBone;
  rightArm: AnimatedBone;
  leftForeArm: AnimatedBone;
  rightForeArm: AnimatedBone;
  leftUpLeg: AnimatedBone;
  rightUpLeg: AnimatedBone;
  leftLeg: AnimatedBone;
  rightLeg: AnimatedBone;
  leftFoot: AnimatedBone;
  rightFoot: AnimatedBone;
}

export function buildHypercasualCharacter(
  player: THREE.Group,
  getCarryCount: () => number,
): CharacterAnimator {
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

  const fallback = createFallbackCharacter();
  player.add(fallback.group);

  const gesture: GestureState = { kind: null, time: 0, duration: 0 };
  const tracker = createMotionTracker(player);
  let activeUpdate: CharacterUpdate = createFallbackUpdate(fallback, tracker, getCarryCount);

  const loader = new GLTFLoader();
  loader.load(
    MODEL_URL,
    (gltf) => {
      const model = gltf.scene;
      prepareModel(model);

      const rig = createRig(model);
      if (rig) {
        activeUpdate = createRigUpdate(rig, tracker, getCarryCount, gesture);
      } else {
        console.warn(
          'The character rig is incomplete; the imported model stays visible but is not animated.',
        );
      }

      player.add(model);
      player.remove(fallback.group);
      disposeGroup(fallback);
    },
    undefined,
    (error) => {
      console.error('Hypercasual character model could not be loaded.', error);
    },
  );

  const startGesture = (kind: GestureKind) => {
    // Restarting an in-flight gesture keeps rapid pickups feeling responsive.
    gesture.kind = kind;
    gesture.time = 0;
    gesture.duration = GESTURE_DURATION[kind];
  };

  return {
    update(delta: number) {
      if (gesture.kind) {
        gesture.time += delta;
        if (gesture.time >= gesture.duration) gesture.kind = null;
      }
      activeUpdate(delta);
    },
    playPickup: () => startGesture('pickup'),
    playDrop: () => startGesture('drop'),
  };
}

function prepareModel(model: THREE.Group): void {
  // The rig's shoulders and hips spread along X and the toes point towards +Z,
  // so the model already faces the same direction the game treats as forward.
  // No yaw correction is applied here on purpose.
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
      // Skinned bounds are computed from the bind pose, so the animated mesh
      // would flicker at the screen edges without this.
      object.frustumCulled = false;
    }
  });
}

function createRig(model: THREE.Group): CharacterRig | null {
  const bones = {
    hips: findBone(model, 'mixamorig:Hips'),
    spine: findBone(model, 'mixamorig:Spine'),
    spine2: findBone(model, 'mixamorig:Spine2'),
    leftArm: findBone(model, 'mixamorig:LeftArm'),
    rightArm: findBone(model, 'mixamorig:RightArm'),
    leftForeArm: findBone(model, 'mixamorig:LeftForeArm'),
    rightForeArm: findBone(model, 'mixamorig:RightForeArm'),
    leftHand: findBone(model, 'mixamorig:LeftHand'),
    rightHand: findBone(model, 'mixamorig:RightHand'),
    leftUpLeg: findBone(model, 'mixamorig:LeftUpLeg'),
    rightUpLeg: findBone(model, 'mixamorig:RightUpLeg'),
    leftLeg: findBone(model, 'mixamorig:LeftLeg'),
    rightLeg: findBone(model, 'mixamorig:RightLeg'),
    leftFoot: findBone(model, 'mixamorig:LeftFoot'),
    rightFoot: findBone(model, 'mixamorig:RightFoot'),
  };

  for (const bone of Object.values(bones)) {
    if (!bone) return null;
  }

  // The reference frame the pose is authored in. Taking it from the model keeps
  // the maths correct even if a yaw offset is reintroduced later.
  const reference = model.getWorldQuaternion(new THREE.Quaternion());

  // Unfold the arms first: aim parents before children so each bone is aimed
  // against an already-settled parent.
  const aimOrder: Array<[THREE.Bone, THREE.Vector3]> = [
    [bones.leftArm as THREE.Bone, IDLE_AIM.leftArm],
    [bones.leftForeArm as THREE.Bone, IDLE_AIM.leftForeArm],
    [bones.leftHand as THREE.Bone, IDLE_AIM.leftHand],
    [bones.rightArm as THREE.Bone, IDLE_AIM.rightArm],
    [bones.rightForeArm as THREE.Bone, IDLE_AIM.rightForeArm],
    [bones.rightHand as THREE.Bone, IDLE_AIM.rightHand],
  ];

  for (const [bone, direction] of aimOrder) {
    aimBone(model, bone, direction, reference);
  }

  return {
    hips: bones.hips as THREE.Bone,
    hipsRestPosition: (bones.hips as THREE.Bone).position.clone(),
    spine: createAnimatedBone(bones.spine as THREE.Bone, reference),
    spine2: createAnimatedBone(bones.spine2 as THREE.Bone, reference),
    leftArm: createAnimatedBone(bones.leftArm as THREE.Bone, reference),
    rightArm: createAnimatedBone(bones.rightArm as THREE.Bone, reference),
    leftForeArm: createAnimatedBone(bones.leftForeArm as THREE.Bone, reference),
    rightForeArm: createAnimatedBone(bones.rightForeArm as THREE.Bone, reference),
    leftUpLeg: createAnimatedBone(bones.leftUpLeg as THREE.Bone, reference),
    rightUpLeg: createAnimatedBone(bones.rightUpLeg as THREE.Bone, reference),
    leftLeg: createAnimatedBone(bones.leftLeg as THREE.Bone, reference),
    rightLeg: createAnimatedBone(bones.rightLeg as THREE.Bone, reference),
    leftFoot: createAnimatedBone(bones.leftFoot as THREE.Bone, reference),
    rightFoot: createAnimatedBone(bones.rightFoot as THREE.Bone, reference),
  };
}

/**
 * Rotates a bone so that it points along `direction` (given in character space)
 * using the shortest rotation, which preserves the bone's bind-pose roll.
 */
function aimBone(
  model: THREE.Group,
  bone: THREE.Bone,
  direction: THREE.Vector3,
  reference: THREE.Quaternion,
): void {
  const parent = bone.parent;
  if (!parent) return;

  model.updateMatrixWorld(true);

  const desired = direction.clone().normalize().applyQuaternion(reference);
  const worldQuaternion = bone.getWorldQuaternion(new THREE.Quaternion());
  const current = boneAxis(bone).applyQuaternion(worldQuaternion).normalize();

  const correction = new THREE.Quaternion().setFromUnitVectors(current, desired);
  const targetWorld = correction.multiply(worldQuaternion);
  const parentWorld = parent.getWorldQuaternion(new THREE.Quaternion());

  bone.quaternion.copy(parentWorld.invert().multiply(targetWorld));
  model.updateMatrixWorld(true);
}

/**
 * Captures the bone's rest pose and expresses the character-space axes in the
 * bone's parent space. Rotating around those axes then produces anatomically
 * correct motion no matter how the bone's own roll happens to be baked in.
 */
function createAnimatedBone(bone: THREE.Bone, reference: THREE.Quaternion): AnimatedBone {
  const parent = bone.parent;
  const parentWorld = parent
    ? parent.getWorldQuaternion(new THREE.Quaternion())
    : new THREE.Quaternion();
  const toParentSpace = parentWorld.invert().multiply(reference);

  return {
    bone,
    rest: bone.quaternion.clone(),
    swing: CHARACTER_RIGHT.clone().applyQuaternion(toParentSpace).normalize(),
    twist: CHARACTER_UP.clone().applyQuaternion(toParentSpace).normalize(),
    lean: CHARACTER_FORWARD.clone().applyQuaternion(toParentSpace).normalize(),
  };
}

/** Direction the bone points in its own local space, taken from its first child. */
function boneAxis(bone: THREE.Bone): THREE.Vector3 {
  const child = bone.children.find((item) => item instanceof THREE.Bone) as THREE.Bone | undefined;
  if (!child || child.position.lengthSq() < 1e-8) return DEFAULT_BONE_AXIS.clone();
  return child.position.clone().normalize();
}

interface MotionTracker {
  /** 0 while standing still, 1 at full running speed. */
  blend: number;
  sample(delta: number): number;
}

function createMotionTracker(player: THREE.Group): MotionTracker {
  // Only the horizontal plane counts: the game applies a vertical bob to the
  // player group that would otherwise register as movement.
  let previousX = player.position.x;
  let previousZ = player.position.z;

  return {
    blend: 0,
    sample(delta: number): number {
      const dx = player.position.x - previousX;
      const dz = player.position.z - previousZ;
      previousX = player.position.x;
      previousZ = player.position.z;

      if (delta <= 0) return this.blend;

      const speed = Math.hypot(dx, dz) / delta;
      const target = THREE.MathUtils.clamp(speed / WALK_REFERENCE_SPEED, 0, 1);
      const alpha = 1 - Math.exp(-delta * 11);
      this.blend = THREE.MathUtils.lerp(this.blend, target, alpha);
      return this.blend;
    },
  };
}

function createRigUpdate(
  rig: CharacterRig,
  tracker: MotionTracker,
  getCarryCount: () => number,
  gesture: GestureState,
): CharacterUpdate {
  let walkPhase = 0;
  let idlePhase = 0;
  let carryBlend = 0;

  const target = new THREE.Quaternion();

  return (delta: number) => {
    if (delta <= 0) return;

    const moving = tracker.sample(delta);
    const idle = 1 - moving;

    const carrying = getCarryCount() > 0 ? 1 : 0;
    carryBlend = THREE.MathUtils.lerp(carryBlend, carrying, 1 - Math.exp(-delta * 7));

    // Gestures ride on top of the idle/walk/carry blend as a single hump, so
    // they read clearly without ever snapping the pose.
    const envelope = gesture.kind
      ? Math.sin(Math.PI * THREE.MathUtils.clamp(gesture.time / gesture.duration, 0, 1))
      : 0;
    const pickup = gesture.kind === 'pickup' ? envelope : 0;
    const drop = gesture.kind === 'drop' ? envelope : 0;

    idlePhase += delta * 1.9;
    // Stride rate rises with speed so the feet do not skate.
    walkPhase += delta * THREE.MathUtils.lerp(5.5, 10.5, moving);

    const step = Math.sin(walkPhase);
    const doubleStep = Math.sin(walkPhase * 2);
    const breath = Math.sin(idlePhase);
    const sway = Math.sin(idlePhase * 0.6);
    const alpha = 1 - Math.exp(-delta * 16);

    // --- Arms -------------------------------------------------------------
    // Swinging around the character's own left/right axis keeps the motion in
    // the sagittal plane; the old code rotated around each bone's local Z,
    // which made the arms flap outwards instead of forwards.
    const armSwing = 0.62 * moving * (1 - carryBlend * 0.65);
    const armIdle = breath * 0.05 * idle;
    // Carrying keeps the upper arms almost vertical and folds the elbows to
    // roughly a right angle, which puts the forearms level with the cargo stack
    // instead of raising the hands up to the shoulders.
    const carryLift = carryBlend * 0.2;
    const carrySplay = carryBlend * 0.1;

    // The torso bend already carries the arms forward on a pickup, so they only
    // need a little extra; a drop is all arms and no bend.
    const reach = -pickup * 0.25 - drop * 0.85;

    applyPose(rig.leftArm, target, {
      swing: -step * armSwing + armIdle - carryLift + reach,
      lean: -armIdle * 0.4 - carrySplay,
      alpha,
    });
    applyPose(rig.rightArm, target, {
      swing: step * armSwing - armIdle - carryLift + reach,
      lean: armIdle * 0.4 + carrySplay,
      alpha,
    });

    // Elbows follow the swing slightly and fold up when carrying cargo.
    const elbowSwing = Math.max(0, -step) * 0.3 * moving;
    const elbowCarry = carryBlend * 1.45;
    // Both gestures straighten the elbows out of the carrying fold.
    const elbowExtend = (pickup * 0.9 + drop * 1.1) * carryBlend + pickup * 0.25;
    applyPose(rig.leftForeArm, target, {
      swing: -elbowSwing - elbowCarry - breath * 0.02 * idle + elbowExtend,
      alpha,
    });
    applyPose(rig.rightForeArm, target, {
      swing: -Math.max(0, step) * 0.3 * moving - elbowCarry - breath * 0.02 * idle + elbowExtend,
      alpha,
    });

    // --- Legs -------------------------------------------------------------
    // A positive swing rotates a downward bone towards -Z, so positive means
    // "backwards" for the whole leg chain.
    const legSwing = 0.55 * moving;
    applyPose(rig.leftUpLeg, target, { swing: step * legSwing, alpha });
    applyPose(rig.rightUpLeg, target, { swing: -step * legSwing, alpha });

    // A knee may only fold backwards, so the bend has to stay positive. It
    // peaks midway through the airborne swing - when the thigh is travelling
    // from back to front, which is `-cos` for the left leg and `+cos` for the
    // right - and returns to zero for the straight-legged stance phase.
    const lift = Math.cos(walkPhase);
    const leftLift = Math.max(0, -lift);
    const rightLift = Math.max(0, lift);
    // Pickups add a symmetric knee fold on top, turning the spine bend into a
    // squat rather than a stiff hinge at the waist.
    const crouch = pickup * 0.3;
    applyPose(rig.leftLeg, target, { swing: leftLift * 1.0 * moving + crouch, alpha });
    applyPose(rig.rightLeg, target, { swing: rightLift * 1.0 * moving + crouch, alpha });

    // Ankles follow the same phase: toes lift while the foot is in the air and
    // point down as the leg pushes off behind the body.
    applyPose(rig.leftFoot, target, { swing: -lift * 0.22 * moving, alpha });
    applyPose(rig.rightFoot, target, { swing: lift * 0.22 * moving, alpha });

    // --- Torso ------------------------------------------------------------
    applyPose(rig.spine, target, {
      twist: -step * 0.12 * moving + sway * 0.03 * idle,
      lean: sway * 0.02 * idle,
      // Bending for a pickup, straightening back for a throw.
      swing: moving * 0.09 + carryBlend * 0.05 + pickup * 0.85 - drop * 0.16,
      alpha,
    });
    applyPose(rig.spine2, target, {
      twist: step * 0.07 * moving,
      swing: breath * 0.015 * idle,
      alpha,
    });

    // --- Hips -------------------------------------------------------------
    // Two bobs per stride, plus a slow breathing rise while standing.
    const bob = -doubleStep * 0.018 * moving;
    const breathe = breath * 0.006 * idle;
    rig.hips.position.copy(rig.hipsRestPosition);
    // A small hip dip completes the crouch. It stays small on purpose: the legs
    // hang off the hips, so dipping further than the knee fold shortens the leg
    // by would push the feet through the ground.
    rig.hips.position.y += bob + breathe - pickup * 0.03;
  };
}

interface PoseInput {
  swing?: number;
  twist?: number;
  lean?: number;
  alpha: number;
}

const poseScratch = new THREE.Quaternion();

function applyPose(animated: AnimatedBone, target: THREE.Quaternion, input: PoseInput): void {
  target.copy(animated.rest);

  if (input.swing) {
    target.premultiply(poseScratch.setFromAxisAngle(animated.swing, input.swing));
  }
  if (input.lean) {
    target.premultiply(poseScratch.setFromAxisAngle(animated.lean, input.lean));
  }
  if (input.twist) {
    target.premultiply(poseScratch.setFromAxisAngle(animated.twist, input.twist));
  }

  animated.bone.quaternion.slerp(target, input.alpha);
}

/**
 * Looks a bone up by its authored name.
 *
 * GLTFLoader runs every node name through `PropertyBinding.sanitizeNodeName`,
 * which strips the characters `[ ] . : /`. The bones in this GLB are authored as
 * `mixamorig:Hips`, so they arrive in the scene graph as `mixamorigHips` and an
 * exact `getObjectByName('mixamorig:Hips')` never matches. Comparing normalised
 * names makes the lookup work for both spellings.
 */
function findBone(root: THREE.Object3D, name: string): THREE.Bone | null {
  const wanted = normaliseBoneName(name);
  let match: THREE.Bone | null = null;

  root.traverse((object) => {
    if (match || !(object instanceof THREE.Bone)) return;
    if (normaliseBoneName(object.name) === wanted) match = object;
  });

  return match;
}

function normaliseBoneName(name: string): string {
  return name.replace(/[[\].:/\s_]/g, '').toLowerCase();
}

interface FallbackParts {
  group: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
}

function createFallbackCharacter(): FallbackParts {
  const group = new THREE.Group();

  const torso = capsule(0.31, 0.58, COLORS.body);
  torso.position.y = 1.12;
  group.add(torso);

  const head = sphere(0.49, COLORS.light);
  head.position.y = 1.98;
  group.add(head);

  const backpack = box(0.56, 0.6, 0.25, COLORS.dark);
  backpack.position.set(0, 1.1, 0.37);
  group.add(backpack);

  const leftArm = limb(-0.47, 1.45, -0.15, COLORS.light, 0.11, 0.62);
  const rightArm = limb(0.47, 1.45, 0.15, COLORS.light, 0.11, 0.62);
  const leftLeg = limb(-0.18, 0.83, 0, COLORS.dark, 0.13, 0.67);
  const rightLeg = limb(0.18, 0.83, 0, COLORS.dark, 0.13, 0.67);
  group.add(leftArm, rightArm, leftLeg, rightLeg);

  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  return { group, leftArm, rightArm, leftLeg, rightLeg };
}

function createFallbackUpdate(
  parts: FallbackParts,
  tracker: MotionTracker,
  getCarryCount: () => number,
): CharacterUpdate {
  let phase = 0;

  return (delta: number) => {
    if (delta <= 0) return;

    const moving = tracker.sample(delta);
    phase += delta * (3 + moving * 8.5);

    const carrying = getCarryCount() > 0;
    const armAmount = carrying ? 0.48 : 0.72;
    const swing = Math.sin(phase);
    const alpha = 1 - Math.exp(-delta * 16);

    parts.leftArm.rotation.x = THREE.MathUtils.lerp(
      parts.leftArm.rotation.x,
      swing * armAmount * moving,
      alpha,
    );
    parts.rightArm.rotation.x = THREE.MathUtils.lerp(
      parts.rightArm.rotation.x,
      -swing * armAmount * moving,
      alpha,
    );
    parts.leftLeg.rotation.x = THREE.MathUtils.lerp(
      parts.leftLeg.rotation.x,
      -swing * 0.62 * moving,
      alpha,
    );
    parts.rightLeg.rotation.x = THREE.MathUtils.lerp(
      parts.rightLeg.rotation.x,
      swing * 0.62 * moving,
      alpha,
    );
  };
}

function disposeGroup(parts: FallbackParts): void {
  parts.group.traverse((object) => {
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
  return new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 6, 12), material(color));
}

function sphere(radius: number, color: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 16), material(color));
}

function box(width: number, height: number, depth: number, color: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth, 2, 2, 2), material(color));
}

function material(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.82,
    metalness: 0,
    flatShading: false,
  });
}
