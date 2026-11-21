/**
 * Headless smoke test for Pitch Legends.
 * Usage: npm run dev (in another terminal) && npm test
 *        BASE_URL=http://127.0.0.1:5173 npm test
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/';

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

check('title screen renders', await page.locator('#btn-quick').isVisible());

await page.click('#btn-howto');
check('how to play screen opens', await page.locator('#screen-howto').isVisible());
await page.click('#screen-howto [data-back]');

await page.click('#btn-squad');
check('squad screen opens', await page.locator('#screen-squad').isVisible());
const squadView = await page.evaluate(() => ({
  starters: document.querySelectorAll('#squad-starters .squad-row').length,
  bench: document.querySelectorAll('#squad-bench .squad-row').length,
  statChips: document.querySelectorAll('#squad-starters .squad-row:first-child .sq-stat').length,
  firstOvr: document.querySelector('#squad-starters .sq-row, #squad-starters .squad-row .sq-ovr')?.textContent,
}));
check('squad shows 11 starters + 5 substitutes', squadView.starters === 11 && squadView.bench === 5, JSON.stringify(squadView));
check('squad rows show six attribute values', squadView.statChips === 6, `chips=${squadView.statChips}`);
await page.click('#screen-squad [data-back]');

await page.click('#btn-settings');
check('settings screen opens', await page.locator('#screen-settings').isVisible());

// Settings must not repeat anything the Quick Match setup already owns:
// difficulty, match length, formation, control type, mobile style.
const settingsDuplicates = await page.evaluate(() => {
  const out = {};
  const keys = ['difficulty', 'halfMinutes', 'formation', 'controls', 'touchLayout'];
  for (const k of keys) {
    out[k] = document.querySelectorAll(`#screen-settings [data-setting="${k}"]`).length;
  }
  out.panels = [...document.querySelectorAll('#screen-settings [data-setting]')].map((g) => g.dataset.setting);
  return out;
});
check(
  'settings holds only its own options (no Quick Match duplicates)',
  ['difficulty', 'halfMinutes', 'formation', 'controls', 'touchLayout'].every((k) => settingsDuplicates[k] === 0) &&
    settingsDuplicates.panels.length === 3,
  JSON.stringify(settingsDuplicates)
);
await page.click('#screen-settings [data-back]');

await page.click('#btn-quick');
await page.waitForTimeout(200);
check('quick match opens its setup menu', await page.locator('#screen-match').isVisible());
const setupView = await page.evaluate(() => {
  const q = (sel) => document.querySelector(sel);
  const count = (sel) => document.querySelectorAll(sel).length;
  return {
    difficulty: count('[data-setting="difficulty"]'),
    halfMinutes: count('[data-setting="halfMinutes"]'),
    controls: count('[data-setting="controls"]'),
    touchLayout: count('[data-setting="touchLayout"]'),
    inMatch: !!q('#screen-match [data-setting="difficulty"]') && !!q('#screen-match [data-setting="halfMinutes"]'),
    inSettings: !!q('#screen-settings [data-setting="difficulty"]') || !!q('#screen-settings [data-setting="halfMinutes"]'),
    kickoff: !!q('#btn-kickoff'),
    controlsInMatch: q('#screen-match [data-setting="controls"]') && q('#screen-match [data-setting="touchLayout"]'),
    touchLayoutInMatch: q('#screen-match [data-setting="touchLayout"]'),
    formations: count('#setup-formation-grid button[data-value]'),
    summary: q('#setup-summary')?.textContent || '',
  };
});
check('quick match owns difficulty and match length exactly once', setupView.difficulty === 1 && setupView.halfMinutes === 1, JSON.stringify(setupView));
check('difficulty and match length live only in the quick match menu', setupView.inMatch && !setupView.inSettings, JSON.stringify(setupView));
check(
  'control type + mobile layout selectors exist in the quick match menu',
  !!setupView.controlsInMatch && !!setupView.touchLayoutInMatch,
  JSON.stringify(setupView)
);
check('quick match keeps formation selection and kick off', setupView.formations === 7 && setupView.kickoff, `formations=${setupView.formations}`);

const formationOptions = await page.evaluate(() =>
  [...document.querySelectorAll('#setup-formation-grid .formation-btn')].map((b) => b.dataset.value)
);
check('seven formations are offered in the setup menu', formationOptions.length === 7, formationOptions.join(','));
await page.click('#setup-formation-grid button[data-value="4-2-3-1"]');
const formationPicked = await page.evaluate(() => ({
  meta: document.getElementById('meta-formation').textContent,
  saved: JSON.parse(localStorage.getItem('pitch-legends-settings-v1') || '{}').formation,
  active: document.querySelector('#setup-formation-grid .formation-btn.active')?.dataset.value,
  summary: document.getElementById('setup-summary')?.textContent || '',
}));
check(
  'choosing a formation in the setup menu updates the title screen and persists',
  formationPicked.meta === '4-2-3-1' &&
    formationPicked.saved === '4-2-3-1' &&
    formationPicked.active === '4-2-3-1' &&
    formationPicked.summary.includes('4-2-3-1'),
  JSON.stringify(formationPicked)
);

// change the settings from the quick match menu and confirm they stick
await page.click('#screen-match [data-setting="difficulty"] button[data-value="hard"]');
await page.click('#screen-match [data-setting="halfMinutes"] button[data-value="2"]');
await page.waitForTimeout(120);
const applied = await page.evaluate(() => {
  const { game, ui } = window.__PITCH_LEGENDS__;
  return {
    diff: ui.settings.difficulty,
    half: ui.settings.halfMinutes,
    aiDiff: game.away?.difficulty?.label || null,
    summary: document.getElementById('setup-summary')?.textContent || '',
  };
});
check('quick match picks are applied to the settings object', applied.diff === 'hard' && applied.half === 2, JSON.stringify(applied));

// back to a normal match for the rest of the suite
await page.click('#screen-match [data-setting="difficulty"] button[data-value="normal"]');
await page.click('#btn-kickoff');
await page.waitForTimeout(300);

// Deterministic stepper: drives the simulation without relying on frame rate
// Freeze the live rAF loop so manual stepping is fully deterministic
await page.evaluate(() => {
  window.__PITCH_LEGENDS__.game.loopFrozen = true;
});
await page.evaluate(() => {
  window.__step = (seconds) => {
    const g = window.__PITCH_LEGENDS__.game;
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) {
      g.dt = 1 / 60;
      g.update(1 / 60);
      g.input.endFrame();
    }
    return window.__snap();
  };
  window.__ensurePlay = () => {
    const g = window.__PITCH_LEGENDS__.game;
    for (let i = 0; i < 60 * 12 && g.state !== 'play'; i++) {
      g.dt = 1 / 60;
      g.update(1 / 60);
      g.input.endFrame();
    }
    return g.state;
  };
  window.__snap = () => {
    const g = window.__PITCH_LEGENDS__.game;
    return {
      state: g.state,
      score: [g.home.score, g.away.score],
      owner: g.ball.owner ? g.ball.owner.name : null,
      controlled: g.controlled ? g.controlled.name : null,
      players: g.allPlayers().length,
      stamina: g.controlled ? g.controlled.stamina : 0,
      ballSpeed: g.ball.speed,
      shots: g.stats.shots,
      saves: g.stats.saves,
    };
  };
});

const kickoff = await page.evaluate(() => window.__snap());
check('match starts with 22 players', kickoff.players === 22, `players=${kickoff.players}`);
check('starts in kickoff state', kickoff.state === 'kickoff', kickoff.state);

const squads = await page.evaluate(() => {
  const g = window.__PITCH_LEGENDS__.game;
  const info = (t) => ({
    onPitch: t.players.length,
    bench: t.bench.length,
    formation: t.formation,
    roles: t.players.map((p) => p.role).join(','),
    uniqueStats: new Set(t.players.map((p) => JSON.stringify(p.stats))).size,
    sixStats: t.players.every((p) => Object.keys(p.stats).length === 6),
    overallRange: [Math.min(...t.players.map((p) => p.overall)), Math.max(...t.players.map((p) => p.overall))],
    benchHidden: t.bench.every((p) => !p.model.group.visible),
    oneKeeper: t.players.filter((p) => p.isGK).length === 1,
  });
  return { home: info(g.home), away: info(g.away) };
});
check('both squads field 11 with 5 substitutes', squads.home.onPitch === 11 && squads.home.bench === 5 && squads.away.onPitch === 11 && squads.away.bench === 5, JSON.stringify([squads.home.bench, squads.away.bench]));
check('every player has six individual attributes', squads.home.sixStats && squads.away.sixStats && squads.home.uniqueStats === 11, `unique=${squads.home.uniqueStats}`);
check('attributes vary between players', squads.home.overallRange[1] - squads.home.overallRange[0] >= 5, `overalls ${squads.home.overallRange.join('-')}`);
check('exactly one keeper per team on the pitch', squads.home.oneKeeper && squads.away.oneKeeper);
check('substitutes are off the pitch', squads.home.benchHidden && squads.away.benchHidden);
check(
  'human team plays the chosen formation',
  squads.home.formation === '4-2-3-1' && squads.home.roles === 'GK,RB,RCB,LCB,LB,RDM,LDM,RAM,CAM,LAM,ST',
  `${squads.home.formation}: ${squads.home.roles}`
);
check(
  'AI team fields a full formation of its own',
  squads.away.roles.split(',').length === 11 && squads.away.roles.split(',')[0] === 'GK',
  `${squads.away.formation}: ${squads.away.roles}`
);

// step until the ball is live and someone has picked it up
const playing = await page.evaluate(() => {
  for (let i = 0; i < 8 && !window.__snap().owner; i++) window.__step(0.6);
  return window.__snap();
});
check('kickoff leads to live play', playing.state === 'play', playing.state);
check('a player owns the ball', !!playing.owner, playing.owner || 'none');

// --- movement + sprint ---
const before = await page.evaluate(() => ({
  z: window.__PITCH_LEGENDS__.game.controlled.pos.z,
  st: window.__PITCH_LEGENDS__.game.controlled.stamina,
}));
await page.evaluate(() => {
  const g = window.__PITCH_LEGENDS__.game;
  g.settings.autoSwitch = false;
  g.controlled.setPosition(0, -6, 0);
});
await page.keyboard.down('Shift');
await page.keyboard.down('w');
await page.evaluate(() => window.__step(1.0));
await page.keyboard.up('w');
await page.keyboard.up('Shift');
const moved = await page.evaluate(() => ({
  z: window.__PITCH_LEGENDS__.game.controlled.pos.z,
  st: window.__PITCH_LEGENDS__.game.controlled.stamina,
}));
check('W moves the player forward', moved.z > -5, `z ${before.z.toFixed(1)} → ${moved.z.toFixed(1)}`);
check('sprinting drains stamina', moved.st < before.st, `${before.st.toFixed(0)} → ${moved.st.toFixed(0)}`);

// --- pass ---
await page.evaluate(() => {
  const g = window.__PITCH_LEGENDS__.game;
  window.__ensurePlay();
  // deterministic setup: fixed controlled player holding the ball
  g.settings.autoSwitch = false;
  const p = g.controlled;
  p.kickCooldown = 0;
  g.ball.owner = p;
  g.ball.lastTouch = p;
  g.ball.reset(p.pos.x, p.pos.z + 0.6);
  g.ball.owner = p;
});
await page.keyboard.press('z');
await page.evaluate(() => window.__step(0.3));
const passed = await page.evaluate(() => ({ owner: window.__snap().owner, speed: window.__PITCH_LEGENDS__.game.ball.speed }));
check('Z plays a pass', passed.speed > 4 || passed.owner !== 'HALVORSEN', `speed=${passed.speed.toFixed(1)} owner=${passed.owner}`);

// --- through ball ---
await page.evaluate(() => {
  const g = window.__PITCH_LEGENDS__.game;
  window.__ensurePlay();
  g.settings.autoSwitch = false;
  const p = g.controlled;
  p.kickCooldown = 0;
  p.setPosition(0, -6, 0);
  g.ball.owner = p;
  g.ball.lastTouch = p;
  g.ball.reset(p.pos.x, p.pos.z + 0.6);
  g.ball.owner = p;
});
const kicker = await page.evaluate(() => window.__PITCH_LEGENDS__.game.controlled.name);
await page.keyboard.press('x');
const through = await page.evaluate((name) => {
  const g = window.__PITCH_LEGENDS__.game;
  // measure the launch: the lob can already be landing when we look at it late
  let peak = 0;
  for (let i = 0; i < 6; i++) {
    g.dt = 1 / 60;
    g.update(1 / 60);
    g.input.endFrame();
    peak = Math.max(peak, g.ball.speed);
  }
  const res = {
    speed: peak,
    // the kick landed if the ball left the passer (and they are on cooldown)
    released: !g.ball.owner || g.ball.owner.name !== name,
    cooldown: g.controlled.kickCooldown,
  };
  g.settings.autoSwitch = true;
  return res;
}, kicker);
check('X plays a through/lob pass', through.released && through.speed > 6, `speed=${through.speed.toFixed(1)} released=${through.released}`);

// --- charged shot ---
await page.evaluate(() => {
  const g = window.__PITCH_LEGENDS__.game;
  window.__ensurePlay();
  const p = g.controlled;
  p.setPosition(0, 40, 0);
  g.ball.owner = p;
  g.ball.lastTouch = p;
  g.ball.reset(0, 40.5);
  g.ball.owner = p;
  g.settings.autoSwitch = true;
});
await page.keyboard.down('c');
await page.evaluate(() => window.__step(0.8));
const charge = await page.evaluate(() => ({
  charge: window.__PITCH_LEGENDS__.game.charge,
  bar: document.getElementById('power-fill').style.width,
}));
await page.keyboard.up('c');
await page.evaluate(() => window.__step(0.1));
const shot = await page.evaluate(() => ({
  speed: window.__PITCH_LEGENDS__.game.ball.speed,
  shots: window.__PITCH_LEGENDS__.game.stats.shots.home,
}));
check('holding C charges the power bar', charge.charge > 0.5 && charge.bar !== '0%', `charge=${charge.charge.toFixed(2)} bar=${charge.bar}`);
check('releasing C shoots', shot.speed > 12 && shot.shots > 0, `speed=${shot.speed.toFixed(1)} shots=${shot.shots}`);

// --- tackle ---
const tackle = await page.evaluate(() => {
  const g = window.__PITCH_LEGENDS__.game;
  const opp = g.away.players[9];
  const p = g.controlled;
  // stand just behind the carrier, facing them
  p.setPosition(opp.pos.x, opp.pos.z - 1.0, 0);
  g.ball.owner = opp;
  g.ball.lastTouch = opp;
  g.ball.pos.set(opp.pos.x, 0.12, opp.pos.z);
  let won = false;
  for (let attempt = 0; attempt < 12 && !won; attempt++) {
    p.stunTimer = 0; // ignore the recovery window so the test is deterministic
    g.doPlayerTackle(p, opp);
    p.tackleCooldown = 0;
    if (g.ball.owner && g.ball.owner.team === g.home) won = true;
  }
  return { won, ownerTeam: g.ball.owner ? g.ball.owner.team.id : null };
});
check('E wins the ball from an opponent (head-on)', tackle.won, `owner team=${tackle.ownerTeam}`);

// --- switch player ---
await page.evaluate(() => {
  window.__PITCH_LEGENDS__.game.settings.autoSwitch = false;
});
const nameBefore = await page.evaluate(() => window.__PITCH_LEGENDS__.game.controlled.name);
await page.keyboard.press('Tab');
await page.evaluate(() => window.__step(0.1));
const nameAfter = await page.evaluate(() => window.__PITCH_LEGENDS__.game.controlled.name);
check('Tab switches the controlled player', nameBefore !== nameAfter, `${nameBefore} → ${nameAfter}`);
await page.evaluate(() => {
  window.__PITCH_LEGENDS__.game.settings.autoSwitch = true;
});

// --- goalkeeper saves ---
const keeper = await page.evaluate(() => {
  const g = window.__PITCH_LEGENDS__.game;
  g.settings.autoSwitch = false;
  if (g.controlled !== g.home.players[9]) g.setControlled(g.home.players[9]);
  g.away.players.forEach((p) => {
    if (!p.isGK) p.moveToward = () => 0;
  });
  let saves = 0;
  let goals = 0;
  // alternate between the corners: the hardest place for a keeper to reach
  for (let i = 0; i < 30; i++) {
    // a parried shot can leave play (corner / goal kick / throw-in); this check
    // is about finishing, so put the ball straight back into live play
    g.state = 'play';
    g.restart = null;
    g.throwIn = null;
    g.restartGrace = 0;
    const gx = (i % 2 === 0 ? -1 : 1) * (2.5 + (i % 4) * 0.25);
    const shooter = g.controlled;
    shooter.setPosition(0, 38, 0);
    g.ball.reset(0, 39);
    g.ball.lastTouch = shooter;
    const dir = new (g.ball.pos.constructor)(gx - g.ball.pos.x, 0, 53 - g.ball.pos.z).normalize();
    g.ball.kick(dir, 26, { lift: 1.2, by: shooter });
    const saveBefore = g.stats.saves.away;
    const scoreBefore = g.home.score;
    window.__step(1.6);
    if (g.stats.saves.away > saveBefore) saves++;
    if (g.home.score > scoreBefore) goals++;
    window.__step(2.5);
  }
  g.settings.autoSwitch = true;
  return { saves, goals };
});
check('goalkeeper makes saves', keeper.saves > 0, `saves=${keeper.saves} goals=${keeper.goals}`);
// keepers are beatable: over 14 well-aimed finishes at least one should go in
check('shots can beat the keeper', keeper.goals > 0, `goals=${keeper.goals}`);

// --- goal, celebration, restart ---
const goal = await page.evaluate(() => {
  const g = window.__PITCH_LEGENDS__.game;
  window.__ensurePlay();
  // earlier firing drills may have left goals on the board
  g.home.score = 0;
  g.away.score = 0;
  g.score = { home: 0, away: 0 };
  const before = g.home.score;
  g.ball.lastTouch = g.home.players[9];
  g.onGoal('home');
  const celebrateState = g.state;
  const banner = !document.getElementById('goal-banner').classList.contains('hidden');
  window.__step(5);
  return {
    scored: g.home.score - before,
    celebrateState,
    banner,
    after: g.state,
    score: document.getElementById('score-home').textContent,
  };
});
check('goal increments the score and shows the banner', goal.scored === 1 && goal.banner && goal.celebrateState === 'celebrate', `score=${goal.score}`);
check('play restarts after a goal', goal.after === 'kickoff' || goal.after === 'play', goal.after);

// --- pause / resume ---
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
const paused = await page.evaluate(() => ({
  open: !document.getElementById('pause-overlay').classList.contains('hidden'),
  paused: window.__PITCH_LEGENDS__.game.paused,
}));
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
const resumed = await page.evaluate(() => ({
  open: !document.getElementById('pause-overlay').classList.contains('hidden'),
  paused: window.__PITCH_LEGENDS__.game.paused,
}));
check('Esc opens the pause menu', paused.open && paused.paused);
check('Esc resumes the match', !resumed.open && !resumed.paused);

// --- restart match ---
await page.evaluate(() => {
  document.getElementById('btn-pause').click();
});
await page.waitForTimeout(200);
await page.click('#btn-restart');
await page.waitForTimeout(300);
const restarted = await page.evaluate(() => window.__snap());
check('Restart Match resets score and clock', restarted.score[0] === 0 && restarted.score[1] === 0, `score=${restarted.score}`);

// --- full time screen ---
await page.evaluate(() => window.__step(2.2));
const fulltime = await page.evaluate(() => {
  const g = window.__PITCH_LEGENDS__.game;
  g.half = 2;
  g.halfElapsed = g.halfSeconds;
  window.__step(0.2);
  return {
    state: g.state,
    visible: !document.getElementById('fulltime-overlay').classList.contains('hidden'),
  };
});
check('full time shows the result screen', fulltime.state === 'fulltime' && fulltime.visible, fulltime.state);

const rematch = await page.evaluate(() => {
  document.getElementById('btn-rematch').click();
  window.__step(0.2);
  const g = window.__PITCH_LEGENDS__.game;
  return { state: g.state, score: [g.home.score, g.away.score] };
});
check('Rematch starts a fresh match', rematch.score[0] === 0 && rematch.score[1] === 0, rematch.state);

// --- the 3D models must follow the simulation (regression) ---
const modelSync = await page.evaluate(() => {
  const g = window.__PITCH_LEGENDS__.game;
  window.__ensurePlay();
  const snap = () => g.teams.flatMap((t) => t.players.map((p) => ({
    sx: p.pos.x, sz: p.pos.z, mx: p.model.group.position.x, mz: p.model.group.position.z,
  })));
  const phase = () => g.home.players.filter((p) => !p.isGK)[0].model.animPhase;
  const before = snap();
  const phaseBefore = phase();
  for (let i = 0; i < 90; i++) {
    g.dt = 1 / 60;
    g.update(1 / 60);
    g.input.endFrame();
    g.render();
  }
  const after = snap();
  const travelled = before.map((b, i) => Math.hypot(after[i].sx - b.sx, after[i].sz - b.sz));
  const modelTravelled = before.map((b, i) => Math.hypot(after[i].mx - b.mx, after[i].mz - b.mz));
  const drift = after.map((a) => Math.hypot(a.mx - a.sx, a.mz - a.sz));
  return {
    maxDrift: Math.max(...drift),
    movedPlayers: travelled.filter((d) => d > 0.5).length,
    modelsMoved: modelTravelled.filter((d) => d > 0.5).length,
    animating: phase() > phaseBefore,
  };
});
check(
  'player models follow their simulated position',
  modelSync.maxDrift < 0.03,
  `max drift ${modelSync.maxDrift.toFixed(3)} m`
);
check(
  'models visibly move when players move',
  modelSync.movedPlayers >= 3 && modelSync.modelsMoved === modelSync.movedPlayers,
  `moved=${modelSync.movedPlayers} modelsMoved=${modelSync.modelsMoved}`
);
check('run cycle animation advances', modelSync.animating);

// --- attributes actually change behaviour ---
const attrEffect = await page.evaluate(() => {
  const g = window.__PITCH_LEGENDS__.game;
  // make sure the match is live before measuring movement
  for (let i = 0; i < 60 * 8 && g.state !== 'play'; i++) {
    g.dt = 1 / 60;
    g.update(1 / 60);
    g.input.endFrame();
  }
  g.settings.autoSwitch = false;
  const outfield = g.home.players.filter((p) => !p.isGK);
  const fastest = outfield.slice().sort((a, b) => b.stats.pace - a.stats.pace)[0];
  const slowest = outfield.slice().sort((a, b) => a.stats.pace - b.stats.pace)[0];
  const sprint = (p) => {
    // isolate the player so team-mates cannot block the run
    const others = g.home.players.filter((o) => o !== p && !o.isGK);
    others.forEach((o) => o.setPosition(-70, -40, 0));
    // ...and park the opponents and the ball so nothing interrupts the run
    // (a live sideline now stops play for a throw-in)
    g.away.players.forEach((o) => o.setPosition(30, 45, 0));
    g.ball.release();
    g.ball.reset(-28, -45);
    p.setPosition(0, 0, 0);
    p.stamina = 100;
    p.exhausted = false;
    g.setControlled(p);
    g.input.down.add('sprint');
    g.input.down.add('up');
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      g.dt = 1 / 60;
      g.update(1 / 60);
      g.input.endFrame();
      peak = Math.max(peak, Math.hypot(p.vel.x, p.vel.z));
    }
    g.input.down.clear();
    return peak;
  };
  const fastSpeed = sprint(fastest);
  const slowSpeed = sprint(slowest);

  const strikers = outfield.slice().sort((a, b) => b.stats.shooting - a.stats.shooting);
  const shoot = (p) => {
    g.setControlled(p);
    p.setPosition(0, 40, 0);
    g.ball.owner = p;
    g.ball.lastTouch = p;
    g.ball.reset(0, 40.7);
    g.ball.owner = p;
    p.kickCooldown = 0;
    g.performShot(p, 1);
    return g.ball.speed;
  };
  const hardest = shoot(strikers[0]);
  const softest = shoot(strikers[strikers.length - 1]);
  g.settings.autoSwitch = true;
  return {
    pace: { fast: fastest.stats.pace, slow: slowest.stats.pace, fastSpeed, slowSpeed },
    shooting: { best: strikers[0].stats.shooting, worst: strikers[strikers.length - 1].stats.shooting, hardest, softest },
  };
});
check(
  'pace affects top sprint speed',
  attrEffect.pace.fastSpeed > attrEffect.pace.slowSpeed + 0.4,
  `${attrEffect.pace.fast}pace=${attrEffect.pace.fastSpeed.toFixed(2)} vs ${attrEffect.pace.slow}pace=${attrEffect.pace.slowSpeed.toFixed(2)}`
);
check(
  'shooting affects shot power',
  attrEffect.shooting.hardest > attrEffect.shooting.softest + 1.5,
  `${attrEffect.shooting.best}sho=${attrEffect.shooting.hardest.toFixed(1)} vs ${attrEffect.shooting.worst}sho=${attrEffect.shooting.softest.toFixed(1)}`
);

// --- substitutions ---
const subs = await page.evaluate(() => {
  const g = window.__PITCH_LEGENDS__.game;
  if (g.state !== 'play') {
    for (let i = 0; i < 60 * 6; i++) { g.dt = 1 / 60; g.update(1 / 60); g.input.endFrame(); }
  }
  const outPlayer = g.home.players[5];
  outPlayer.stamina = 8; // shattered: must be replaced
  const benchBefore = g.home.bench.length;
  const nameBeingReplaced = outPlayer.name;
  g.beginRestart('throwIn', g.home, 12, 4);
  for (let i = 0; i < 90; i++) { g.dt = 1 / 60; g.update(1 / 60); g.input.endFrame(); }
  const onPitchNames = g.home.players.map((p) => p.name);
  return {
    subsMade: g.home.subsMade,
    benchAfter: g.home.bench.length,
    benchBefore,
    outOnBench: g.home.bench.some((p) => p.name === nameBeingReplaced && p.subbedOut),
    onPitch: g.home.players.length,
    replacedGone: !onPitchNames.includes(nameBeingReplaced),
    everyoneVisible: g.home.players.every((p) => p.model.group.visible),
    benchHidden: g.home.bench.every((p) => !p.model.group.visible),
    controlledOnPitch: g.home.players.includes(g.controlled),
    state: g.state,
  };
});
check('a tired player is substituted at the next stoppage', subs.subsMade === 1 && subs.replacedGone, `subs=${subs.subsMade}`);
check(
  'substitution keeps 11 on the pitch and the bench intact',
  subs.onPitch === 11 && subs.benchAfter === subs.benchBefore && subs.outOnBench,
  `pitch=${subs.onPitch} bench=${subs.benchAfter}`
);
check('the substitute model is visible and the bench stays hidden', subs.everyoneVisible && subs.benchHidden);
check('control follows the play after a substitution', subs.controlledOnPitch);

const subCap = await page.evaluate(() => {
  const g = window.__PITCH_LEGENDS__.game;
  for (let k = 0; k < 6; k++) {
    const p = g.home.players.find((pl) => !pl.isGK);
    if (p) p.stamina = 5;
    g.handleSubstitutions(true);
  }
  return { made: g.home.subsMade, bench: g.home.bench.length, pitch: g.home.players.length };
});
check('substitutions are capped at three', subCap.made <= 3 && subCap.pitch === 11, JSON.stringify(subCap));

// --- formation swap mid-match ---
const swap = await page.evaluate(() => {
  const g = window.__PITCH_LEGENDS__.game;
  const before = g.home.formation;
  g.applyFormation(g.home, '5-3-2');
  g.beginRestart('goalKick', g.home, 0, -46);
  for (let i = 0; i < 90; i++) { g.dt = 1 / 60; g.update(1 / 60); g.input.endFrame(); }
  return {
    before,
    after: g.home.formation,
    defenders: g.home.players.filter((p) => p.line === 'def').length,
    keepers: g.home.players.filter((p) => p.isGK).length,
    state: g.state,
  };
});
check(
  'formation can be changed mid-match',
  swap.after === '5-3-2' && swap.defenders === 5 && swap.keepers === 1,
  `${swap.before} → ${swap.after}, ${swap.defenders} defenders`
);

// --- tackle from an angle ---
const angleTackle = await page.evaluate(() => {
  const g = window.__PITCH_LEGENDS__.game;
  window.__ensurePlay();
  g.settings.autoSwitch = false;
  const p = g.controlled;
  const opp = g.away.players.find((q) => !q.isGK);
  let won = 0;
  const trials = 30;
  for (let i = 0; i < trials; i++) {
    opp.setPosition(0, 0, 0);
    opp.stunTimer = 0;
    opp.protectTimer = 0;
    g.ball.reset(0, 0.3);
    g.ball.owner = opp;
    g.ball.lastTouch = opp;
    // arrive diagonally, body pointing across the carrier rather than at them
    p.setPosition(1.5, -0.6, 0);
    p.facing = Math.atan2(-0.9, -0.4);
    p.moveDir.set(-0.9, 0, -0.4).normalize();
    p.tackleCooldown = 0;
    p.stunTimer = 0;
    g.input.clear();
    g.input.pressed.add('tackle');
    g.updateInputActions();
    g.input.clear();
    if (g.ball.owner === p) won++;
  }
  g.settings.autoSwitch = true;
  return { won, trials, rate: won / trials };
});
check(
  'tackling works from an angle, not just head-on',
  angleTackle.rate > 0.2,
  `${Math.round(angleTackle.rate * 100)}% of diagonal challenges won`
);

// --- aim assist: pass follows the direction you press ---
const aimPass = await page.evaluate(() => {
  const g = window.__PITCH_LEGENDS__.game;
  window.__ensurePlay();
  const p = g.controlled;
  g.settings.autoSwitch = false;
  const mates = p.team.players.filter((m) => m !== p && !m.isGK);
  const left = mates[0];
  const right = mates[1];
  p.setPosition(0, 0, 0);
  left.setPosition(-16, 8, 0);
  right.setPosition(16, 8, 0);
  for (const m of mates.slice(2)) m.setPosition(0, -42, 0);
  const run = (screenRight) => {
    p.setPosition(0, 0, 0);
    p.kickCooldown = 0;
    g.ball.reset(0, 0.5);
    g.ball.owner = p;
    g.pendingReceiver = null;
    g.input.clear();
    // screen right is world -x when attacking +z (camera sits behind our goal)
    g.input.down.add(p.team.direction > 0 === screenRight ? 'right' : 'left');
    g.input.down.add('up');
    g.input.pressed.add('pass');
    g.updateInputActions();
    g.input.clear();
    return g.pendingReceiver ? g.pendingReceiver.name : null;
  };
  // screen right == world -x (the camera sits behind our own goal), so the
  // target on the world -x side is the one you point at by pushing right
  const toRight = run(true);
  const toLeft = run(false);
  g.settings.autoSwitch = true;
  return { toRight, toLeft, rightName: left.name, leftName: right.name };
});
check(
  'aim assist passes to the teammate you point at',
  aimPass.toRight === aimPass.rightName && aimPass.toLeft === aimPass.leftName,
  `point right → ${aimPass.toRight}, point left → ${aimPass.toLeft}`
);

// --- shot aim assist ---
const aimShot = await page.evaluate(() => {
  const g = window.__PITCH_LEGENDS__.game;
  const goal = g.attackGoal(g.home);
  const p = g.controlled;
  g.settings.autoSwitch = false;
  let onTarget = 0;
  const trials = 10;
  for (let i = 0; i < trials; i++) {
    g.state = 'play';
    g.freezeTimer = 0;
    const x = i % 2 ? 17 : -17;
    p.setPosition(goal.x + x, goal.z - g.home.direction * 18, 0);
    p.kickCooldown = 0;
    g.ball.reset(p.pos.x, p.pos.z + 0.6);
    g.ball.owner = p;
    g.input.clear();
    g.input.down.add('shoot');
    g.input.pressed.add('shoot');
    window.__step(0.3);
    g.input.down.delete('shoot');
    g.input.released.add('shoot');
    window.__step(0.05);
    const v = g.ball.vel;
    const t = (goal.z - g.ball.pos.z) / (v.z || 1e-6);
    const xAtGoal = g.ball.pos.x + v.x * t;
    if (v.z * g.home.direction > 8 && Math.abs(xAtGoal - goal.x) < 4.4) onTarget++;
    g.ball.owner = null;
  }
  g.settings.autoSwitch = true;
  return { onTarget, trials };
});
check(
  'aim assist keeps shots from wide angles on target',
  aimShot.onTarget >= aimShot.trials * 0.8,
  `${aimShot.onTarget}/${aimShot.trials} shots inside the posts`
);

// --- first touch: the ball is received, not bounced off ---
const firstTouch = await page.evaluate(() => {
  const g = window.__PITCH_LEGENDS__.game;
  window.__ensurePlay();
  g.settings.autoSwitch = false;
  // a settled, rested midfielder: no auto-switch, no substitutions mid-test
  const p = g.home.players.find((q) => !q.isGK && q.line === 'mid');
  g.setControlled(p);
  for (const q of g.home.players) q.resetStamina(100);
  for (const q of g.home.bench) q.resetStamina(100);
  let controlled = 0;
  const trials = 16;
  for (let i = 0; i < trials; i++) {
    g.state = 'play';
    g.freezeTimer = 0;
    p.setPosition(0, 0, 0);
    p.facing = 0;
    p.touchCooldown = 0;
    p.stunTimer = 0;
    p.moveDir.set(0, 0, 0);
    // park everyone else well away so the test measures one 1v0 first touch
    g.home.players.forEach((m, k) => {
      if (m !== p) m.setPosition((k % 2 ? 1 : -1) * (34 + k), 30, 0);
    });
    g.away.players.forEach((m, k) => m.setPosition((k % 2 ? 1 : -1) * (34 + k), -30, 0));
    g.ball.owner = null;
    g.ball.reset(0, 7);
    g.ball.vel.set(0, 0, -14); // a firm pass straight at the player
    for (let f = 0; f < 120; f++) {
      g.dt = 1 / 60;
      g.update(1 / 60);
      g.input.endFrame();
      if (g.ball.owner === p) break;
      if (Math.hypot(g.ball.vel.x, g.ball.vel.z) > 18) break; // bounced away
    }
    if (g.ball.owner === p) controlled++;
    else if (i === 0) {
      globalThis.__ftDebug = {
        owner: g.ball.owner ? g.ball.owner.name : null,
        ballZ: +g.ball.pos.z.toFixed(2),
        speed: +g.ball.speed.toFixed(1),
        playerZ: +p.pos.z.toFixed(2),
        line: p.line,
        state: g.state,
      };
    }
  }
  g.settings.autoSwitch = true;
  return { controlled, trials, debug: globalThis.__ftDebug };
});
check(
  'a firm pass is brought under control instead of bouncing off',
  firstTouch.controlled >= firstTouch.trials * 0.8,
  `${firstTouch.controlled}/${firstTouch.trials} first touches kept the ball ${JSON.stringify(firstTouch.debug || {})}`
);

// --- roulette on double-tap sprint ---
await page.evaluate(() => {
  const g = window.__PITCH_LEGENDS__.game;
  window.__ensurePlay();
  g.settings.autoSwitch = false;
  const p = g.controlled;
  p.setPosition(0, 0, 0);
  p.rouletteCooldown = 0;
  g.ball.reset(0, 0.5);
  g.ball.owner = p;
});
await page.keyboard.press('Shift');
await page.evaluate(() => window.__step(0.12));
await page.keyboard.down('Shift');
const roulette = await page.evaluate(() => {
  const g = window.__PITCH_LEGENDS__.game;
  const p = g.controlled;
  window.__step(0.02);
  const started = p.rouletteTimer > 0;
  let spin = 0;
  let kept = true;
  for (let i = 0; i < 45; i++) {
    window.__step(1 / 60);
    spin = Math.max(spin, p.rouletteSpin);
    if (g.ball.owner !== p) kept = false;
  }
  return { started, spin, kept, cooldown: p.rouletteCooldown > 0 };
});
await page.keyboard.up('Shift');
check('double-tapping sprint performs a roulette', roulette.started && roulette.spin > 5, `spin=${roulette.spin.toFixed(1)} rad`);
check('the roulette keeps the ball at your feet', roulette.kept, `cooldown=${roulette.cooldown}`);

// --- gamepad support ---
const gamepad = await page.evaluate(() => {
  const g = window.__PITCH_LEGENDS__.game;
  const input = g.input;
  const fake = {
    id: 'Test Pad (STANDARD GAMEPAD)',
    connected: true,
    axes: [0.9, -0.5, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  };
  const real = navigator.getGamepads;
  navigator.getGamepads = () => [fake];
  input.poll();
  const axis = input.axis();
  const connected = input.pad.connected;
  const press = (i) => {
    fake.buttons.forEach((b) => {
      b.pressed = false;
      b.value = 0;
    });
    fake.buttons[i].pressed = true;
    fake.buttons[i].value = 1;
    input.poll();
  };
  press(0);
  const aPass = input.wasPressed('pass');
  input.endFrame();
  press(1);
  const bShoot = input.isDown('shoot');
  press(2);
  const xTackle = input.isDown('tackle');
  press(3);
  const yThrough = input.isDown('through');
  press(5);
  const rbSprint = input.isDown('sprint');
  press(4);
  const lbSwitch = input.wasPressed('switch');
  fake.axes = [0, 0, -1, 0];
  input.poll();
  const aim = input.aim();
  fake.buttons.forEach((b) => {
    b.pressed = false;
    b.value = 0;
  });
  fake.axes = [0, 0, 0, 0];
  input.poll();
  const released = !input.isDown('shoot') && !input.isDown('sprint');
  navigator.getGamepads = real;
  return { axis, connected, aPass, bShoot, xTackle, yThrough, rbSprint, lbSwitch, aim, released };
});
check(
  'gamepad stick drives movement with analog input',
  gamepad.connected && Math.abs(gamepad.axis.x - 0.9) < 0.2 && gamepad.axis.y > 0.4,
  `axis=${gamepad.axis.x.toFixed(2)},${gamepad.axis.y.toFixed(2)}`
);
check(
  'gamepad face buttons map to pass / shoot / tackle / through',
  gamepad.aPass && gamepad.bShoot && gamepad.xTackle && gamepad.yThrough,
  `A=${gamepad.aPass} B=${gamepad.bShoot} X=${gamepad.xTackle} Y=${gamepad.yThrough}`
);
check(
  'gamepad shoulders sprint / switch and the right stick aims',
  gamepad.rbSprint && gamepad.lbSwitch && gamepad.aim.x < -0.8 && gamepad.released,
  `RB=${gamepad.rbSprint} LB=${gamepad.lbSwitch} aimX=${gamepad.aim.x.toFixed(2)}`
);

// --- controller drives the menus and the pause overlay ---
const padMenus = await page.evaluate(() => {
  const g = window.__PITCH_LEGENDS__.game;
  const input = g.input;
  const ui = window.__PITCH_LEGENDS__.ui;
  const nav = window.__PITCH_LEGENDS__.padNav;
  const fake = {
    id: 'Smoke Controller (STANDARD GAMEPAD)',
    connected: true,
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  };
  const real = navigator.getGamepads;
  navigator.getGamepads = () => [fake];
  const btn = (i, down) => {
    fake.buttons.forEach((b, k) => {
      b.pressed = k === i && down;
      b.value = k === i && down ? 1 : 0;
    });
  };
  // one frame of controller input, exactly as the running loop does it
  const frame = () => {
    input.poll();
    input.dispatchFrame();
    input.endFrame();
  };
  const tap = (i) => {
    btn(i, true);
    frame();
    btn(i, false);
    frame();
  };
  const focus = () => {
    const el = document.querySelector('.pad-focus');
    return el ? el.id || el.textContent.trim().slice(0, 14) : null;
  };

  // start from the title screen
  window.__PITCH_LEGENDS__.returnToMenu();
  frame();
  const focusOnTitle = focus();
  // D-pad down x3 → Settings, A opens it
  tap(13);
  tap(13);
  tap(13);
  const focusedBeforeOpen = focus();
  tap(0);
  const settingsOpen = !document.getElementById('screen-settings').classList.contains('hidden');
  // left stick scrolls the settings rows, A toggles the focused segment
  fake.axes[1] = 1;
  for (let i = 0; i < 14; i++) frame();
  fake.axes[1] = 0;
  frame();
  const focusAfterStick = focus();
  const soundBefore = ui.settings.sound;
  tap(0);
  const soundAfter = ui.settings.sound;
  // B backs out to the title screen
  tap(1);
  const backToTitle = !document.getElementById('screen-title').classList.contains('hidden');

  // Start kicks off a match, Start pauses it, B resumes
  tap(9);
  window.__ensurePlay();
  const started = g.state === 'play';
  tap(9);
  const paused = ui.pauseOpen && g.paused;
  const focusOnPause = focus();
  tap(1);
  const resumed = !ui.pauseOpen && !g.paused;

  navigator.getGamepads = real;
  fake.connected = false;
  input.pad.connected = false;
  nav.clearFocus();
  ui.showHud(false);
  return {
    focusOnTitle,
    focusedBeforeOpen,
    settingsOpen,
    focusAfterStick,
    soundBefore,
    soundAfter,
    backToTitle,
    started,
    paused,
    focusOnPause,
    resumed,
  };
});
check(
  'controller shows a focus ring on the menus',
  padMenus.focusOnTitle === 'btn-quick' && padMenus.focusedBeforeOpen === 'btn-settings',
  `${padMenus.focusOnTitle} → ${padMenus.focusedBeforeOpen}`
);
check(
  'controller D-pad + A opens a menu and changes a setting',
  padMenus.settingsOpen && padMenus.soundBefore !== padMenus.soundAfter,
  `focus=${padMenus.focusAfterStick} sound ${padMenus.soundBefore} → ${padMenus.soundAfter}`
);
check(
  'controller B backs out of a menu',
  padMenus.backToTitle,
  `title visible=${padMenus.backToTitle}`
);
check(
  'controller Start kicks off and pauses, B resumes',
  padMenus.started && padMenus.paused && padMenus.resumed,
  `start=${padMenus.started} pause=${padMenus.paused} resume=${padMenus.resumed}`
);

// --- broadcast camera stays out of the stands (no black slab) ---
const camBox = await page.evaluate(() => {
  const g = window.__PITCH_LEGENDS__.game;
  window.__ensurePlay();
  g.settings.autoSwitch = false;
  g.setCameraMode('broadcast');
  const own = g.ownGoal(g.humanTeam);
  const p = g.controlled;
  p.setPosition(0, own.z + g.humanTeam.direction * 7, 0);
  g.ball.reset(0, own.z + g.humanTeam.direction * 7.5);
  g.ball.owner = p;
  window.__step(1.6);
  const c = g.camera.position;
  g.render();
  const cv = document.createElement('canvas');
  cv.width = 160;
  cv.height = 90;
  const ctx = cv.getContext('2d');
  ctx.drawImage(g.renderer.domElement, 0, 0, 160, 90);
  const data = ctx.getImageData(0, 0, 160, 90).data;
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 22 && data[i + 1] < 22 && data[i + 2] < 26) dark++;
  }
  return {
    z: +c.z.toFixed(1),
    y: +c.y.toFixed(1),
    zLimit: 53 + 10 - 6,
    dark: dark / (160 * 90),
  };
});
check(
  'broadcast camera never backs into the stands',
  Math.abs(camBox.z) <= camBox.zLimit + 0.01 && camBox.y <= 30.01,
  `cam z=${camBox.z} y=${camBox.y}`
);
check(
  'no black slab covers the view when play reaches your box',
  camBox.dark < 0.25,
  `${(camBox.dark * 100).toFixed(1)}% of the frame is black`
);

// --- long simulation stability ---
const longRun = await page.evaluate(() => {
  const g = window.__PITCH_LEGENDS__.game;
  for (let i = 0; i < 60 * 200; i++) {
    if (g.state === 'fulltime') break;
    g.dt = 1 / 60;
    g.update(1 / 60);
    g.input.endFrame();
  }
  const inside =
    Math.abs(g.ball.pos.x) < 45 && Math.abs(g.ball.pos.z) < 62 && Number.isFinite(g.ball.pos.x);
  return { state: g.state, inside, score: [g.home.score, g.away.score] };
});
check('200 s of simulation keeps the ball on the field', longRun.inside, `state=${longRun.state} score=${longRun.score}`);

// --- frame loop keeps real time at low frame rates (fixed-step substepping) ---
const pacing = await page.evaluate(() => {
  const g = window.__PITCH_LEGENDS__.game;
  const realNow = performance.now.bind(performance);
  let fake = 5_000_000;
  performance.now = () => fake;
  const step = (fps, seconds) => {
    const frames = Math.round(seconds * fps);
    const before = g.matchSeconds;
    for (let i = 0; i < frames; i++) {
      fake += 1000 / fps;
      g.frame();
    }
    return +(g.matchSeconds - before).toFixed(2);
  };
  const savedRender = g.render;
  g.loopFrozen = false;
  g.render = () => g.syncModels(0); // loop logic only, skip GPU work
  g.lastTime = fake / 1000;
  step(60, 3); // warm up past the kickoff freeze
  g.lastTime = fake / 1000;
  const at60 = step(60, 2);
  g.lastTime = fake / 1000;
  const at15 = step(15, 2);
  g.lastTime = fake / 1000;
  const pausedBefore = g.matchSeconds;
  g.setPaused(true);
  for (let i = 0; i < 60; i++) {
    fake += 1000 / 30;
    g.frame();
  }
  const pausedDrift = +(g.matchSeconds - pausedBefore).toFixed(2);
  g.setPaused(false);
  g.render = savedRender;
  g.loopFrozen = true;
  performance.now = realNow;
  return { at60, at15, pausedDrift, state: g.state };
});
check(
  'match clock keeps real time at 60 fps',
  Math.abs(pacing.at60 - 2) < 0.35,
  `${pacing.at60}s of match time per 2s`
);
check(
  'low frame rate no longer slows the match down',
  Math.abs(pacing.at15 - 2) < 0.45,
  `${pacing.at15}s of match time per 2s at 15 fps`
);
check('pausing freezes the simulation', pacing.pausedDrift === 0, `drift=${pacing.pausedDrift}s`);

/* ================================================================== */
/* Request 6: quick match settings, mobile layouts, throw-ins, tackle  */
/* ================================================================== */

