import './styles.css';
import { Game } from './core/Game.js';
import { Input } from './core/Input.js';
import { UI } from './ui/UI.js';
import { GamepadNav } from './ui/GamepadNav.js';
import { TouchControls } from './ui/TouchControls.js';
import { SETTINGS_DEFAULTS, TEAMS } from './config.js';

const STORAGE_KEY = 'pitch-legends-settings-v1';

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...SETTINGS_DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...SETTINGS_DEFAULTS, ...parsed };
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage may be unavailable — settings simply won't persist */
  }
}

const settings = loadSettings();

// First run: default the control type to what the device actually is. A device
// with no touchscreen at all (Android TV, a desktop browser, a Chromebook in
// laptop mode) must start on Computer/Controller even if 'auto' was stored.
const touchCapable = TouchControls.isSupported();
if (!settings.controls || settings.controls === 'auto') {
  settings.controls = touchCapable ? 'touch' : 'desktop';
}
if (!touchCapable) settings.controls = 'desktop'; // never offer a pad nobody can press
const canvas = document.getElementById('scene');

const input = new Input();
let game = null;

const ui = new UI({
  settings,
  callbacks: {
    onQuickMatch: () => startMatch(),
    onRestart: () => startMatch(),
    onMainMenu: () => returnToMenu(),
    onPause: (paused) => game?.setPaused(paused),
    onSettingChange: (key, value) => {
      saveSettings(settings);
      if (!game) return;
      if (key === 'camera') game.setCameraMode(value);
      if (key === 'sound') ui.sound.setEnabled(!!value);
      if (key === 'difficulty') game.applyDifficulty(settings.difficulty);
      if (key === 'formation') {
        // takes effect straight away: slots are reassigned and the shape resets
        if (game.state !== 'idle') game.applyFormation(game.home, settings.formation);
      }
    },
  },
});

game = new Game({ canvas, input, ui, settings });
ui.game = game;

// on-screen pad (created up front so the HUD can dock it before kickoff)
ui.attachTouchControls(new TouchControls({ input }));

function startMatch() {
  ui.resetForMatch();
  ui.hideAllScreens();
  ui.showHud(true);
  ui.hideLoading();
  input.clear();
  game.setCameraMode(settings.camera);
  game.startMatch(settings);
  game.setPaused(false);
  ui.setTeams(TEAMS.home, TEAMS.away);
  ui.setScore(game.home, game.away);
  ui.setHalf(1);
  if (settings.sound) ui.sound.resume();
  ui.toast('KICK OFF', 'default');
  if (ui.controlType() === 'touch') ui.touchControls?.showHint();
}

function returnToMenu() {
  game.state = 'idle';
  game.setPaused(false);
  game.resetThrowInState();
  game.ball.release();
  ui.showHud(false);
  ui.hideAllScreens();
  ui.showScreen('title');
  ui.hideGoalBanner();
  ui.hideHalftime();
  ui.hideFullTime();
  ui.sound.crowdExcitement(0);
  input.clear();
}

ui.setTeams(TEAMS.home, TEAMS.away);
game.start();
game.state = 'idle';

/* ---------------- controller: menus, pause and connection feedback ---------------- */
const LIVE_STATES = new Set(['play', 'kickoff', 'restart', 'throwin', 'celebrate', 'halftime']);
const padNav = new GamepadNav({ input, ui, liveStates: LIVE_STATES });

// Runs once per frame, before input edges are cleared
input.onFrame = () => {
  // touch pad: context labels, charge ring, throw-in buttons
  ui.updateTouch(game);
  // Start pauses/resumes live play even though no menu is open
  padNav.handleLiveStart();
  // Then drive whatever menu or overlay is on screen
  padNav.update(1 / 60);
};

window.addEventListener('pitchlegends-gamepad', (e) => {
  const pad = e.detail || {};
  if (pad.connected) {
    const label = (pad.name || 'Controller').replace(/\s*\(.*\)$/, '').trim();
    ui.toast(`CONTROLLER CONNECTED · ${label.slice(0, 26)}`, 'default');
  } else if (game.state !== 'idle') {
    ui.toast('CONTROLLER DISCONNECTED', 'warn');
  }
});

// Hide the loading screen once the first frame is on screen
requestAnimationFrame(() => requestAnimationFrame(() => ui.hideLoading()));

/* Keyboard shortcuts for overlays that live outside the gameplay loop */
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' && e.code !== 'KeyP') return;
  if (ui.pauseOpen) {
    ui.resume();
  } else if (LIVE_STATES.has(game.state)) {
    ui.openPause();
  }
  e.preventDefault();
});

// Pause automatically when the tab is hidden, so nothing runs away
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state !== 'idle' && !ui.pauseOpen) {
    ui.openPause();
  }
});

// Expose a tiny debug hook for automated smoke tests
window.__PITCH_LEGENDS__ = {
  get game() {
    return game;
  },
  ui,
  input,
  startMatch,
  returnToMenu,
  get padNav() {
    return padNav;
  },
};
