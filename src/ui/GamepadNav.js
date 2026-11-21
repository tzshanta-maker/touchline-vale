/**
 * Controller navigation for the menus and overlays.
 *
 * The gameplay layer only reads the pad while a match is live, so without this
 * a controller could not start a match, change a setting or unpause. This
 * module keeps a focus ring over the visible menu buttons and translates
 * D-pad / left-stick / face buttons into the same clicks a mouse would make.
 *
 * It is driven once per frame from `Input.poll()` while press edges are intact.
 */

const REPEAT_DELAY = 0.42; // seconds before a held stick starts repeating
const REPEAT_RATE = 0.11; // seconds between repeats
const STICK_THRESHOLD = 0.6;

const FOCUS_CLASS = 'pad-focus';

export class GamepadNav {
  constructor({ input, ui, liveStates }) {
    this.input = input;
    this.ui = ui;
    this.liveStates = liveStates;
    this.index = 0;
    this.rootKey = null;
    this.holdTimer = 0;
    this.lastDir = 0;
    this.active = false;
  }

  /** The panel that currently owns the screen, or null when nothing is open. */
  currentRoot() {
    const pause = document.getElementById('pause-overlay');
    if (pause && !pause.classList.contains('hidden')) return { key: 'pause', el: pause };
    const full = document.getElementById('fulltime-overlay');
    if (full && !full.classList.contains('hidden')) return { key: 'fulltime', el: full };
    const half = document.getElementById('halftime-overlay');
    if (half && !half.classList.contains('hidden')) return { key: 'halftime', el: half };
    for (const [key, el] of Object.entries(this.ui?._refs?.screens || {})) {
      if (el && !el.classList.contains('hidden')) return { key, el };
    }
    return null;
  }

  itemsIn(root) {
    const nodes = root.querySelectorAll(
      'button, .formation-btn, .segmented button, .setting button, .squad-row'
    );
    const list = [];
    for (const el of nodes) {
      if (el.disabled) continue;
      if (el.closest('.hidden')) continue;
      if (el.offsetParent === null) continue; // not rendered
      list.push(el);
    }
    return list;
  }

  clearFocus() {
    document.querySelectorAll(`.${FOCUS_CLASS}`).forEach((el) => el.classList.remove(FOCUS_CLASS));
  }

  focus(el) {
    this.clearFocus();
    if (!el) return;
    el.classList.add(FOCUS_CLASS);
    // keep the focused row visible in long lists (squad, settings)
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** Step the focus by `delta` items, wrapping around the list. */
  move(delta, items) {
    if (!items.length) return;
    this.index = (this.index + delta + items.length) % items.length;
    this.focus(items[this.index]);
  }

  /**
   * Runs once per frame. Returns true when the pad consumed the frame's input
   * (so callers can avoid double handling).
   */
  update(dt = 1 / 60) {
    const input = this.input;
    if (!input?.pad?.connected) {
      if (this.active) {
        this.clearFocus();
        this.active = false;
        this.rootKey = null;
      }
      return false;
    }

    const root = this.currentRoot();
    if (!root) {
      if (this.active) {
        this.clearFocus();
        this.active = false;
        this.rootKey = null;
      }
      return false;
    }

    // context changed (opened a new screen) → reset the focus
    if (this.rootKey !== root.key) {
      this.rootKey = root.key;
      this.index = 0;
      this.active = true;
      const items = this.itemsIn(root.el);
      // prefer a primary action if the panel has one
      const primary = items.findIndex((el) => el.classList.contains('btn-primary'));
      this.index = primary >= 0 ? primary : 0;
      this.focus(items[this.index]);
      this.holdTimer = 0;
      this.lastDir = 0;
      return false;
    }

    this.active = true;
    const items = this.itemsIn(root.el);
    if (!items.length) return false;
    if (this.index >= items.length) this.index = items.length - 1;
    if (!items[this.index].classList.contains(FOCUS_CLASS)) this.focus(items[this.index]);

    // ---- navigation: D-pad edges + held stick with repeat ----
    let dir = 0;
    if (input.wasPressed('up')) dir = -1;
    else if (input.wasPressed('down')) dir = 1;
    else if (input.wasPressed('left')) dir = -1;
    else if (input.wasPressed('right')) dir = 1;

    if (dir !== 0) {
      this.holdTimer = REPEAT_DELAY;
      this.lastDir = dir;
      this.move(dir, items);
    } else {
      const y = input.pad.y || 0;
      const x = input.pad.x || 0;
      const axis = Math.abs(y) > STICK_THRESHOLD ? Math.sign(y) : Math.abs(x) > STICK_THRESHOLD ? Math.sign(x) : 0;
      if (axis === 0) {
        this.lastDir = 0;
        this.holdTimer = 0;
      } else {
        if (this.lastDir !== axis) {
          this.lastDir = axis;
          this.holdTimer = REPEAT_DELAY;
          this.move(axis, items);
        } else {
          this.holdTimer -= dt;
          if (this.holdTimer <= 0) {
            this.holdTimer = REPEAT_RATE;
            this.move(axis, items);
          }
        }
      }
    }

    // ---- confirm (A) ----
    if (input.wasPressed('pass')) {
      const el = items[this.index];
      if (el && typeof el.click === 'function') {
        el.click();
        return true;
      }
    }

    // ---- back (B) ----
    if (input.wasPressed('shoot')) {
      if (root.key === 'pause') {
        this.ui.resume();
        return true;
      }
      const back = root.el.querySelector('[data-back]');
      if (back) {
        back.click();
        return true;
      }
    }

    // ---- start: pause / resume, or kick off from the title screen ----
    if (input.wasPressed('pause')) {
      if (root.key === 'pause') {
        this.ui.resume();
        return true;
      }
      // Start on the title screen goes straight into a match with the saved
      // settings; the quick match menu is one A press away.
      if (root.key === 'title') {
        document.getElementById('btn-quick')?.click();
        document.getElementById('btn-kickoff')?.click();
        return true;
      }
      if (root.key === 'match') {
        document.getElementById('btn-kickoff')?.click();
        return true;
      }
    }

    return false;
  }

  /** Gameplay-side helper: Start pauses live play (the pad never reaches the browser). */
  handleLiveStart() {
    const input = this.input;
    if (!input?.pad?.connected) return false;
    if (!input.wasPressed('pause')) return false;
    if (this.ui?.pauseOpen) {
      this.ui.resume();
      return true;
    }
    if (this.liveStates?.has(this.ui?.game?.state)) {
      this.ui.openPause();
      return true;
    }
    return false;
  }
}