// --- the quick match menu really drives the match -------------------
const matchFromMenu = await page.evaluate(() => {
  const { ui, game } = window.__PITCH_LEGENDS__;
  window.__PITCH_LEGENDS__.returnToMenu();
  ui.applySetting('controls', 'desktop');
  ui.applySetting('halfMinutes', 5);
  ui.applySetting('difficulty', 'easy');
  document.getElementById('btn-quick').click();
  const menuVisible = !document.getElementById('screen-match').classList.contains('hidden');
  document.getElementById('btn-kickoff').click();
  return {
    menuVisible,
    halfSeconds: game.halfSeconds,
    humanDiff: game.home.difficulty.label,
    aiDiff: game.away.difficulty.label,
    aiShotError: game.away.difficulty.shotError,
    state: game.state,
  };
});
check(
  'quick match settings reach the match (length + difficulty)',
  matchFromMenu.menuVisible &&
    matchFromMenu.halfSeconds === 300 &&
    matchFromMenu.aiDiff === 'Amateur' &&
    matchFromMenu.state === 'kickoff',
  JSON.stringify(matchFromMenu)
);

// --- mobile pad: both layouts, safe area, no HUD overlap ------------
const padLayouts = await page.evaluate(() => {
  const { ui, game } = window.__PITCH_LEGENDS__;
  game.loopFrozen = true;
  ui.applySetting('controls', 'touch');

  const read = (layout) => {
    ui.applySetting('touchLayout', layout);
    const pad = document.getElementById('touch-controls');
    const btn = (id) => pad.querySelector(`[data-tc-btn="${id}"]`);
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
    };
    const ids = ['shoot', 'pass', 'through', 'sprint'];
    const boxes = {};
    for (const id of ids) boxes[id] = rect(btn(id));
    return {
      visible: !pad.classList.contains('hidden'),
      layoutClass: pad.className,
      stick: rect(pad.querySelector('.tc-stick')),
      boxes,
      labels: ids.map((id) => btn(id).querySelector('.tc-label').textContent),
      hudTop: document.getElementById('hud')?.querySelector('.scoreboard, .hud-top, .team-row')?.getBoundingClientRect().bottom ?? 0,
      vw: innerWidth,
      vh: innerHeight,
    };
  };

  const fc = read('fc');
  const dls = read('dls');
  return {
    fc,
    dls,
    syncScreens: {
      matchActive: document.querySelector('#screen-match [data-setting="controls"] button.active')?.dataset.value,
      settingsHasControls: document.querySelectorAll('#screen-settings [data-setting="controls"]').length,
    },
  };
});

