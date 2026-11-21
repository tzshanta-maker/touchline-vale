import {
  ARCHETYPES,
  BENCH_ROLES,
  BENCH_SIZE,
  FORMATIONS,
  FORMATION_KEYS,
  PITCH,
  STAT_KEYS,
  TEAMS,
} from '../config.js';

/* Deterministic RNG so squad attributes are stable across restarts and screens */
function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOME_NAMES = [
  'VOSS', 'LUND', 'BRANDT', 'ADEYEMI', 'QUIST', 'FERRANTE', 'MORROW', 'SANDOVAL',
  'KOBE', 'HALVORSEN', 'RIOS', 'PETERSEN', 'VASQUEZ', 'OKONJO', 'MARCHETTI',
  'TOLEDO', 'BAKER', 'IWUCHUKWU', 'SEGURA', 'HOLM',
];

const AWAY_NAMES = [
  'OKAFOR', 'MENDES', 'STEIN', 'VARGAS', 'PETROV', 'ALMEIDA', 'DUNNE', 'KOVAC',
  'BRUNO', 'SILVA', 'ROSSI', 'LARSEN', 'CABRAL', 'MUTOMBO', 'FISCHER',
  'REYES', 'YILMAZ', 'ADAMS', 'PINTO', 'SCHULZ',
];

/** position family for a role string */
export function roleFamily(role) {
  if (!role) return 'CM';
  if (role === 'GK') return 'GK';
  if (role.includes('WB')) return 'WB';
  if (role === 'RB' || role === 'LB' || role === 'FB') return 'FB';
  if (role.includes('CB') || role === 'CB') return 'CB';
  if (role.includes('DM')) return 'DM';
  if (role.includes('AM')) return 'AM';
  if (role === 'RW' || role === 'LW' || role === 'RM' || role === 'LM' || role === 'W') return 'W';
  if (role.includes('ST') || role === 'CF' || role === 'SS' || role === 'RS' || role === 'LS') return 'ST';
  return 'CM';
}

export function roleLine(role) {
  const fam = roleFamily(role);
  if (fam === 'GK') return 'gk';
  if (fam === 'CB' || fam === 'FB' || fam === 'WB') return 'def';
  if (fam === 'DM' || fam === 'CM' || fam === 'AM') return 'mid';
  return 'fwd';
}

const clampStat = (v) => Math.max(32, Math.min(97, Math.round(v)));

function rollStats(role, rnd, quality) {
  const arch = ARCHETYPES[roleFamily(role)] || ARCHETYPES.CM;
  const stats = {};
  for (const key of STAT_KEYS) {
    stats[key] = clampStat(arch[key] + (rnd() - 0.5) * 20 + quality);
  }
  return stats;
}

export function overall(stats, role) {
  const fam = roleFamily(role);
  if (fam === 'GK') {
    return Math.round(stats.defending * 0.55 + stats.physical * 0.2 + stats.passing * 0.15 + stats.pace * 0.1);
  }
  const weights = {
    GK: { defending: 0.55, physical: 0.2 },
    CB: { defending: 0.45, physical: 0.25, pace: 0.15, passing: 0.15 },
    FB: { pace: 0.25, defending: 0.3, passing: 0.2, dribbling: 0.15, physical: 0.1 },
    WB: { pace: 0.3, defending: 0.2, passing: 0.2, dribbling: 0.2, physical: 0.1 },
    DM: { defending: 0.35, passing: 0.25, physical: 0.2, dribbling: 0.1, shooting: 0.1 },
    CM: { passing: 0.32, dribbling: 0.22, shooting: 0.18, defending: 0.15, physical: 0.13 },
    AM: { passing: 0.3, dribbling: 0.3, shooting: 0.25, pace: 0.15 },
    W: { dribbling: 0.32, pace: 0.28, shooting: 0.22, passing: 0.18 },
    ST: { shooting: 0.4, pace: 0.25, dribbling: 0.2, physical: 0.15 },
  }[fam] || { passing: 0.3, dribbling: 0.3, shooting: 0.2, defending: 0.2 };
  let total = 0;
  let weight = 0;
  for (const [k, w] of Object.entries(weights)) {
    total += stats[k] * w;
    weight += w;
  }
  return Math.round(total / weight);
}

