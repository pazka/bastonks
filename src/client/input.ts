// Keyboard + mouse and touch (virtual stick + buttons), merged into one intent per frame.

export interface Intent {
  /** Move on the camera-relative XZ plane, each in [-1, 1] (y = forward). */
  mx: number;
  my: number;
  up: boolean;
  down: boolean;
  /** Edge-triggered (true for one frame): holding a key or a button never repeats. */
  upPressed: boolean;
  downPressed: boolean;
  inspect: boolean;
  /** Camera orbit deltas (radians) accumulated since last frame. */
  yaw: number;
  pitch: number;
  zoom: number;
}

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private zoom = 0;
  private stick = { id: -1, x0: 0, y0: 0, x: 0, y: 0 };
  private look = { id: -1, x: 0, y: 0 };
  private touchUp = false;
  private touchDown = false;
  private touchUpPressed = false;
  private touchDownPressed = false;
  private touchInspect = false;
  private dragging = false;
  enabled = true;
  /** Mouse look multipliers: 1 = default feel, -1 = inverted axis (player preference). */
  lookX = 1;
  lookY = 1;
  touchMode = false;
  onAnyGesture: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement, private stickEl: HTMLElement, private knob: HTMLElement) {
    addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, button, a")) {
        if (e.key !== "Escape") return;
      }
      this.onAnyGesture?.();
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
    });
    addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener("blur", () => this.keys.clear());

    canvas.addEventListener("pointerdown", (e) => {
      this.onAnyGesture?.();
      if (e.pointerType === "touch") return this.touchStart(e);
      this.dragging = true;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return this.touchMove(e);
      if (!this.dragging) return;
      // computer default: horizontal drag turns the other way, vertical follows the drag (each axis can be
      // inverted in Controls; touch has its own directions)
      this.yaw -= e.movementX * 0.005 * this.lookX;
      this.pitch += e.movementY * 0.004 * this.lookY;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerType === "touch") return this.touchEnd(e);
      this.dragging = false;
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    // wheel / trackpad: zoom the camera in and out (anywhere but over the panel or a dialog, which scroll)
    addEventListener("wheel", (e) => {
      if ((e.target as HTMLElement)?.closest?.("#panel, dialog")) return;
      const step = Math.max(-1, Math.min(1, e.deltaY / (e.deltaMode === 1 ? 3 : 100)));
      this.zoom += step * 0.14;
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private touchStart(e: PointerEvent) {
    this.touchMode = true;
    document.body.classList.add("touch");
    const left = e.clientX < innerWidth * 0.45;
    if (left && this.stick.id < 0) {
      this.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
      this.stickEl.style.left = `${e.clientX}px`;
      this.stickEl.style.top = `${e.clientY}px`;
      this.stickEl.classList.add("on");
    } else if (this.look.id < 0) {
      this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }
    this.canvas.setPointerCapture(e.pointerId);
  }
  private touchMove(e: PointerEvent) {
    if (e.pointerId === this.stick.id) {
      this.stick.x = e.clientX;
      this.stick.y = e.clientY;
      const [dx, dy] = this.stickVec();
      this.knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
    } else if (e.pointerId === this.look.id) {
      // touch: horizontal drag turns the view with the finger; vertical drag is inverted from the mouse
      this.yaw -= (e.clientX - this.look.x) * 0.008;
      this.pitch += (e.clientY - this.look.y) * 0.006;
      this.look.x = e.clientX;
      this.look.y = e.clientY;
    }
  }
  private touchEnd(e: PointerEvent) {
    if (e.pointerId === this.stick.id) {
      this.stick.id = -1;
      this.stickEl.classList.remove("on");
      this.knob.style.transform = "";
    }
    if (e.pointerId === this.look.id) this.look.id = -1;
  }
  private stickVec(): [number, number] {
    if (this.stick.id < 0) return [0, 0];
    let dx = (this.stick.x - this.stick.x0) / 40, dy = (this.stick.y - this.stick.y0) / 40;
    const l = Math.hypot(dx, dy);
    if (l > 1) {
      dx /= l;
      dy /= l;
    }
    return l < 0.15 ? [0, 0] : [dx, dy];
  }

  /** Touch buttons (▲ ▼ inspect) call these. */
  setTouchButton(which: "up" | "down", on: boolean) {
    if (which === "up") {
      if (on && !this.touchUp) this.touchUpPressed = true;
      this.touchUp = on;
    } else {
      if (on && !this.touchDown) this.touchDownPressed = true;
      this.touchDown = on;
    }
  }
  tapInspect() {
    this.touchInspect = true;
  }

  read(): Intent {
    const k = this.keys;
    const has = (...names: string[]) => names.some((n) => k.has(n));
    const pr = (...names: string[]) => names.some((n) => this.pressed.has(n));
    let mx = (has("d", "arrowright") ? 1 : 0) - (has("a", "q", "arrowleft") ? 1 : 0);
    let my = (has("w", "z", "arrowup") ? 1 : 0) - (has("s", "arrowdown") ? 1 : 0);
    const [sx, sy] = this.stickVec();
    mx += sx;
    my -= sy;
    const l = Math.hypot(mx, my);
    if (l > 1) {
      mx /= l;
      my /= l;
    }
    const out: Intent = {
      mx: this.enabled ? mx : 0,
      my: this.enabled ? my : 0,
      up: this.enabled && (has(" ") || this.touchUp),
      down: this.enabled && (has("shift", "control", "c") || this.touchDown),
      upPressed: this.enabled && (pr(" ") || this.touchUpPressed),
      downPressed: this.enabled && (pr("shift", "control", "c") || this.touchDownPressed),
      inspect: this.enabled && (pr("e", "enter") || this.touchInspect),
      yaw: this.yaw,
      pitch: this.pitch,
      zoom: this.zoom,
    };
    this.pressed.clear();
    this.touchUpPressed = false;
    this.touchDownPressed = false;
    this.touchInspect = false;
    this.yaw = this.pitch = this.zoom = 0;
    return out;
  }

  /** Was this key pressed this frame (for UI shortcuts handled by the caller)? */
  isDown(key: string) {
    return this.keys.has(key);
  }
}