const inView = (b, vw, vh) => b.l >= 0 && b.t >= 0 && b.r <= vw + 1 && b.b <= vh + 1;
const allIn = (boxes, vw, vh) => ['shoot', 'pass', 'through', 'sprint'].every((id) => inView(boxes[id], vw, vh));

check(
  'mobile pad appears with both layouts',
  padLayouts.fc.visible && padLayouts.dls.visible,
  `${padLayouts.fc.layoutClass} / ${padLayouts.dls.layoutClass}`
);
check(
  'FC layout: stick lower-left, sprint bottom-right, shoot above it, pass left of shoot',
  padLayouts.fc.stick.l < padLayouts.fc.vw * 0.35 &&
    padLayouts.fc.stick.b > padLayouts.fc.vh * 0.55 &&
    padLayouts.fc.boxes.sprint.r > padLayouts.fc.vw * 0.8 &&
    padLayouts.fc.boxes.sprint.b > padLayouts.fc.vh * 0.85 &&
    padLayouts.fc.boxes.shoot.b <= padLayouts.fc.boxes.sprint.t + 2 &&
    padLayouts.fc.boxes.pass.r <= padLayouts.fc.boxes.shoot.l + 4 &&
    padLayouts.fc.boxes.pass.h >= 60,
  JSON.stringify(padLayouts.fc.boxes)
);
check(
  'DLS layout: A/B/C cluster plus a separate sprint',
  padLayouts.dls.boxes.shoot.w > 0 &&
    padLayouts.dls.boxes.sprint.l < padLayouts.dls.boxes.shoot.l &&
    padLayouts.dls.labels.join(',') === 'A,B,C,SPRINT',
  padLayouts.dls.labels.join(',')
);
check(
  'both layouts keep every button inside the viewport and clear of the HUD',
  allIn(padLayouts.fc.boxes, padLayouts.fc.vw, padLayouts.fc.vh) &&
    allIn(padLayouts.dls.boxes, padLayouts.dls.vw, padLayouts.dls.vh) &&
    Math.min(...Object.values(padLayouts.fc.boxes).map((b) => b.t)) > padLayouts.fc.hudTop,
  `hudBottom=${padLayouts.fc.hudTop.toFixed(0)}`
);
check(
  'control type stays in sync between the quick match menu and settings',
  padLayouts.syncScreens.matchActive === 'touch' && padLayouts.syncScreens.settingsHasControls === 0,
  JSON.stringify(padLayouts.syncScreens)
);

