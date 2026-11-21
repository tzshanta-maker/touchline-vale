/**
 * Global tuning constants for Touchline Vale.
 * World units are metres. The pitch lies in the XZ plane with the long axis on Z.
 * Home team (player) defends z = -halfL and attacks z = +halfL.
 */

export const PITCH = {
  length: 106,
  width: 68,
  halfL: 53,
  halfW: 34,
  goalWidth: 7.32,
  goalHeight: 2.44,
  goalDepth: 2.1,
  penaltyDepth: 16.5,
  penaltyWidth: 40.32,
  sixDepth: 5.5,
  sixWidth: 18.32,
  circleRadius: 9.15,
  cornerRadius: 1,
  margin: 10,
};

export const BALL = {
  radius: 0.12,
  gravity: 9.81,
  rollFriction: 0.72,
  airDrag: 0.052,
  bounce: 0.56,
  bounceGrip: 0.86,
  maxSpeed: 42,
  capturableSpeed: 17,
  trapRadius: 1.2,
  blockRadius: 0.62,
};

export const PLAYER = {
  radius: 0.44,
  maxSpeed: 6.5,
  sprintSpeed: 9.2,
  accel: 27,
  decel: 32,
  turnRate: 12,
  turnRateSprint: 7.5,
  dribbleSpeedFactor: 0.9,
  dribbleDistance: 0.58,
  staminaDrain: 10.5,
  staminaRegen: 10,
  staminaSprintMin: 6,
  chargeSlowFactor: 0.82,
  tackleRange: 2.15,
  tackleCooldown: 0.85,
  kickCooldown: 0.32,
};

export const MATCH = {
  halfMinutesOptions: [2, 3, 5],
  defaultHalfMinutes: 3,
  kickoffDelay: 2.1,
  goalCelebration: 4.0,
  halftimeDelay: 3.0,
  restartFreeze: 0.45,
};

export const CAMERA = {
  fov: 46,
  height: 23,
  back: 27,
  lateralFollow: 0.55,
  followLerp: 2.4,
  lookAhead: 4.5,
};

/**
 * Camera presets.
 *
 *   action    — low, close, tilted: the ball and the player you control fill the
 *               screen and the pitch runs away toward the far goal. This is the
 *               framing most mobile football games open with, because it makes
 *               dribbling readable on a small screen.
 *   broadcast — the classic elevated TV follow cam, whole pitch in view.
 *   close     — a tighter broadcast, good for passing football.
 *
 * `swing` shifts the camera sideways and the look target the other way, which
 * tilts the pitch into a slight diagonal instead of a flat top-down view.
 */
export const CAMERA_MODES = {
  action: {
    fov: 53,
    height: 14.5,
    back: 21,
    lateralFollow: 0.88,
    followLerp: 3.0,
    lookAhead: 1.2,
    lateralLook: 0.92,
    swing: 5,
  },
  broadcast: {
    fov: 46,
    height: 23,
    back: 27,
    lateralFollow: 0.55,
    followLerp: 2.4,
    lookAhead: 4.5,
    lateralLook: 0.72,
    swing: 0,
  },
  close: {
    fov: 40,
    height: 14,
    back: 19,
    lateralFollow: 0.55,
    followLerp: 2.4,
    lookAhead: 2,
    lateralLook: 0.8,
    swing: 0,
  },
  /**
   * Side view: the rig sits on one touchline and looks across the pitch, so play
   * runs left-to-right (or right-to-left) like a televised side camera. The
   * preset is measured from the touchline instead of from behind the ball, hence
   * `side` (-1 = the -x touchline) and `zFollow` (how much the rig slides along
   * the pitch with the ball).
   */
  side: {
    fov: 44,
    side: -1,
    height: 15,
    zFollow: 0.94,
    followLerp: 2.6,
    lookAhead: 1.2,
    lateralLook: 0.3,
  },
};

/** Preset for a camera setting value, falling back to the broadcast framing. */
export function cameraPreset(mode) {
  return CAMERA_MODES[mode] || CAMERA_MODES.broadcast;
}

export const TEAMS = {
  home: {
    id: 'home',
    name: 'Harbor City',
    short: 'HBR',
    primary: 0x1f5dd8,
    secondary: 0xf2f5ff,
    accent: 0xffd23f,
    shorts: 0xf2f5ff,
    socks: 0x1f5dd8,
  },
  away: {
    id: 'away',
    name: 'Riverside',
    short: 'RIV',
    primary: 0xd92b3a,
    secondary: 0x14161d,
    accent: 0xffffff,
    shorts: 0x14161d,
    socks: 0xd92b3a,
  },
};

/* ------------------------------------------------------------------ */
/* Player attributes                                                   */
/* ------------------------------------------------------------------ */
export const STAT_KEYS = ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical'];

export const STAT_LABELS = {
  pace: 'PAC',
  shooting: 'SHO',
  passing: 'PAS',
  dribbling: 'DRI',
  defending: 'DEF',
  physical: 'PHY',
};

