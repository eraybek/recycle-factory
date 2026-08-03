export interface MovementVector {
  x: number;
  z: number;
}

export class MovementInput {
  private readonly keys = new Set<string>();
  private readonly touchVector: MovementVector = { x: 0, z: 0 };
  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private readonly radius = 40;

  constructor(
    private readonly zone: HTMLElement,
    private readonly base: HTMLElement,
    private readonly knob: HTMLElement,
  ) {
    this.zone.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove, { passive: false });
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerUp);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.reset);
  }

  public sample(): MovementVector {
    let keyboardX = 0;
    let keyboardZ = 0;

    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) keyboardX -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) keyboardX += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) keyboardZ -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) keyboardZ += 1;

    let x = this.touchVector.x + keyboardX;
    let z = this.touchVector.z + keyboardZ;
    const length = Math.hypot(x, z);

    if (length > 1) {
      x /= length;
      z /= length;
    }

    return { x, z };
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.pointerId !== null || event.button !== 0) return;

    const rect = this.zone.getBoundingClientRect();
    this.pointerId = event.pointerId;
    this.originX = event.clientX;
    this.originY = event.clientY;

    this.base.style.left = `${event.clientX - rect.left}px`;
    this.base.style.top = `${event.clientY - rect.top}px`;
    this.base.classList.add('active');
    this.zone.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;

    const dx = event.clientX - this.originX;
    const dy = event.clientY - this.originY;
    const distance = Math.hypot(dx, dy);
    const scale = distance > this.radius ? this.radius / distance : 1;
    const clampedX = dx * scale;
    const clampedY = dy * scale;

    this.touchVector.x = clampedX / this.radius;
    this.touchVector.z = clampedY / this.radius;
    this.knob.style.transform = `translate(calc(-50% + ${clampedX}px), calc(-50% + ${clampedY}px))`;
    event.preventDefault();
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.reset();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly reset = (): void => {
    this.pointerId = null;
    this.touchVector.x = 0;
    this.touchVector.z = 0;
    this.base.classList.remove('active');
    this.knob.style.transform = 'translate(-50%, -50%)';
  };
}