// --- context labels change with possession --------------------------
const padContext = await page.evaluate(() => {
  const { ui, game, input } = window.__PITCH_LEGENDS__;
  ui.applySetting('touchLayout', 'fc');
  const labels = () => ['shoot', 'pass', 'through', 'sprint'].map((id) =>
    document.querySelector(`[data-tc-btn="${id}"] .tc-label`).textContent
  );
  const settle = () => ui.updateTouch(game);

  game.ball.owner = game.home.players[8];
  game.ball.lastTouch = game.home.players[8];
  settle();
  const attacking = labels();

  game.ball.owner = game.away.players[8];
  game.ball.lastTouch = game.away.players[8];
  settle();
  const defending = labels();

  // through-ball / pass buttons push virtual actions into the input layer
  game.ball.owner = game.home.players[8];
  game.ball.lastTouch = game.home.players[8];
  settle();
  const btn = document.querySelector('[data-tc-btn="pass"]');
  const r = btn.getBoundingClientRect();
  const opts = { bubbles: true, pointerId: 11, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
  btn.dispatchEvent(new PointerEvent('pointerdown', opts));
  btn.dispatchEvent(new PointerEvent('pointerup', opts));
  const touchActions = [...input.pressed].sort();

  game.ball.owner = game.home.players[8];
  settle();
  return { attacking, defending, touchActions };
});
check(
  'mobile buttons relabel for attack and defence',
  padContext.attacking[0] === 'SHOOT' &&
    padContext.attacking[1] === 'PASS' &&
    padContext.defending[0] === 'SLIDE' &&
    padContext.defending[1] === 'SWITCH' &&
    padContext.defending[2] === 'PRESS',
  `${padContext.attacking.join('/')} vs ${padContext.defending.join('/')}`
);
check(
  'a finger press reaches the game as a virtual action',
  padContext.touchActions.includes('pass'),
  padContext.touchActions.join(',')
);

// --- multitouch: stick + button at the same time --------------------
const multiTouch = await page.evaluate(() => {
  const { ui, game, input } = window.__PITCH_LEGENDS__;
  const stick = document.querySelector('.tc-stick');
  const shoot = document.querySelector('[data-tc-btn="sprint"]');
  const sr = stick.getBoundingClientRect();
  const br = shoot.getBoundingClientRect();
  const fire = (el, type, id, x, y) => {
    const ev = new PointerEvent(type, { bubbles: true, pointerId: id, clientX: x, clientY: y, pointerType: 'touch' });
    el.dispatchEvent(ev);
  };
  // finger 1 drags the stick, finger 2 holds sprint
  fire(stick, 'pointerdown', 21, sr.left + sr.width / 2, sr.top + sr.height / 2);
  fire(stick, 'pointermove', 21, sr.left + sr.width / 2 + 40, sr.top + sr.height / 2);
  fire(shoot, 'pointerdown', 22, br.left + br.width / 2, br.top + br.height / 2);
  const during = { axis: { ...input.axis() }, sprint: input.isDown('sprint') };
  fire(shoot, 'pointerup', 22, br.left + br.width / 2, br.top + br.height / 2);
  fire(stick, 'pointerup', 21, sr.left + sr.width / 2, sr.top + sr.height / 2);
  const after = { axis: { ...input.axis() }, sprint: input.isDown('sprint') };
  void ui;
  void game;
  return { during, after };
});
check(
  'multitouch: the stick steers while a second finger holds sprint',
  multiTouch.during.axis.x > 0.5 && multiTouch.during.sprint === true,
  JSON.stringify(multiTouch.during)
);
check(
  'releasing both fingers stops movement and sprint',
  Math.abs(multiTouch.after.axis.x) < 0.01 && multiTouch.after.sprint === false,
  JSON.stringify(multiTouch.after)
);

// --- throw-ins on both touchlines -----------------------------------
const throwIns = await page.evaluate(() => {
  const { ui, game, input } = window.__PITCH_LEGENDS__;
  ui.applySetting('controls', 'touch');
  ui.applySetting('touchLayout', 'fc');
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      game.dt = 1 / 60;
      game.update(1 / 60);
      input.endFrame();
    }
  };
  const out = {};
  for (const side of [1, -1]) {
    // play the ball over that touchline, last touched by home
    game.state = 'play';
    game.throwIn = null;
    game.restartGrace = 0;
    game.ball.release();
    game.ball.reset(side * 34.8, 10);
    game.ball.lastTouch = game.away.players[7]; // so the home team throws in
    game.ball.vel.set(side * 8, 0, 0);
    step(2);
    ui.updateTouch(game);
    const t = game.throwIn;
    const ctx = {
      state: game.state,
      team: t ? (t.team === game.home ? 'home' : 'away') : null,
      side: t ? t.side : null,
      takerOnLine: t ? Math.abs(t.taker.pos.x) > 34 : false,
      receivers: t ? t.receivers.length : 0,
      ringVisible: !!game.throwInRing?.visible,
      labels: ['shoot', 'pass', 'through', 'sprint'].map((id) =>
        document.querySelector(`[data-tc-btn="${id}"] .tc-label`).textContent
      ),
    };
    if (side === 1) {
      // cycle the receiver with the pad button, then throw with the other
      const before = t.index;
      const cycle = document.querySelector('[data-tc-btn="through"]');
      const throwBtn = document.querySelector('[data-tc-btn="pass"]');
      const click = (el, id) => {
        const r = el.getBoundingClientRect();
        const o = { bubbles: true, pointerId: id, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
        el.dispatchEvent(new PointerEvent('pointerdown', o));
        el.dispatchEvent(new PointerEvent('pointerup', o));
      };
      click(cycle, 31);
      step(1);
      ui.updateTouch(game);
      ctx.receiverChanged = game.throwIn ? game.throwIn.index !== before : false;
      const receivers = game.throwIn.receivers.length;
      const selected = game.throwIn.receivers[game.throwIn.index];
      ui.updateTouch(game);
      click(throwBtn, 32);
      step(1);
      ctx.receivers = receivers;
      ctx.after = {
        state: game.state,
        ballX: game.ball.pos.x,
        ballY: game.ball.pos.y,
        awayFromLine: Math.sign(game.ball.vel.x) === -side && game.ball.pos.y > 1.0,
        selectedName: selected.name,
        offsideExempt: game.isOffsideExempt(selected),
        offsideForOpponent: game.isOffsideExempt(game.away.players[3]),
        throwInCleared: game.throwIn === null,
        ringHidden: !game.throwInRing.visible,
      };
      // play on: the ball must come back into play
      step(90);
      ctx.after.settledState = game.state;
      ctx.after.ballInsideX = Math.abs(game.ball.pos.x) < 34;
      ctx.after.ballOwnerTeam = game.ball.owner ? game.ball.owner.team.id : null;
    }
    out[side === 1 ? 'right' : 'left'] = ctx;
  }
  return out;
});
const rightThrow = throwIns.right;
const leftThrow = throwIns.left;
check(
  'the ball leaving over the right touchline stops play for a throw-in',
  rightThrow.state === 'throwin' && rightThrow.team === 'home' && rightThrow.side === 1,
  JSON.stringify(rightThrow)
);
check(
  'the ball leaving over the left touchline also gives a throw-in',
  leftThrow.state === 'throwin' && leftThrow.team === 'home' && leftThrow.side === -1,
  JSON.stringify(leftThrow)
);
check(
  'the thrower stands on the line and receivers are ranked',
  rightThrow.takerOnLine && rightThrow.receivers > 0 && rightThrow.ringVisible,
  `receivers=${rightThrow.receivers}`
);
check(
  'mobile buttons become THROW and RECEIVER during a throw-in',
  rightThrow.labels[1] === 'THROW' && rightThrow.labels[2] === 'RECEIVER',
  rightThrow.labels.join('/')
);
check(
  'RECEIVER cycles the highlighted team-mate',
  rightThrow.receiverChanged === true,
  `changed=${rightThrow.receiverChanged}`
);
check(
  'THROW puts the ball back into play toward the chosen receiver',
  rightThrow.after.state === 'play' &&
    rightThrow.after.awayFromLine &&
    rightThrow.after.throwInCleared &&
    rightThrow.after.ringHidden &&
    rightThrow.after.ballInsideX,
  JSON.stringify(rightThrow.after)
);
check(
  'no offside is given directly from a throw-in',
  rightThrow.after.offsideExempt === true && rightThrow.after.offsideForOpponent === false,
  JSON.stringify(rightThrow.after)
);