/* Base attribute profile per position family (0-99). */
export const ARCHETYPES = {
  GK: { pace: 54, shooting: 28, passing: 60, dribbling: 44, defending: 84, physical: 74 },
  CB: { pace: 66, shooting: 38, passing: 66, dribbling: 54, defending: 86, physical: 86 },
  FB: { pace: 84, shooting: 50, passing: 74, dribbling: 76, defending: 76, physical: 76 },
  WB: { pace: 89, shooting: 55, passing: 77, dribbling: 80, defending: 70, physical: 74 },
  DM: { pace: 70, shooting: 62, passing: 81, dribbling: 74, defending: 84, physical: 85 },
  CM: { pace: 75, shooting: 72, passing: 87, dribbling: 83, defending: 71, physical: 78 },
  AM: { pace: 80, shooting: 80, passing: 87, dribbling: 89, defending: 46, physical: 69 },
  W: { pace: 91, shooting: 76, passing: 78, dribbling: 91, defending: 40, physical: 66 },
  ST: { pace: 85, shooting: 91, passing: 67, dribbling: 84, defending: 36, physical: 84 },
};

/* ------------------------------------------------------------------ */
/* Formations — 11 slots each, attacking frame (own goal at z = 0)     */
/* x: -1 (left) .. 1 (right)   z: 0 (own goal) .. 1 (opponent goal)    */
/* ------------------------------------------------------------------ */
const slot = (role, x, z, number, line, wide = false) => ({ role, x, z, number, line, wide });

export const FORMATIONS = {
  '4-3-3': {
    label: '4-3-3',
    style: 'Balanced width',
    desc: 'Two wide forwards, one holding midfielder. The default all-rounder.',
    slots: [
      slot('GK', 0.0, 0.025, 1, 'gk'),
      slot('RB', 0.66, 0.19, 2, 'def', true),
      slot('RCB', 0.22, 0.145, 4, 'def'),
      slot('LCB', -0.22, 0.145, 5, 'def'),
      slot('LB', -0.66, 0.19, 3, 'def', true),
      slot('RCM', 0.42, 0.40, 8, 'mid'),
      slot('CDM', 0.0, 0.30, 6, 'mid'),
      slot('LCM', -0.42, 0.40, 10, 'mid'),
      slot('RW', 0.74, 0.71, 7, 'fwd', true),
      slot('ST', 0.0, 0.82, 9, 'fwd'),
      slot('LW', -0.74, 0.71, 11, 'fwd', true),
    ],
  },
  '4-4-2': {
    label: '4-4-2',
    style: 'Classic two banks',
    desc: 'A flat midfield four and two strikers. Compact, direct, dependable.',
    slots: [
      slot('GK', 0.0, 0.025, 1, 'gk'),
      slot('RB', 0.66, 0.17, 2, 'def', true),
      slot('RCB', 0.24, 0.135, 5, 'def'),
      slot('LCB', -0.24, 0.135, 6, 'def'),
      slot('LB', -0.66, 0.17, 3, 'def', true),
      slot('RM', 0.70, 0.44, 7, 'mid', true),
      slot('RCM', 0.22, 0.40, 8, 'mid'),
      slot('LCM', -0.22, 0.40, 4, 'mid'),
      slot('LM', -0.70, 0.44, 11, 'mid', true),
      slot('RS', 0.20, 0.78, 9, 'fwd'),
      slot('LS', -0.20, 0.78, 10, 'fwd'),
    ],
  },
  '4-2-3-1': {
    label: '4-2-3-1',
    style: 'Double pivot',
    desc: 'Two holding midfielders screen the defence behind a roaming playmaker.',
    slots: [
      slot('GK', 0.0, 0.025, 1, 'gk'),
      slot('RB', 0.66, 0.19, 2, 'def', true),
      slot('RCB', 0.23, 0.14, 4, 'def'),
      slot('LCB', -0.23, 0.14, 5, 'def'),
      slot('LB', -0.66, 0.19, 3, 'def', true),
      slot('RDM', 0.20, 0.31, 6, 'mid'),
      slot('LDM', -0.20, 0.31, 8, 'mid'),
      slot('RAM', 0.64, 0.60, 7, 'mid', true),
      slot('CAM', 0.0, 0.62, 10, 'mid'),
      slot('LAM', -0.64, 0.60, 11, 'mid', true),
      slot('ST', 0.0, 0.84, 9, 'fwd'),
    ],
  },
  '3-5-2': {
    label: '3-5-2',
    style: 'Wing-back overload',
    desc: 'Three centre-backs free the wing-backs to attack. Midfield dominance.',
    slots: [
      slot('GK', 0.0, 0.025, 1, 'gk'),
      slot('RCB', 0.34, 0.14, 4, 'def'),
      slot('CB', 0.0, 0.12, 5, 'def'),
      slot('LCB', -0.34, 0.14, 6, 'def'),
      slot('RWB', 0.80, 0.46, 2, 'mid', true),
      slot('RCM', 0.34, 0.44, 8, 'mid'),
      slot('CDM', 0.0, 0.34, 7, 'mid'),
      slot('LCM', -0.34, 0.44, 10, 'mid'),
      slot('LWB', -0.80, 0.46, 3, 'mid', true),
      slot('RS', 0.20, 0.80, 9, 'fwd'),
      slot('LS', -0.20, 0.80, 11, 'fwd'),
    ],
  },
  '5-3-2': {
    label: '5-3-2',
    style: 'Low block counter',
    desc: 'Five at the back and a hard-working midfield. Sit deep, break fast.',
    slots: [
      slot('GK', 0.0, 0.025, 1, 'gk'),
      slot('RWB', 0.78, 0.20, 2, 'def', true),
      slot('RCB', 0.32, 0.13, 4, 'def'),
      slot('CB', 0.0, 0.115, 6, 'def'),
      slot('LCB', -0.32, 0.13, 5, 'def'),
      slot('LWB', -0.78, 0.20, 3, 'def', true),
      slot('RCM', 0.36, 0.42, 8, 'mid'),
      slot('CDM', 0.0, 0.32, 7, 'mid'),
      slot('LCM', -0.36, 0.42, 11, 'mid'),
      slot('RS', 0.22, 0.76, 9, 'fwd'),
      slot('LS', -0.22, 0.78, 10, 'fwd'),
    ],
  },
  '4-1-2-1-2': {
    label: '4-1-2-1-2',
    style: 'Midfield diamond',
    desc: 'A narrow diamond: one holder, two shuttlers, a number ten behind two strikers.',
    slots: [
      slot('GK', 0.0, 0.025, 1, 'gk'),
      slot('RB', 0.62, 0.19, 2, 'def', true),
      slot('RCB', 0.22, 0.14, 4, 'def'),
      slot('LCB', -0.22, 0.14, 5, 'def'),
      slot('LB', -0.62, 0.19, 3, 'def', true),
      slot('CDM', 0.0, 0.30, 6, 'mid'),
      slot('RCM', 0.46, 0.44, 8, 'mid'),
      slot('LCM', -0.46, 0.44, 7, 'mid'),
      slot('CAM', 0.0, 0.62, 10, 'mid'),
      slot('RS', 0.22, 0.82, 9, 'fwd'),
      slot('LS', -0.22, 0.82, 11, 'fwd'),
    ],
  },
  '4-5-1': {
    label: '4-5-1',
    style: 'Crowded midfield',
    desc: 'Five across the middle with one focal striker. Hard to play through.',
    slots: [
      slot('GK', 0.0, 0.025, 1, 'gk'),
      slot('RB', 0.66, 0.18, 2, 'def', true),
      slot('RCB', 0.24, 0.14, 4, 'def'),
      slot('LCB', -0.24, 0.14, 5, 'def'),
      slot('LB', -0.66, 0.18, 3, 'def', true),
      slot('RM', 0.72, 0.44, 7, 'mid', true),
      slot('RCM', 0.30, 0.40, 8, 'mid'),
      slot('CDM', 0.0, 0.30, 6, 'mid'),
      slot('LCM', -0.30, 0.40, 10, 'mid'),
      slot('LM', -0.72, 0.44, 11, 'mid', true),
      slot('ST', 0.0, 0.80, 9, 'fwd'),
    ],
  },
};

