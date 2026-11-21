/**
 * Keyboard + gamepad + touch input.
 * Actions: up/down/left/right, sprint, pass, through, shoot, tackle, switch, pause.
 * Poll with isDown(action) / wasPressed(action) / wasReleased(action), then call endFrame().
 *
 * Gamepad (standard mapping): left stick / d-pad move, right stick aims,
 * A pass, B shoot (hold to charge), Y through ball, X tackle, RB or RT sprint,
 * LB switch player, Back pause.
 */

const KEYMAP = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  KeyZ: 'pass',
  KeyX: 'through',
  KeyC: 'shoot',
  // legacy bindings kept so muscle memory (and old scripts) still work
  KeyJ: 'pass',
  KeyK: 'through',
  Space: 'shoot',
  KeyE: 'tackle',
  Tab: 'switch',
  Escape: 'pause',
  KeyP: 'pause',
};

const PREVENT = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/* Gamepad button index -> action (standard mapping) */
const PAD_BUTTONS = {
  0: 'pass', // A / Cross
  1: 'shoot', // B / Circle
  2: 'tackle', // X / Square
  3: 'through', // Y / Triangle
  4: 'switch', // LB
  5: 'sprint', // RB
  6: 'sprint', // LT
  7: 'sprint', // RT
  8: 'pause', // Back / Share
  9: 'pause', // Start
  12: 'up',
  13: 'down',
  14: 'left',
  15: 'right',
};

const PAD_DEADZONE = 0.18;