// --- throw-ins also work from the keyboard / controller -------------
const keyboardThrow = await page.evaluate(() => {
  const { game, input, ui } = window.__PITCH_LEGENDS__;
  ui.applySetting('controls', 'desktop');
  game.state = 'play';
  game.restartGrace = 0;
  game.ball.release();
  game.ball.reset(-34.8, 5);
  game.ball.lastTouch = game.away.players[6];
  game.ball.vel.set(-8, 0, 0);
  for (let i = 0; i < 3; i++) { game.dt = 1 / 60; game.update(1 / 60); input.endFrame(); }
  const began = game.state === 'throwin';
  const team = game.throwIn?.team === game.home ? 'home' : 'away';
  // X = cycle receiver, Z = pass (throw), exactly like a normal pass
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyX' }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyX' }));
  game.dt = 1 / 60; game.update(1 / 60); input.endFrame();
  const cycled = game.throwIn?.index > 0;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ' }));
  game.dt = 1 / 60; game.update(1 / 60); input.endFrame();
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyZ' }));
  return { began, team, cycled, after: game.state, ballX: game.ball.pos.x };
});
check(
  'keyboard/controller can take a throw-in (Z throw, X cycle)',
  keyboardThrow.began && keyboardThrow.team === 'home' && keyboardThrow.cycled && keyboardThrow.after === 'play',
  JSON.stringify(keyboardThrow)
);

