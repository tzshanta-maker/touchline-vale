/**
 * On-screen touch controls for mobile play.
 *
 * Two ergonomic layouts (inspired by the general shape of mobile football
 * games, no branding or assets copied):
 *
 *   FC style   – floating stick bottom-left, big SPRINT bottom-right,
 *                SHOOT above it, PASS to the left of SHOOT, THRU above PASS.
 *   DLS style  – floating stick bottom-left plus a clean A / B / C cluster and
 *                a separate, prominent SPRINT button.
 *
 * Every button is context sensitive: while attacking they shoot / pass /
 * through-ball, while defending they tackle / switch / press, and during a
 * throw-in PASS becomes THROW and THRU becomes RECEIVER.
 *
 * Presses are pushed into Input (pressTouch / releaseTouch) so the game logic
 * does not care whether an action came from a key, a pad or a finger.
 *
 * Held buttons can be released with a swipe:
 *   swipe up   on PASS/THRU  -> lofted / crossed variant
 *   swipe down on the tackle -> slide tackle
 * Short diagonal wobbles are ignored (see SWIPE_MIN).
 *
 * The pad needs a touchscreen: `isSupported()` checks for real touch support, so
 * Android TV / desktop builds keep the "Computer / Controller" control type by
 * default instead of showing buttons that cannot be pressed.
 */

const SWIPE_MIN = 26; // px of vertical travel before a swipe counts
// DLS auto-sprint: fraction of the stick's travel that counts as a full sprint
const AUTO_SPRINT_RIM = 0.85;
// two SPRINT taps closer together than this trigger the sprint skill
const SKILL_TAP_MS = 330;
const SWIPE_SLOP = 1.4; // vertical must beat horizontal * this to count as up/down

/** Logical button set used by both layouts; positions come from CSS. */
const BUTTONS = [
  { id: 'shoot', key: 'shoot' },
  { id: 'pass', key: 'pass' },
  { id: 'through', key: 'through' },
  { id: 'sprint', key: 'sprint' },
];

const HINT_KEY = 'touchline-vale-touch-hint-v1';

export class TouchControls {
  /** True when this device can actually press on-screen buttons. */
  static isSupported() {
    return (
      typeof window !== 'undefined' &&
      (navigator.maxTouchPoints > 0 || 'ontouchstart' in window ||
        !!window.matchMedia?.('(pointer: coarse)').matches)
    );
  }

  /**
   * @param {object} opts
   * @param {import('../core/Input.js').Input} opts.input
   * @param {HTMLElement} [opts.root] element to attach to (defaults to body)
   */
  constructor({ input, root = document.body }) {
    this.input = input;
    this.root = root;
    this.layout = 'fc';
    this.visible = false;
    this.buttons = new Map();
    this.mode = 'attack'; // attack | defend | throwin
    this.autoSprintOn = false;
    this._build();
  }

  /* ------------------------------------------------------------------ */
  /* DOM                                                                 */
  /* ------------------------------------------------------------------ */
  _build() {
    const wrap = document.createElement('div');
    wrap.id = 'touch-controls';
    wrap.className = 'touch-controls hidden layout-fc';
    wrap.setAttribute('aria-hidden', 'true');

    // --- movement stick -------------------------------------------------
    const stick = document.createElement('div');
    stick.className = 'tc-stick';
    stick.id = 'tc-stick';
    const base = document.createElement('div');
    base.className = 'tc-stick-base';
    const knob = document.createElement('div');
    knob.className = 'tc-stick-knob';
    knob.id = 'tc-stick-knob';
    base.appendChild(knob);
    stick.appendChild(base);
    wrap.appendChild(stick);

    // --- action buttons -------------------------------------------------
    const pad = document.createElement('div');
    pad.className = 'tc-pad';
    for (const def of BUTTONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `tc-btn tc-${def.id}`;
      btn.dataset.tcBtn = def.id;
      btn.innerHTML =
        `<svg class="tc-arrow" viewBox="0 0 12 8" aria-hidden="true">` +
        `<path d="M1 6.6 L6 1.6 L11 6.6" fill="none" stroke="currentColor" ` +
        `stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>` +
        `<span class="tc-label"></span><span class="tc-sub"></span><span class="tc-ring"></span>`;
      pad.appendChild(btn);
      this.buttons.set(def.id, btn);
      this._bindButton(btn, def.id);
    }
    wrap.appendChild(pad);

    // --- gesture hint / tutorial ---------------------------------------
    const hint = document.createElement('div');
    hint.className = 'tc-hint hidden';
    hint.id = 'tc-hint';
    wrap.appendChild(hint);

    this.root.appendChild(wrap);
    this.el = wrap;
    this.stick = stick;
    this.knob = knob;
    this.hint = hint;
    this._bindStick();
    this._applyLabels('attack');
  }