export const FORMATION_KEYS = Object.keys(FORMATIONS);

/* Substitutes available per team */
export const BENCH_SIZE = 5;
export const MAX_SUBS = 3;
export const BENCH_ROLES = ['GK', 'CB', 'FB', 'CM', 'ST'];

export const DIFFICULTY = {
  easy: {
    label: 'Amateur',
    reaction: 0.34,
    passError: 3.2,
    shotError: 0.30,
    tackleChance: 0.38,
    press: 0.6,
    speed: 0.9,
    gkReach: 1.65,
    // AI keeper only: how far he mis-reads a shot (m) and how often he keeps
    // a shot out when he does get there. The human team's keeper is sharper.
    gkError: 3.4,
    gkSave: 0.42,
    supportRuns: 0.5,
  },
  normal: {
    label: 'Professional',
    reaction: 0.22,
    passError: 2.1,
    shotError: 0.20,
    tackleChance: 0.52,
    press: 0.85,
    speed: 0.98,
    gkReach: 1.85,
    gkError: 2.8,
    gkSave: 0.5,
    supportRuns: 0.8,
  },
  hard: {
    label: 'Legend',
    reaction: 0.13,
    passError: 1.3,
    shotError: 0.12,
    tackleChance: 0.66,
    press: 1.0,
    speed: 1.05,
    gkReach: 2.1,
    gkError: 2.3,
    gkSave: 0.58,
    supportRuns: 1.0,
  },
};

export const SETTINGS_DEFAULTS = {
  difficulty: 'normal',
  formation: '4-3-3',
  halfMinutes: MATCH.defaultHalfMinutes,
  autoSwitch: true,
  sound: true,
  camera: 'action',
  // 'desktop' = keyboard/mouse + gamepad, 'touch' = on-screen mobile pad
  controls: 'auto',
  // mobile pad layout: 'fc' = FC Mobile-style buttons, 'dls' = DLS-like gestures
  touchLayout: 'fc',
};

export const HALF_SECONDS = (minutes) => Math.round(minutes * 60);
