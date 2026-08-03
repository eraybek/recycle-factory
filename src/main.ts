import * as THREE from 'three';
import './style.css';
import { Game } from './game/Game';

interface TunableGame {
  camera: THREE.PerspectiveCamera;
  player: THREE.Group;
  cameraDesired: THREE.Vector3;
  cameraLookTarget: THREE.Vector3;
  isMapView: boolean;
  updateCamera: (delta: number) => void;
}

const root = document.getElementById('game-root');

if (!root) {
  throw new Error('Game root element was not found.');
}

const game = new Game(root);
const tunedGame = game as unknown as TunableGame;

tunedGame.camera.fov = 50;
tunedGame.camera.updateProjectionMatrix();

tunedGame.updateCamera = function updateCamera(this: TunableGame, delta: number): void {
  if (this.isMapView) {
    this.cameraDesired.set(0, 28, 23);
    this.cameraLookTarget.set(0, 0, 2.5);
  } else {
    this.cameraDesired.set(
      this.player.position.x,
      this.player.position.y + 17.5,
      this.player.position.z + 13.5,
    );
    this.cameraLookTarget.set(
      this.player.position.x,
      this.player.position.y + 0.55,
      this.player.position.z - 2.4,
    );
  }

  const smoothing = 1 - Math.exp(-delta * 4.5);
  this.camera.position.lerp(this.cameraDesired, smoothing);
  this.camera.lookAt(this.cameraLookTarget);
};