  _bindStick() {
    const stick = this.stick;
    const knob = this.knob;
    let pointerId = null;
    let radius = 60;

    const set = (dx, dy) => {
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const move = (e) => {
      const rect = stick.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      radius = rect.width / 2 - 14;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > radius) {
        dx = (dx / len) * radius;
        dy = (dy / len) * radius;
      }
      const nx = dx / radius;
      const ny = -dy / radius;
      this.input.setTouchAxis(nx, ny);
      set(dx, dy);
      stick.classList.add('is-active');
      this._updateAutoSprint(Math.hypot(nx, ny));
    };

    stick.addEventListener('pointerdown', (e) => {
      if (pointerId !== null) return;
      e.preventDefault();
      pointerId = e.pointerId;
      try {
        stick.setPointerCapture(pointerId);
      } catch {
        /* synthetic events cannot be captured */
      }
      move(e);
    });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pointerId) return;
      e.preventDefault();
      move(e);
    });
    const end = (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      this.input.setTouchAxis(0, 0);
      this._updateAutoSprint(0);
      set(0, 0);
      stick.classList.remove('is-active');
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
    stick.addEventListener('pointerleave', (e) => {
      if (e.pointerId === pointerId && !stick.hasPointerCapture?.(pointerId)) end(e);
    });
    stick.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /**
   * Buttons resolve on release so a tap / hold / swipe can be told apart.
   * SPRINT and SHOOT act immediately on press: sprint must feel instant and
   * shoot starts charging while the finger is down.
   */
  _bindButton(btn, id) {
    let pointerId = null;
    let startY = 0;
    let startX = 0;
    let startAt = 0;
    let swipe = null;

    const down = (e) => {
      if (pointerId !== null) return;
      e.preventDefault();
      pointerId = e.pointerId;
      startY = e.clientY;
      startX = e.clientX;
      startAt = performance.now();
      swipe = null;
      btn.classList.add('is-down');
      try {
        btn.setPointerCapture(pointerId);
      } catch {
        /* ignore */
      }
      if (id === 'sprint') {
        this.input.pressTouch('sprint');
        // double-tap SPRINT = the sprint skill (roulette). Detected here on
        // pointerdown so two quick taps in the same frame are not collapsed
        // into one press edge by the input layer.
        const now = performance.now();
        if (now - (this._lastSprintTap ?? -1e9) < SKILL_TAP_MS) {
          this._lastSprintTap = -1e9; // a third tap starts a fresh pair
          this._emit('skill');
        } else {
          this._lastSprintTap = now;
        }
      } else if (id === 'shoot') {
        if (this.mode === 'defend') {
          // standing / slide tackle: fire immediately, no charge involved
          this._emit('tackle');
        } else {
          this.input.pressTouch('shoot'); // start charging
          btn.classList.add('is-charging');
        }
      } else if (id === 'pass' && this.mode === 'defend') {
        this.input.pressTouch('press'); // hold to contain
      }
    };

    const moved = (e) => {
      if (e.pointerId !== pointerId) return;
      e.preventDefault();
      const dy = e.clientY - startY;
      const dx = e.clientX - startX;
      if (Math.abs(dy) > SWIPE_MIN && Math.abs(dy) > Math.abs(dx) * SWIPE_SLOP) {
        swipe = dy < 0 ? 'up' : 'down';
        btn.classList.toggle('is-swipe-up', swipe === 'up');
        btn.classList.toggle('is-swipe-down', swipe === 'down');
      }
    };

    const up = (e) => {
      if (e.pointerId !== pointerId) return;
      e.preventDefault();
      pointerId = null;
      const held = performance.now() - startAt;
      btn.classList.remove('is-down', 'is-swipe-up', 'is-swipe-down', 'is-charging');
      if (id === 'sprint') {
        this.input.releaseTouch('sprint');
        return;
      }
      if (id === 'shoot' && this.mode !== 'throwin') {
        // charging already started on press: releasing plays the shot
        this.input.releaseTouch('shoot');
        return;
      }
      if (id === 'pass' && this.mode === 'defend') {
        this.input.releaseTouch('press');
        return;
      }
      const action = this._resolve(id, id, { held, swipe });
      if (action) this._emit(action);
    };

    const cancel = (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      btn.classList.remove('is-down', 'is-swipe-up', 'is-swipe-down', 'is-charging');
      if (id === 'sprint') this.input.releaseTouch('sprint');
      if (id === 'shoot') this.input.releaseTouch('shoot');
      if (id === 'pass') this.input.releaseTouch('press');
    };

    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointermove', moved);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', cancel);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Fire a one-frame virtual tap. */
  _emit(action) {
    this.input.pressTouch(action);
    this.input.releaseTouch(action);
  }

  /**
   * Map a button + context (+ gesture) to the action the game should run.
   * Charged variants are only used where the game has a matching behaviour.
   */
  _resolve(id, fallback, { held = 0, swipe = null } = {}) {
    const mode = this.mode;
    if (mode === 'throwin') {
      if (id === 'pass') return 'throw';
      if (id === 'through') return 'throw_receiver';
      if (id === 'shoot') return 'throw_long';
      return null;
    }
    if (mode === 'defend') {
      if (id === 'shoot') return 'tackle'; // standing / slide tackle
      if (id === 'pass') return swipe === 'up' ? 'gk_rush' : 'press';
      if (id === 'through') {
        if (swipe === 'up') return 'gk_rush';
        return held > 300 ? 'secondman' : 'switch';
      }
      return null;
    }
    // attacking
    if (id === 'pass') {
      if (swipe === 'up') return 'pass_loft';
      return held > 300 ? 'pass_long' : 'pass';
    }
    if (id === 'through') {
      if (swipe === 'up') return 'through_loft';
      return held > 300 ? 'through_loft' : 'through';
    }
    return fallback;
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */
  /**
   * DLS layout sprints automatically: push the stick to the rim and the player
   * runs at full pace without a second thumb. Partial deflection is a jog, and
   * the SPRINT button still works on its own for a sprint at a gentle angle.
   * The FC layout keeps sprint purely manual.
   */
  _updateAutoSprint(magnitude) {
    const on = this.layout === 'dls' && magnitude >= AUTO_SPRINT_RIM;
    if (on === this.autoSprintOn) return;
    this.autoSprintOn = on;
    this.input.setAutoSprint(on);
    this.buttons.get('sprint')?.classList.toggle('is-auto', on);
    this.stick?.classList.toggle('is-sprinting', on);
  }

  setLayout(layout) {
    const next = layout === 'dls' ? 'dls' : 'fc';
    if (!this.el) return;
    if (next !== 'dls') this._updateAutoSprint(0);
    this.el.classList.toggle('layout-fc', next === 'fc');
    this.el.classList.toggle('layout-dls', next === 'dls');
    if (next !== this.layout) {
      this.layout = next;
      this._applyLabels(this.mode);
      this.showHint(true);
    } else {
      this.layout = next;
    }
  }

  setVisible(on) {
    this.visible = !!on;
    if (!this.el) return;
    if (!this.visible) this._updateAutoSprint(0);
    this.el.classList.toggle('hidden', !this.visible);
    this.el.setAttribute('aria-hidden', this.visible ? 'false' : 'true');
    if (!this.visible) {
      this.input.setTouchAxis(0, 0);
      this.input.releaseTouch('sprint');
      this.input.releaseTouch('shoot');
      this.knob.style.transform = 'translate(0px, 0px)';
      this.buttons.forEach((b) => b.classList.remove('is-down', 'is-charging'));
    }
  }

  /** Show the gesture tutorial strip for a few seconds. */
  showHint(force = false) {
    if (!this.hint) return;
    let seen = false;
    try {
      seen = localStorage.getItem(HINT_KEY) === '1';
    } catch {
      seen = false;
    }
    if (seen && !force) return;
    const copy =
      this.layout === 'dls'
        ? 'Stick to move · push it all the way to sprint · A shoot · B pass (hold = lofted) · C through · double-tap SPRINT to spin'
        : 'Stick to move · SHOOT hold to power up · PASS tap short, hold long, swipe up to cross · double-tap SPRINT to spin';
    this.hint.textContent = copy;
    this.hint.classList.remove('hidden');
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => {
      this.hint.classList.add('hidden');
      try {
        localStorage.setItem(HINT_KEY, '1');
      } catch {
        /* storage unavailable */
      }
    }, 7000);
  }

  /** Per-frame refresh driven from UI.updateTouch(game). */
  update(game) {
    if (!this.visible || !game) return;
    const mode = this._context(game);
    if (mode !== this.mode) {
      this.mode = mode;
      this._applyLabels(mode);
    }
    // shot power ring mirrors the game's charge value
    const charge = game.charging ? Math.min(1, game.charge || 0) : 0;
    const shoot = this.buttons.get('shoot');
    if (shoot) {
      shoot.style.setProperty('--charge', charge.toFixed(3));
      shoot.classList.toggle('is-charging', game.charging === true);
    }
  }

  _context(game) {
    // throw-in buttons only while our own team is taking the throw
    if (typeof game.throwInActive === 'function' && game.throwInActive()) {
      const t = game.throwInState ? game.throwInState() : null;
      return !t || !game.humanTeam || t.team === game.humanTeam ? 'throwin' : 'defend';
    }
    const holder = game.ball?.owner;
    const human = game.humanTeam;
    if (human && holder && holder.team === human) return 'attack';
    if (human && !holder) {
      // loose ball: keep attack labels if we are closest to it
      const near = game.controlled;
      if (near && game.ball) {
        const d = near.pos.distanceTo(game.ball.pos);
        if (d < 3) return 'attack';
      }
    }
    return 'defend';
  }

  /**
   * Labels per input mode. The 4th field is the gesture the button offers:
   * 'up' / 'down' draw the small arrow badge (FC layout), 'hold' just pads the
   * sub-label. Arrows only appear where a swipe actually does something, so a
   * plain tap button never looks like it wants a gesture.
   */
  _applyLabels(mode) {
    const dls = this.layout === 'dls';
    const set = (id, label, sub = '', gesture = '') => {
      const btn = this.buttons.get(id);
      if (!btn) return;
      btn.querySelector('.tc-label').textContent = label;
      btn.querySelector('.tc-sub').textContent = sub;
      btn.classList.toggle('is-strong', label.length <= 2);
      if (gesture) btn.dataset.gesture = gesture;
      else delete btn.dataset.gesture;
      btn.setAttribute(
        'aria-label',
        `${label}${sub ? ` — ${sub}` : ''}${gesture === 'up' ? ' (swipe up)' : gesture === 'down' ? ' (swipe down)' : ''}`,
      );
    };

    const copy = {
      attack: dls
        ? [
            ['shoot', 'A', 'shoot', 'hold'],
            ['pass', 'B', 'pass', 'up'],
            ['through', 'C', 'thru', 'up'],
            ['sprint', 'SPRINT', 'auto', ''],
          ]
        : [
            ['shoot', 'SHOOT', 'hold', ''],
            ['pass', 'PASS', 'loft', 'up'],
            ['through', 'THRU', 'cross', 'up'],
            ['sprint', 'SPRINT', '', ''],
          ],
      defend: dls
        ? [
            ['shoot', 'A', 'tackle', 'down'],
            ['pass', 'B', 'contain', 'hold'],
            ['through', 'C', 'switch', 'up'],
            ['sprint', 'SPRINT', 'auto', ''],
          ]
        : [
            ['shoot', 'SLIDE', 'tackle', ''],
            ['pass', 'SWITCH', '', ''],
            ['through', 'PRESS', 'GK', 'up'],
            ['sprint', 'SPRINT', 'auto', ''],
          ],
      throwin: dls
        ? [
            ['shoot', 'A', 'long', ''],
            ['pass', 'THROW', '', ''],
            ['through', 'RECEIVER', 'tap', ''],
            ['sprint', 'SPRINT', '', ''],
          ]
        : [
            ['shoot', 'LONG', 'throw', ''],
            ['pass', 'THROW', '', ''],
            ['through', 'RECEIVER', 'tap', ''],
            ['sprint', 'SPRINT', '', ''],
          ],
    };
    for (const [id, label, sub, gesture] of copy[mode] || copy.attack) {
      set(id, label, sub, gesture);
    }
    this.el?.setAttribute('data-mode', mode);
  }

  destroy() {
    this._updateAutoSprint(0);
    clearTimeout(this._hintTimer);
    this.el?.remove();
    this.el = null;
  }
}
