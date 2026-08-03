import './style.css';
import { Game } from './game/Game';

const root = document.getElementById('game-root');

if (!root) {
  throw new Error('Game root element was not found.');
}

new Game(root);