/**
 * Builds a 16-player squad for a team: 11 starters matching `formationKey`
 * plus BENCH_SIZE substitutes. Each player carries its own attribute block.
 */
export function buildSquad(teamKey, formationKey = '4-3-3') {
  const team = TEAMS[teamKey];
  const formation = FORMATIONS[formationKey] ? formationKey : '4-3-3';
  const slots = FORMATIONS[formation].slots;
  const names = teamKey === 'home' ? HOME_NAMES : AWAY_NAMES;
  // fixed seed per team keeps numbers identical on every screen and every match
  const rnd = mulberry32(teamKey === 'home' ? 0x51ab3 : 0x9f21c);
  const quality = teamKey === 'home' ? 3 : 1;

  const used = new Set();
  const pickName = () => {
    for (let i = 0; i < names.length; i++) {
      const idx = Math.floor(rnd() * names.length);
      if (!used.has(names[idx])) {
        used.add(names[idx]);
        return names[idx];
      }
    }
    return names.find((n) => !used.has(n)) || `PLAYER ${used.size + 1}`;
  };

  const starters = slots.map((s, i) => {
    // the keeper always wears 1, the rest follow the formation's shirt numbers
    const number = s.role === 'GK' ? 1 : s.number;
    const stats = rollStats(s.role, rnd, quality);
    return {
      team,
      role: s.role,
      number,
      name: pickName(),
      isGK: s.role === 'GK',
      slot: s,
      line: s.line,
      wide: !!s.wide,
      index: i,
      slotIndex: i,
      stats,
      overall: overall(stats, s.role),
      bench: false,
    };
  });

  const benchNumbers = [12, 13, 14, 15, 16];
  const bench = BENCH_ROLES.slice(0, BENCH_SIZE).map((role, i) => {
    const stats = rollStats(role, rnd, quality - 3);
    return {
      team,
      role,
      number: benchNumbers[i],
      name: pickName(),
      isGK: role === 'GK',
      slot: { role, x: 0, z: 0.4, number: benchNumbers[i], line: roleLine(role), wide: false },
      line: roleLine(role),
      wide: false,
      index: 11 + i,
      slotIndex: -1,
      stats,
      overall: overall(stats, role),
      bench: true,
    };
  });

  return { team, formation, formationLabel: FORMATIONS[formation].label, starters, bench };
}

/** Random formation that differs from `avoid` (used for the AI team each match). */
export function randomFormation(avoid = null, seed = null) {
  const options = FORMATION_KEYS.filter((k) => k !== avoid);
  const rnd = seed === null ? Math.random : mulberry32(seed);
  return options[Math.floor(rnd() * options.length) % options.length];
}

/** Colour/name descriptors for the squad screen. */
export function squadForDisplay(teamKey, formationKey) {
  return buildSquad(teamKey, formationKey);
}

/** Formation slot -> world position for a team attacking in `dir` (+1 = +z). */
export function formationWorld(slot, dir, mirror, out = { x: 0, z: 0 }) {
  out.x = slot.x * PITCH.halfW * 0.9 * mirror;
  out.z = (slot.z - 0.5) * PITCH.length * dir;
  return out;
}

export function roleBounds(role) {
  const line = roleLine(role);
  if (line === 'gk') return { attackZ: 0.06, defZ: 0.03, lateral: 0.1 };
  if (line === 'def') return { attackZ: 0.55, defZ: 0.15, lateral: 0.8 };
  if (line === 'mid') return { attackZ: 0.65, defZ: 0.35, lateral: 0.7 };
  return { attackZ: 0.9, defZ: 0.44, lateral: 0.5 };
}