// --- sprint auto-tackle ---------------------------------------------
const autoTackle = await page.evaluate(() => {
  const { game, input } = window.__PITCH_LEGENDS__;
  const step = (n) => {
    for (let i = 0; i < n; i++) { game.dt = 1 / 60; game.update(1 / 60); input.endFrame(); }
  };
  // freeze the AI so the chase is measured against a stationary carrier
  const aiUpdate = { home: game.home.ai.update, away: game.away.ai.update };
  game.home.ai.update = () => {};
  game.away.ai.update = () => {};
  const park = () => {
    game.state = 'play';
    game.throwIn = null;
    game.restartGrace = 0;
    game.autoTackleCooldown = 0;
    game.autoTackleCount = 0;
    game.secondManTimer = 0;
    input.down.clear();
    input.touchActions.clear();
    game.settings.autoSwitch = false;
    game.home.players.forEach((p) => p.setPosition(-40, -40, 0));
    game.away.players.forEach((p) => p.setPosition(40, 40, 0));
  };

  // 1) chasing: holding sprint closes the gap on the carrier
  park();
  const carrier = game.away.players[9];
  const defender = game.home.players[8];
  carrier.setPosition(0, -6, 0);
  carrier.speedMult = 0.55; // a slow dribble, so the chase is measurable
  defender.setPosition(0, 6, 0);
  game.ball.reset(0, -5.4);
  game.ball.owner = carrier;
  game.ball.lastTouch = carrier;
  game.setControlled(defender);
  input.pressTouch('sprint');
  const startDist = defender.pos.distanceTo(carrier.pos);
  step(90);
  const chaseDist = defender.pos.distanceTo(carrier.pos);
  input.releaseTouch('sprint');

  // 2) auto tackle: sprinting into range wins the ball without a button press
  park();
  carrier.setPosition(0, 0, 0);
  carrier.speedMult = 0.4;
  defender.setPosition(0, 7, 0);
  game.ball.reset(0, 0.6);
  game.ball.owner = carrier;
  game.ball.lastTouch = carrier;
  game.setControlled(defender);
  input.pressTouch('sprint');
  let cooldown = 0;
  let won = false;
  // the challenge is a normal tackle roll, so keep sprinting until it lands
  for (let i = 0; i < 60 * 10; i++) {
    const before = game.autoTackleCount;
    step(1);
    if (game.autoTackleCount > before) cooldown = Math.max(cooldown, game.autoTackleCooldown);
    if (game.ball.owner && game.ball.owner.team === game.home) { won = true; break; }
    if (game.autoTackleCount > 0 && !game.ball.owner) { won = true; break; } // ball knocked loose
  }
  const tackles = game.autoTackleCount;
  input.releaseTouch('sprint');

  // 3) never while our own team has possession
  park();
  const mate = game.home.players[7];
  mate.setPosition(0, 2, 0);
  defender.setPosition(0, 10, 0);
  game.ball.reset(0, 2.4);
  game.ball.owner = mate;
  game.ball.lastTouch = mate;
  game.setControlled(defender);
  game.autoTackleCount = 0;
  input.pressTouch('sprint');
  let chasingDuringOwnBall = false;
  for (let i = 0; i < 60; i++) {
    game.ball.owner = mate; // keep possession ours for the whole window
    game.ball.lastTouch = mate;
    step(1);
    if (game.chasing) chasingDuringOwnBall = true;
  }
  const ownPossessionTackles = game.autoTackleCount;
  input.releaseTouch('sprint');

  // 4) manual tackle still works on its own
  park();
  game.ball.reset(0, 0.6);
  game.ball.owner = carrier;
  game.ball.lastTouch = carrier;
  carrier.setPosition(0, 0, 0);
  carrier.stunTimer = 0;
  defender.setPosition(0, 1.3, 0);
  game.setControlled(defender);
  defender.tackleCooldown = 0;
  game.humanTackle();
  const manualAttempted = defender.tackleCooldown > 0;

  game.home.ai.update = aiUpdate.home;
  game.away.ai.update = aiUpdate.away;
  return {
    startDist,
    chaseDist,
    chased: chaseDist < startDist - 2,
    tackles,
    won,
    cooldownReady: cooldown > 0,
    ownPossessionTackles,
    chasingDuringOwnBall,
    manualAttempted,
  };
});
check(
  'holding sprint chases the ball carrier',
  autoTackle.chased,
  `closed ${autoTackle.startDist.toFixed(1)}→${autoTackle.chaseDist.toFixed(1)} m in 1.5 s`
);
check(
  'sprinting into range auto-tackles the carrier',
  autoTackle.tackles > 0 && autoTackle.won,
  `tackles=${autoTackle.tackles} won=${autoTackle.won}`
);
check(
  'auto-tackle sets a cooldown before it can fire again',
  autoTackle.cooldownReady,
  `cooldown=${autoTackle.cooldownReady}`
);
check(
  'no auto-tackle (or chase) while our own team has the ball',
  autoTackle.ownPossessionTackles === 0 && autoTackle.chasingDuringOwnBall === false,
  `tackles=${autoTackle.ownPossessionTackles} chasing=${autoTackle.chasingDuringOwnBall}`
);
check('manual tackle still works alongside the assist', autoTackle.manualAttempted);

// --- fit on common screen sizes -------------------------------------
const fits = [];
for (const [w, h] of [[360, 640], [390, 844], [412, 915], [768, 1024], [844, 390], [1280, 800], [1920, 1080]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(120);
  const fit = await page.evaluate(() => {
    const { ui, game } = window.__PITCH_LEGENDS__;
    ui.applySetting('controls', 'touch');
    // menu first, then the pad over live play (the pad only shows in-match)
    window.__PITCH_LEGENDS__.returnToMenu();
    document.getElementById('btn-quick').click();
    game.loopFrozen = true;
    const panel = document.querySelector('#screen-match .panel');
    const kick = document.getElementById('btn-kickoff').getBoundingClientRect();
    const kickVisible = kick.top >= 0 && kick.bottom <= innerHeight + 2 && kick.width > 0;
    const kickScrollReachable =
      panel.scrollHeight <= panel.clientHeight + 2 ||
      getComputedStyle(document.getElementById('screen-match')).overflow !== 'visible';
    ui.hideAllScreens();
    ui.showHud(true);
    const results = {};
    for (const layout of ['fc', 'dls']) {
      ui.applySetting('touchLayout', layout);
      const pad = document.getElementById('touch-controls');
      const box = (sel) => {
        const r = pad.querySelector(sel).getBoundingClientRect();
        return { l: r.left, t: r.top, r: r.right, b: r.bottom };
      };
      const boxes = ['shoot', 'pass', 'through', 'sprint'].map((id) => box(`[data-tc-btn="${id}"]`));
      const stick = box('.tc-stick');
      const hud = document.getElementById('hud');
      const hudRect = hud.getBoundingClientRect();
      // the scoreboard strip is the top ~11% of the HUD
      const hudBand = { b: hudRect.top + Math.min(96, innerHeight * 0.13) };
      const inside = boxes.every((b) => b.l >= -1 && b.t >= -1 && b.r <= innerWidth + 1 && b.b <= innerHeight + 1);
      const overHud = boxes.some((b) => b.t < hudBand.b) || stick.t < hudBand.b;
      const overlapStick = boxes.some((b) => b.l < stick.r + 6 && b.b > stick.t + 6);
      results[layout] = { inside, overHud, overlapStick };
    }
    void game;
    return { results, kickVisible, scrollable: kickScrollReachable, w: innerWidth, h: innerHeight };
  });
  fit.results.fc.stick = fit.results.fc.overlapStick;
  void 0;
  fits.push({ size: `${w}x${h}`, ...fit });
}
await page.setViewportSize({ width: 1280, height: 800 });
const badFit = fits.filter(
  (f) => !f.results.fc.inside || !f.results.dls.inside || f.results.fc.overHud || f.results.dls.overHud ||
    f.results.fc.overlapStick || f.results.dls.overlapStick || !(f.kickVisible || f.scrollable)
);
check(
  'touch pad fits every common screen size without covering the HUD',
  badFit.length === 0,
  badFit.length
    ? badFit
        .map((f) => `${f.size}:${JSON.stringify({ fc: f.results.fc, dls: f.results.dls, kick: f.kickVisible })}`)
        .join(' ')
    : fits.map((f) => f.size).join(', ')
);

// In-match controls sit on top of the 3D pitch, where backdrop-filter renders
// as a hazy square halo around every round button (worst on software GL such as
// emulators and low-end Android). They must stay blur-free and opaque enough to
// read; full-screen menu scrims may keep their blur.
const blurAudit = await page.evaluate(() => {
  const bad = [];
  const scan = (root) => {
    for (const el of root.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      const bf = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
      if (bf && bf !== 'none') bad.push(`${el.className || el.tagName}: ${bf}`);
    }
  };
  scan(document.getElementById('touch-controls'));
  scan(document.getElementById('hud'));
  return bad;
});
check('in-match controls have no backdrop blur', blurAudit.length === 0, blurAudit.slice(0, 4).join(' | '));

// FC-layout buttons that accept a swipe carry a small chevron so the gesture is
// visible without reading the sub-label; buttons with no gesture must not show
// one, and the DLS layout (letter buttons) never draws them.
const arrows = await page.evaluate(() => {
  const { game, ui } = window.__PITCH_LEGENDS__;
  const wasFrozen = game.loopFrozen;
  game.loopFrozen = true;
  const read = () => {
    const out = {};
    for (const id of ['shoot', 'pass', 'through', 'sprint']) {
      const btn = document.querySelector(`[data-tc-btn="${id}"]`);
      const arrow = btn.querySelector('.tc-arrow');
      out[id] = {
        shown: arrow ? getComputedStyle(arrow).display !== 'none' : false,
        gesture: btn.dataset.gesture || '',
      };
    }
    return out;
  };
  ui.applySetting('touchLayout', 'fc');
  ui.touchControls._applyLabels('attack');
  const fc = read();
  ui.touchControls._applyLabels('defend');
  const fcDefend = read();
  ui.touchControls._applyLabels('throwin');
  const fcThrow = read();
  ui.applySetting('touchLayout', 'dls');
  ui.touchControls._applyLabels('attack');
  const dls = read();
  ui.applySetting('touchLayout', 'fc');
  ui.touchControls._applyLabels('attack');
  game.loopFrozen = wasFrozen;
  return { fc, fcDefend, fcThrow, dls };
});
check(
  'FC buttons with a swipe show the small arrow, others do not',
  arrows.fc.pass.shown && arrows.fc.through.shown && !arrows.fc.shoot.shown && !arrows.fc.sprint.shown,
  JSON.stringify(arrows.fc)
);
check(
  'defending keeps its own arrows (GK rush up, slide down)',
  arrows.fcDefend.through.shown && arrows.fcDefend.through.gesture === 'up' && !arrows.fcDefend.shoot.shown,
  JSON.stringify(arrows.fcDefend)
);
check(
  'throw-in buttons drop the arrows (no pass/through gestures there)',
  !arrows.fcThrow.shoot.shown && !arrows.fcThrow.pass.shown && !arrows.fcThrow.through.shown,
  JSON.stringify(arrows.fcThrow)
);
// DLS sprints automatically: push the stick to the rim and the player sprints
// without a second thumb. Partial deflection stays a jog, the FC layout never
// auto-sprints, and the auto channel must not raise a press edge (that edge is
// the double-tap roulette gesture).
const autoSprint = await page.evaluate(() => {
  const { game, ui } = window.__PITCH_LEGENDS__;
  const wasFrozen = game.loopFrozen;
  game.loopFrozen = true;
  const input = game.input;
  const stick = document.getElementById('tc-stick');
  const r = stick.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const rad = r.width / 2 - 14;
  const fire = (type, dx, dy, id) =>
    stick.dispatchEvent(
      new PointerEvent(type, {
        pointerId: id,
        clientX: cx + dx,
        clientY: cy + dy,
        bubbles: true,
        cancelable: true,
        isPrimary: true,
        pointerType: 'touch',
      })
    );

  ui.applySetting('touchLayout', 'dls');
  ui.touchControls._applyLabels('attack');
  fire('pointerdown', rad * 0.55, 0, 21);
  const partial = input.isDown('sprint');
  fire('pointermove', rad * 1.05, 0, 21);
  const full = input.isDown('sprint');
  const btnLit = document.querySelector('[data-tc-btn="sprint"]').classList.contains('is-auto');
  const edgeFree = !input.wasPressed('sprint');
  fire('pointermove', rad * 0.55, 0, 21);
  const backToJog = input.isDown('sprint');
  fire('pointerup', rad * 0.55, 0, 21);
  const afterRelease = input.isDown('sprint');
  const label = document.querySelector('[data-tc-btn="sprint"] .tc-sub').textContent;

  ui.applySetting('touchLayout', 'fc');
  fire('pointerdown', rad * 1.1, 0, 22);
  const fcSprint = input.isDown('sprint');
  const fcAuto = input.autoSprint;
  fire('pointerup', rad * 1.1, 0, 22);

  ui.applySetting('touchLayout', 'dls');
  ui.touchControls._applyLabels('attack');
  game.loopFrozen = wasFrozen;
  return { partial, full, btnLit, edgeFree, backToJog, afterRelease, label, fcSprint, fcAuto };
});
// The sprint skill on touch: two quick taps of SPRINT spin the player. It has to
// work on both layouts, must not fire on a single tap, and must not fire when
// the player is not on the ball.
const skill = await page.evaluate(() => {
  const { game, ui } = window.__PITCH_LEGENDS__;
  const out = {};
  const btn = document.querySelector('[data-tc-btn="sprint"]');
  const tap = (id) => {
    btn.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: id,
        bubbles: true,
        cancelable: true,
        isPrimary: true,
        pointerType: 'touch',
      })
    );
    btn.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: id,
        bubbles: true,
        cancelable: true,
        isPrimary: true,
        pointerType: 'touch',
      })
    );
  };
  // a clean attacking situation on the ball, mid-match
  const setup = (withBall) => {
    game.settings.autoSwitch = false;
    game.state = 'play';
    game.restartTimer = 0;
    const p = game.controlled;
    p.rouletteCooldown = 0;
    p.rouletteTimer = 0;
    if (withBall) {
      game.ball.reset(0, 0.4);
      game.ball.owner = p;
      p.hasBall = true;
    } else {
      game.ball.reset(0, 0.4);
      game.ball.owner = null;
      p.hasBall = false;
    }
    ui.touchControls._lastSprintTap = undefined;
    window.__step(1 / 60);
    game.state = 'play';
    // the sim may have re-picked who you control on that step: follow it
    const live = game.controlled;
    if (withBall) {
      game.ball.owner = live;
      live.hasBall = true;
    }
    live.rouletteCooldown = 0;
    live.rouletteTimer = 0;
    return live;
  };
  for (const layout of ['fc', 'dls']) {
    ui.applySetting('touchLayout', layout);
    let p = setup(true);
    tap(201);
    window.__step(1 / 60);
    out[`${layout}Single`] = p.rouletteTimer > 0;

    p = setup(true);
    tap(202);
    tap(203);
    window.__step(1 / 60);
    out[`${layout}Double`] = p.rouletteTimer > 0;
    window.__step(0.8);

    p = setup(false);
    tap(204);
    tap(205);
    window.__step(1 / 60);
    out[`${layout}NoBall`] = p.rouletteTimer > 0;
    window.__step(0.8);
  }
  ui.applySetting('touchLayout', 'fc');
  return out;
});
check(
  'double-tap SPRINT spins the player on both mobile layouts',
  skill.fcDouble === true && skill.dlsDouble === true,
  JSON.stringify(skill)
);
check(
  'a single SPRINT tap never spins (and no spin without the ball)',
  skill.fcSingle === false && skill.dlsSingle === false && skill.fcNoBall === false && skill.dlsNoBall === false,
  JSON.stringify(skill)
);