export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.touch = { x: 0, y: 0, active: false };
    /** Auto-sprint (DLS layout): pushing the stick to the rim sprints. It holds
     *  `down` without raising a press edge, so it can never be mistaken for a
     *  sprint tap (which is the roulette double-tap gesture). */
    this.autoSprint = false;
    this.touchActions = new Set();
    this.enabled = true;
    this.anyInputCallback = null;
    this.pad = { x: 0, y: 0, active: false, aimX: 0, aimY: 0, connected: false, name: '' };
    this.onFrame = null; // per-frame hook (menus read the pad here)
    this._padHeld = new Set();
    this._keyHeld = new Set();
    this._bindKeyboard();
    this._bindTouch();
    this._bindGamepad();
  }

  _bindGamepad() {
    window.addEventListener('gamepadconnected', (e) => {
      this.pad.connected = true;
      this.pad.name = e.gamepad?.id || 'Gamepad';
      if (this.anyInputCallback) this.anyInputCallback();
      window.dispatchEvent(new CustomEvent('touchlinevale-gamepad', { detail: this.pad }));
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.pad.connected = false;
      this.pad.name = '';
      this._padHeld.clear();
      window.dispatchEvent(new CustomEvent('touchlinevale-gamepad', { detail: this.pad }));
    });
  }

  /** Sample the connected gamepad. Call once per frame before reading actions. */
  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) {
      if (p && p.connected) {
        pad = p;
        break;
      }
    }
    if (!pad) {
      if (this.pad.connected) {
        this.pad.connected = false;
        this.pad.x = this.pad.y = this.pad.aimX = this.pad.aimY = 0;
        this.pad.active = false;
      }
      return;
    }
    this.pad.connected = true;
    if (pad.id && pad.id !== this.pad.name) {
      this.pad.name = pad.id;
      window.dispatchEvent(new CustomEvent('touchlinevale-gamepad', { detail: this.pad }));
    }

    const stick = (x, y) => {
      const len = Math.hypot(x, y);
      if (len < PAD_DEADZONE) return { x: 0, y: 0 };
      const scaled = Math.min(1, (len - PAD_DEADZONE) / (1 - PAD_DEADZONE)) / len;
      return { x: x * scaled, y: y * scaled };
    };
    const move = stick(pad.axes[0] || 0, -(pad.axes[1] || 0));
    const aim = stick(pad.axes[2] || 0, -(pad.axes[3] || 0));
    let mx = move.x;
    let my = move.y;
    const btn = (i) => !!(pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.4));
    if (btn(12)) my = 1;
    if (btn(13)) my = -1;
    if (btn(14)) mx = -1;
    if (btn(15)) mx = 1;
    this.pad.x = mx;
    this.pad.y = my;
    this.pad.aimX = aim.x;
    this.pad.aimY = aim.y;
    this.pad.active = Math.hypot(mx, my) > 0.02;

    if (!this.enabled) return;

    const held = new Set();
    for (const [idx, action] of Object.entries(PAD_BUTTONS)) {
      if (btn(Number(idx))) held.add(action);
    }
    for (const action of held) {
      if (!this._padHeld.has(action)) {
        this.down.add(action);
        this.pressed.add(action);
        if (this.anyInputCallback) this.anyInputCallback();
      }
    }
    for (const action of this._padHeld) {
      if (!held.has(action)) {
        this.released.add(action);
        if (!this.keyboardHolds(action) && !this.touchActions.has(action) &&
            !(action === 'sprint' && this.autoSprint)) this.down.delete(action);
      }
    }
    // Sprint is on several physical buttons; only release when none are held
    if (held.has('sprint')) this.down.add('sprint');
    this._padHeld = held;
  }

  /** Called once per frame (after polling the pad, before edges are cleared). */
  dispatchFrame() {
    if (this.onFrame) this.onFrame(this);
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) {
        if (PREVENT.has(e.code)) e.preventDefault();
        return;
      }
      const action = KEYMAP[e.code];
      if (PREVENT.has(e.code)) e.preventDefault();
      if (!action) return;
      if (!this.enabled) return;
      this._keyHeld.add(action);
      this.down.add(action);
      this.pressed.add(action);
      if (this.anyInputCallback) this.anyInputCallback();
    });
    window.addEventListener('keyup', (e) => {
      const action = KEYMAP[e.code];
      if (!action) return;
      this._keyHeld.delete(action);
      if (this.touchActions.has(action) || this._padHeld.has(action)) return;
      if (action === 'sprint' && this.autoSprint) return;
      this.down.delete(action);
      this.released.add(action);
    });
    window.addEventListener('blur', () => {
      // Avoid stuck keys when the tab loses focus
      for (const a of this.down) this.released.add(a);
      this.down.clear();
      this.autoSprint = false;
      this._keyHeld.clear();
    });
  }

  _bindTouch() {
    // Virtual joystick
    const stick = document.getElementById('joystick');
    const knob = document.getElementById('joystick-knob');
    if (stick && knob) {
      let pointerId = null;
      const setKnob = (dx, dy) => {
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
      };
      const handle = (e) => {
        const rect = stick.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const t = e.touches ? e.touches[0] : e;
        let dx = t.clientX - cx;
        let dy = t.clientY - cy;
        const max = rect.width / 2 - 12;
        const len = Math.hypot(dx, dy);
        if (len > max) {
          dx = (dx / len) * max;
          dy = (dy / len) * max;
        }
        this.touch.x = dx / max;
        this.touch.y = -dy / max;
        this.touch.active = true;
        setKnob(dx, dy);
      };
      stick.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (pointerId !== null) return;
        pointerId = e.pointerId;
        stick.setPointerCapture(pointerId);
        handle(e);
      });
      stick.addEventListener('pointermove', (e) => {
        if (e.pointerId !== pointerId) return;
        e.preventDefault();
        handle(e);
      });
      const end = (e) => {
        if (e.pointerId !== pointerId) return;
        pointerId = null;
        this.touch.x = 0;
        this.touch.y = 0;
        this.touch.active = false;
        setKnob(0, 0);
      };
      stick.addEventListener('pointerup', end);
      stick.addEventListener('pointercancel', end);
      stick.addEventListener('pointerleave', end);
    }

    // Action buttons
    document.querySelectorAll('[data-action]').forEach((btn) => {
      const action = btn.dataset.action;
      const press = (e) => {
        e.preventDefault();
        btn.classList.add('is-down');
        this.touchActions.add(action);
        this.down.add(action);
        this.pressed.add(action);
      };
      const release = (e) => {
        e.preventDefault();
        btn.classList.remove('is-down');
        this.touchActions.delete(action);
        if (!this.keyboardHolds(action) && !(action === 'sprint' && this.autoSprint)) {
          this.down.delete(action);
        }
        this.released.add(action);
      };
      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('pointerleave', (e) => {
        if (this.touchActions.has(action)) release(e);
      });
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  keyboardHolds(action) {
    return this._keyHeld.has(action);
  }

  /* ------------------------------------------------------------------ */
  /* Touch API (driven by src/ui/TouchControls.js)                       */
  /* ------------------------------------------------------------------ */
  /** Push a finger-held action. Press edges are only raised once. */
  pressTouch(action) {
    if (!action) return;
    if (!this.touchActions.has(action)) {
      this.touchActions.add(action);
      this.down.add(action);
      this.pressed.add(action);
      if (this.anyInputCallback) this.anyInputCallback();
    }
  }

  /** Release a finger-held action, unless the keyboard/pad still holds it. */
  releaseTouch(action) {
    if (!action) return;
    if (!this.touchActions.delete(action)) return;
    const autoHolds = action === 'sprint' && this.autoSprint;
    if (!this.keyboardHolds(action) && !this._padHeld.has(action) && !autoHolds) this.down.delete(action);
    this.released.add(action);
  }

  /**
   * Auto-sprint channel, separate from `pressTouch` so no press edge is raised.
   * Sprint stays held while any of keyboard / pad / touch button / auto wants it.
   */
  setAutoSprint(on) {
    on = !!on;
    if (this.autoSprint === on) return;
    this.autoSprint = on;
    if (on) {
      this.down.add('sprint');
    } else if (!this.keyboardHolds('sprint') && !this._padHeld.has('sprint') && !this.touchActions.has('sprint')) {
      this.down.delete('sprint');
    }
  }

  /** True when the sprint is currently on because of auto-sprint alone. */
  isAutoSprinting() {
    return this.autoSprint && !this.touchActions.has('sprint') && !this.keyboardHolds('sprint');
  }

  /** Virtual joystick axis in screen space (x right, y up), length <= 1. */
  setTouchAxis(x, y) {
    const len = Math.hypot(x, y);
    if (len < 0.001) {
      this.touch.x = 0;
      this.touch.y = 0;
      this.touch.active = false;
      return;
    }
    const k = Math.min(1, len) / len;
    this.touch.x = x * k;
    this.touch.y = y * k;
    this.touch.active = true;
  }

  /** Movement axis in screen space: x right, y up. */
  axis() {
    let x = 0;
    let y = 0;
    if (this.down.has('left')) x -= 1;
    if (this.down.has('right')) x += 1;
    if (this.down.has('up')) y += 1;
    if (this.down.has('down')) y -= 1;
    if (this.touch.active) {
      x += this.touch.x;
      y += this.touch.y;
    }
    if (this.pad.active) {
      x += this.pad.x;
      y += this.pad.y;
    }
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  /**
   * Aiming axis: the right stick when it is being pushed, otherwise the
   * movement axis (i.e. where the player is running). Screen space, x right, y up.
   */
  aim() {
    if (Math.hypot(this.pad.aimX, this.pad.aimY) > 0.25) {
      return { x: this.pad.aimX, y: this.pad.aimY };
    }
    return this.axis();
  }

  isDown(a) {
    return this.down.has(a);
  }

  wasPressed(a) {
    return this.pressed.has(a);
  }

  wasReleased(a) {
    return this.released.has(a);
  }

  clear() {
    this.down.clear();
    this.pressed.clear();
    this.released.clear();
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
  }
}