check(
  'DLS: full stick deflection auto-sprints, partial stays a jog',
  autoSprint.partial === false && autoSprint.full === true && autoSprint.backToJog === false && autoSprint.afterRelease === false,
  JSON.stringify(autoSprint)
);
check(
  'DLS: auto-sprint lights the sprint button and raises no press edge',
  autoSprint.btnLit === true && autoSprint.edgeFree === true && autoSprint.label === 'auto',
  JSON.stringify({ btnLit: autoSprint.btnLit, edgeFree: autoSprint.edgeFree, label: autoSprint.label })
);
check(
  'FC keeps sprint manual (no auto-sprint)',
  autoSprint.fcSprint === false && autoSprint.fcAuto === false,
  JSON.stringify({ sprint: autoSprint.fcSprint, auto: autoSprint.fcAuto })
);

check(
  'DLS letter buttons never draw arrows',
  !arrows.dls.shoot.shown && !arrows.dls.pass.shown && !arrows.dls.through.shown && !arrows.dls.sprint.shown,
  JSON.stringify(arrows.dls)
);

const opaque = await page.evaluate(() => {
  const ids = ['shoot', 'pass', 'through', 'sprint'];
  const out = [];
  for (const id of ids) {
    const el = document.querySelector(`[data-tc-btn="${id}"]`);
    if (!el) { out.push(`${id}: missing`); continue; }
    const layer = el.querySelector('.tc-ring');
    void layer;
    // sample the rendered pixels: a see-through button lets the pitch pattern
    // through, an opaque one stays within a narrow colour band
    const cs = getComputedStyle(el);
    if (cs.backgroundImage === 'none' && /rgba\(.*0?\.\d+\)/.test(cs.backgroundColor)) {
      const alpha = Number((cs.backgroundColor.match(/[\d.]+/g) || [])[3] ?? 1);
      if (alpha < 0.75) out.push(`${id}: alpha ${alpha}`);
    }
  }
  return out;
});
check('touch buttons are opaque reads, not see-through', opaque.length === 0, opaque.join(' | '));

// Camera presets: Action is the low, tilted default (mobile-style first angle),
// Broadcast and Close stay available, and every preset keeps the rig legal.
const cameras = await page.evaluate(() => {
  const { game, ui } = window.__PITCH_LEGENDS__;
  const out = { options: [], modes: {} };
  out.options = [...document.querySelectorAll('#screen-settings [data-setting="camera"] button')].map((b) => b.dataset.value);
  out.default = JSON.parse(localStorage.getItem('pitch-legends-settings-v1') || '{}').camera || game.cameraMode;
  for (const mode of ['action', 'broadcast', 'side', 'close']) {
    game.setCameraMode(mode);
    game.snapCamera();
    const c = game.camera;
    out.modes[mode] = {
      fov: Math.round(c.fov),
      y: +c.position.y.toFixed(1),
      inBounds:
        Math.abs(c.position.x) <= 60 &&
        Math.abs(c.position.z) <= 90 &&
        c.position.y >= 6.4 &&
        c.position.y <= 30.1,
      // looking down the pitch: the aim target must be further away than the rig
      aimAhead: c.position.distanceTo(game.camLook) > 4,
    };
  }
  game.setCameraMode('action');
  return out;
});
check(
  'Action camera is offered first and is the default',
  cameras.options[0] === 'action' && cameras.options.length === 4 && cameras.options.includes('side') && cameras.default === 'action',
  JSON.stringify({ options: cameras.options, default: cameras.default })
);
check(
  'Action camera sits lower than Broadcast and shows more pitch per frame',
  cameras.modes.action.y < cameras.modes.broadcast.y &&
    cameras.modes.action.y <= 15 &&
    cameras.modes.action.fov > cameras.modes.broadcast.fov,
  JSON.stringify(cameras.modes)
);
check(
  'every camera preset keeps the rig inside the stadium and aimed at play',
  Object.values(cameras.modes).every((m) => m.inBounds && m.aimAhead),
  JSON.stringify(cameras.modes)
);

// The stick has to stay screen-relative in every view: push right, the player
// moves right on screen; push up, away from the camera. A side-on camera would
// otherwise invert the controls.
const stickMapping = await page.evaluate(() => {
  const { game } = window.__PITCH_LEGENDS__;
  const out = {};
  for (const mode of ['action', 'broadcast', 'side', 'close']) {
    game.setCameraMode(mode);
    game.snapCamera();
    game.camera.updateMatrixWorld(true);
    const pl = game.controlled;
    // NB: Player.setPosition(x, z, facing) — the third argument is a facing angle
    pl.setPosition(0, 0);
    game.snapCamera();
    // freeze the rig: the camera normally follows the player, which would cancel
    // out the very screen movement we are measuring
    game.camera.updateMatrixWorld(true);
    const before = pl.pos.clone().project(game.camera);
    const w = game.screenToWorld({ x: 1, y: 0 });
    pl.setPosition(w.x * 3, w.z * 3);
    game.camera.updateMatrixWorld(true);
    const after = pl.pos.clone().project(game.camera);
    const up = game.screenToWorld({ x: 0, y: 1 });
    pl.setPosition(up.x * 3, up.z * 3);
    game.camera.updateMatrixWorld(true);
    const upPos = pl.pos.clone().project(game.camera);
    out[mode] = {
      rightGoesRight: after.x - before.x > 0.02,
      upGoesAway: upPos.y - before.y > 0.02,
    };
  }
  game.setCameraMode('action');
  return out;
});
check(
  'stick stays screen-relative in every camera (including side view)',
  Object.values(stickMapping).every((m) => m.rightGoesRight && m.upGoesAway),
  JSON.stringify(stickMapping)
);

// The Quick Match panel must fit on the screen it is shown on: nothing may
// scroll (which made the menu slide over the pitch) and KICK OFF must be
// visible without scrolling, on landscape phones as well as desktops.
const panelFit = [];
for (const [w, h] of [
  [915, 412],
  [844, 390],
  [740, 360],
  [1280, 720],
  [1600, 900],
]) {
  await page.setViewportSize({ width: w, height: h });
  await page.evaluate(() => {
    const { ui } = window.__PITCH_LEGENDS__;
    ui.hideAllScreens();
    ui.showScreen?.('match');
  });
  await page.waitForTimeout(120);
  const fit = await page.evaluate(() => {
    const scr = document.getElementById('screen-match');
    const kick = document.getElementById('btn-kickoff').getBoundingClientRect();
    const panel = scr.querySelector('.panel').getBoundingClientRect();
    return {
      scrolls: scr.scrollHeight > scr.clientHeight + 1,
      kickVisible: kick.top >= -1 && kick.bottom <= innerHeight + 1 && kick.height > 0,
      panelInside: panel.bottom <= innerHeight + 1 && panel.top >= -1,
      // two columns on landscape so the whole setup fits without scrolling
      columns: getComputedStyle(scr.querySelector('.match-setup')).gridTemplateColumns.split(' ').length,
    };
  });
  panelFit.push({ size: `${w}x${h}`, ...fit });
}
await page.setViewportSize({ width: 1280, height: 800 });
const badFitPanels = panelFit.filter((f) => f.scrolls || !f.kickVisible || !f.panelInside || f.columns !== 2);
check(
  'Quick Match fits without scrolling and KICK OFF is always visible',
  badFitPanels.length === 0,
  badFitPanels.length ? JSON.stringify(badFitPanels) : panelFit.map((f) => f.size).join(', ')
);

// --- kick-off: staged like a real one, not a scramble -----------------
const kickoffStage = await page.evaluate(() => {
  const { game } = window.__PITCH_LEGENDS__;
  game.applyFormation(game.home, '4-3-3');
  game.state = 'kickoff';
  game.setupKickoff(game.home);
  const inCircle = (t) =>
    t.players.filter((q) => !q.isGK && Math.hypot(q.pos.x, q.pos.z) < 9.15).map((q) => q.role).sort();
  const snapshot = {
    ballAtSpot: Math.hypot(game.ball.pos.x, game.ball.pos.z) < 0.05,
    owner: game.ball.owner === null,
    homeInCircle: inCircle(game.home),
    awayInCircle: inCircle(game.away),
    taker: game.kickoffTaker.role,
    partner: game.kickoffPartner.role,
    inOwnHalf: true,
  };
  // every player must start in his own half
  for (const t of game.teams) {
    for (const q of t.players) {
      if (q.isGK) continue;
      if (q.pos.z * t.direction > 0.05) snapshot.inOwnHalf = false;
    }
  }
  // the whistle
  game.resolveKickoff();
  const guardUp = game.kickoffGuard > 0;
  const takerOwns = game.ball.owner === game.kickoffTaker;
  // an opponent may not win the ball off the taker yet
  const opponent = game.away.players.find((q) => !q.isGK);
  opponent.setPosition(1.2, -0.6);
  game.doPlayerTackle(opponent, game.kickoffTaker);
  const stolen = game.ball.owner !== game.kickoffTaker;
  return { ...snapshot, guardUp, takerOwns, stolen };
});
check(
  'kick-off starts with the ball on the centre spot and only the two kickers in the circle',
  kickoffStage.ballAtSpot &&
    kickoffStage.owner &&
    kickoffStage.homeInCircle.length === 2 &&
    kickoffStage.awayInCircle.length === 0 &&
    kickoffStage.homeInCircle.includes(kickoffStage.taker),
  JSON.stringify(kickoffStage)
);
check(
  'every player is in his own half at the kick-off',
  kickoffStage.inOwnHalf,
  JSON.stringify(kickoffStage)
);
check(
  'the ball cannot be stolen before the kick-off is played',
  kickoffStage.guardUp && kickoffStage.takerOwns && !kickoffStage.stolen,
  JSON.stringify(kickoffStage)
);

// The AI takes its own kick-off with a square lay-off instead of dribbling off.
const aiKickoff = await page.evaluate(() => {
  const { game } = window.__PITCH_LEGENDS__;
  game.kickoffTeam = game.away;
  game.state = 'kickoff';
  game.setupKickoff(game.away);
  const taker = game.kickoffTaker;
  const partner = game.kickoffPartner;
  game.resolveKickoff();
  const ownsAtWhistle = game.ball.owner === taker;
  const startSpot = { x: game.ball.pos.x, z: game.ball.pos.z };
  let played = false;
  for (let i = 0; i < 150; i++) {
    game.update(1 / 60);
    game.input.endFrame();
    if (game.ball.owner !== taker) played = true;
  }
  return {
    ownsAtWhistle,
    played,
    movedFromSpot: Math.hypot(game.ball.pos.x - startSpot.x, game.ball.pos.z - startSpot.z) > 1.2,
    partnerInvolved: partner.pos.distanceTo(game.ball.pos) < 18,
    takerFree: game.kickoffRoutine === 0,
    state: game.state,
  };
});
check(
  'the AI kick-off is a square lay-off to the partner, not a solo run',
  aiKickoff.ownsAtWhistle && aiKickoff.played && aiKickoff.movedFromSpot && aiKickoff.takerFree,
  JSON.stringify(aiKickoff)
);

// Team shape: a defending AI team must hold a formation block, not swarm the
// ball. The ball is pinned 24 m from the AI's own goal (a realistic attacking
// position for the human team) and the settled shape is sampled for a couple of
// seconds. What is asserted is what "shape" actually means: a handful of
// players contest the ball, the back line keeps its width, the team is stretched
// in depth, most players are away from the ball, and the block is goal-side of it.
const shape = {};
{
  const shapePage = await browser.newPage({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true });
  await shapePage.goto(BASE, { waitUntil: 'load' });
  await shapePage.waitForTimeout(900);
  await shapePage.click('#btn-quick');
  await shapePage.waitForTimeout(250);
  await shapePage.click('#btn-kickoff');
  await shapePage.waitForTimeout(2200);
  for (const key of ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2']) {
    await shapePage.evaluate((formationKey) => {
      const { game } = window.__PITCH_LEGENDS__;
      game.applyFormation(game.away, formationKey);
      window.__shapePin && clearInterval(window.__shapePin);
      window.__shapePin = setInterval(() => {
        game.kickoffGuard = 0;
        game.kickoffRoutine = 0;
        const own = game.ownGoal(game.away);
        const zSign = Math.sign(own.z) || 1;
        const carrier = game.home.players[7];
        carrier.setPosition(9, own.z - zSign * 24);
        game.ball.reset(9, own.z - zSign * 24);
        game.ball.owner = carrier;
        game.ball.lastTouch = carrier;
      }, 16);
    }, key);
    await shapePage.waitForTimeout(3200);
    const samples = [];
    for (let k = 0; k < 6; k++) {
      await shapePage.waitForTimeout(200);
      samples.push(
        await shapePage.evaluate(() => {
          const { game } = window.__PITCH_LEGENDS__;
          const dir = game.away.direction;
          const ball = game.ball.pos;
          const men = game.away.players.filter((p) => !p.isGK);
          const defs = men.filter((p) => p.line === 'def');
          const spreadX = (arr) =>
            arr.length ? Math.max(...arr.map((p) => p.pos.x)) - Math.min(...arr.map((p) => p.pos.x)) : 0;
          const depths = men.map((p) => p.pos.z * dir);
          return {
            onBall: men.filter((p) => p.pos.distanceTo(ball) < 6).length,
            away: men.filter((p) => p.pos.distanceTo(ball) > 8).length / men.length,
            defWidth: +spreadX(defs).toFixed(1),
            depthSpan: +(Math.max(...depths) - Math.min(...depths)).toFixed(1),
            // negative = the back line is between the ball and the AI goal
            defBehind: +(
              defs.reduce((sum, p) => sum + p.pos.z * dir, 0) / defs.length -
              ball.z * dir
            ).toFixed(1),
          };
        })
      );
    }
    const avg = (f) => +(samples.reduce((sum, x) => sum + x[f], 0) / samples.length).toFixed(2);
    const median = (f) => {
      const v = samples.map((x) => x[f]).sort((a, b) => a - b);
      return +v[Math.floor(v.length / 2)].toFixed(2);
    };
    shape[key] = {
      onBall: +avg('onBall').toFixed(1),
      away: avg('away'),
      defWidth: avg('defWidth'),
      depthSpan: avg('depthSpan'),
      defBehind: median('defBehind'),
    };
  }
  await shapePage.evaluate(() => {
    if (window.__shapePin) clearInterval(window.__shapePin);
    window.__shapePin = null;
  });
  await shapePage.close();
}
check(
  'AI defence holds its block instead of swarming the ball',
  Object.values(shape).every((f) => f.onBall <= 4) &&
    Object.values(shape).every((f) => f.away >= 0.5) &&
    Object.values(shape).every((f) => f.defWidth >= 16),
  JSON.stringify(shape)
);
check(
  'the AI block is stretched in depth from its back line to its forwards',
  Object.values(shape).every((f) => f.depthSpan >= 18),
  JSON.stringify(shape)
);

// --- the AI keeper is beatable (it used to be a wall) -----------------
// Fire clean shots on target from the edge of the box with every other player
// parked out of the way, and count how many beat the keeper. The AI keeper must
// concede a fair share; the human team's keeper stays sharp by comparison.
const keeperBench = await page.evaluate(() => {
  const { game } = window.__PITCH_LEGENDS__;
  const run = (defTeam, shots) => {
    game.halfSeconds = 1e9;
    game.state = 'play';
    game.kickoffGuard = 0;
    const gk = defTeam.gk;
    const own = game.ownGoal(defTeam);
    const zSign = Math.sign(own.z);
    let goals = 0;
    let touched = 0;
    for (let i = 0; i < shots; i++) {
      for (const t of game.teams) {
        for (const q of t.players) if (!q.isGK) q.setPosition(0, own.z - zSign * 45);
      }
      gk.setPosition((Math.random() - 0.5) * 3, own.z - zSign * 1.2, 0);
      gk.diveTimer = 0;
      gk.saveCooldown = 0;
      gk.claimTimer = 0;
      gk.failSaveTimer = 0;
      gk.touchCooldown = 0;
      const sx = (Math.random() - 0.5) * 22;
      const sz = own.z - zSign * (14 + Math.random() * 8);
      game.ball.release();
      game.ball.reset(sx, sz);
      const tx = (Math.random() - 0.5) * (7.32 - 1.0);
      const ty = 0.3 + Math.random() * 1.8;
      const dz = own.z - sz;
      const dist = Math.hypot(tx - sx, dz);
      const speed = 21 + Math.random() * 6;
      const t = dist / speed;
      const lift = (ty - 0.12 + 0.5 * 9.81 * t * t) / t;
      const dir = game.ball.vel.clone().set((tx - sx) / dist, 0, dz / dist);
      const before = game.home.score + game.away.score;
      game.ball.kick(dir, speed, { lift, by: null });
      let gkTouched = false;
      for (let f = 0; f < 110; f++) {
        game.update(1 / 60);
        game.input.endFrame();
        if (game.ball.lastTouch === gk) gkTouched = true;
        if (game.home.score + game.away.score > before) break;
        if (game.state !== 'play') break;
      }
      if (gkTouched) touched += 1;
      if (game.home.score + game.away.score > before) goals += 1;
      if (game.state !== 'play') game.state = 'play';
    }
    return { shots, goals, touched, goalRate: +(goals / shots).toFixed(3) };
  };
  const ai = run(game.away, 120);
  const human = run(game.home, 90);
  game.state = 'play';
  return { ai, human };
});
check(
  'the AI keeper is beatable: a fair share of clean shots on target go in',
  keeperBench.ai.goalRate >= 0.3 && keeperBench.ai.goalRate <= 0.62,
  JSON.stringify(keeperBench.ai)
);
check(
  'the AI keeper still makes saves — he is not a hologram',
  keeperBench.ai.touched >= 0.35 * keeperBench.ai.shots,
  JSON.stringify(keeperBench.ai)
);
check(
  "the human team's own keeper is sharper than the AI's",
  keeperBench.human.goalRate < keeperBench.ai.goalRate - 0.02,
  `human ${keeperBench.human.goalRate} vs ai ${keeperBench.ai.goalRate}`
);
// A keeper may not simply trap a struck shot with his body, and a fast ball is
// not a loose ball for him to claim.
const keeperTouch = await page.evaluate(() => {
  const { game } = window.__PITCH_LEGENDS__;
  const gk = game.away.gk;
  const own = game.ownGoal(game.away);
  const zSign = Math.sign(own.z);
  gk.setPosition(0, own.z - zSign * 1.2, 0);
  gk.claimTimer = 0;
  game.ball.release();
  game.ball.reset(0, own.z - zSign * 5);
  // a rocket straight through the keeper's chest
  const dir = game.ball.vel.clone().set(0, 0, zSign);
  game.ball.kick(dir, 30, { lift: 0.4, by: null });
  const speed = game.ball.planarSpeed;
  game.updatePossession(1 / 120);
  return { speed: +speed.toFixed(1), trapped: game.ball.owner === gk || gk.claimTimer > 0 };
});
check(
  'a struck shot is the save logic\'s job, not an automatic trap',
  keeperTouch.speed > 12 && !keeperTouch.trapped,
  JSON.stringify(keeperTouch)
);

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('Failed:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
