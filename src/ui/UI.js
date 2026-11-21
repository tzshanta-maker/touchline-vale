import { DIFFICULTY, FORMATIONS, FORMATION_KEYS, TEAMS } from '../config.js';
import { squadForDisplay } from '../entities/teams.js';
import { Sound } from './Sound.js';

const $ = (id) => document.getElementById(id);

/**
 * All DOM-facing code: menus, HUD, overlays, touch buttons, sound hookup.
 * The Game only talks to the UI through the methods on this class.
 */
export class UI {
  constructor({ settings, callbacks }) {
    this.settings = settings;
    this.cb = callbacks;
    this.sound = new Sound(settings.sound);
    this.pauseOpen = false;
    this.hudVisible = false;
    this._cache = {};
    this._toastTimer = null;
    this._goalTimer = null;

    this._refs = {
      hud: $('hud'),
      loading: $('loading'),
      screens: {
        title: $('screen-title'),
        howto: $('screen-howto'),
        settings: $('screen-settings'),
        match: $('screen-match'),
        squad: $('screen-squad'),
      },
      pause: $('pause-overlay'),
      halftime: $('halftime-overlay'),
      fulltime: $('fulltime-overlay'),
      scoreHome: $('score-home'),
      scoreAway: $('score-away'),
      homeName: $('home-name'),
      awayName: $('away-name'),
      homeSwatch: $('home-swatch'),
      awaySwatch: $('away-swatch'),
      clock: $('match-clock'),
      halfLabel: $('half-label'),
      pcNumber: $('pc-number'),
      pcName: $('pc-name'),
      pcRole: $('pc-role'),
      stamina: $('stamina-fill'),
      powerWrap: $('power-wrap'),
      power: $('power-fill'),
      possHome: $('poss-home'),
      possAway: $('poss-away'),
      possHomeLabel: $('poss-home-label'),
      possAwayLabel: $('poss-away-label'),
      toast: $('toast'),
      goalBanner: $('goal-banner'),
      goalSub: $('goal-sub'),
      pauseScore: $('pause-score'),
      halftimeScore: $('halftime-score'),
      ftResult: $('ft-result'),
      ftVerdict: $('ft-verdict'),
      ftShotsH: $('ft-shots-h'),
      ftShotsA: $('ft-shots-a'),
      ftSavesH: $('ft-saves-h'),
      ftSavesA: $('ft-saves-a'),
      ftPossH: $('ft-poss-h'),
      ftPossA: $('ft-poss-a'),
      metaDiff: $('meta-diff'),
      metaHalf: $('meta-half'),
      metaFormation: $('meta-formation'),
      formationGrid: $('setup-formation-grid'),
      formationDesc: $('formation-desc'),
      squadTitle: $('squad-title'),
      squadFormation: $('squad-formation'),
      squadSummary: $('squad-summary'),
      squadStarters: $('squad-starters'),
      squadBench: $('squad-bench'),
      pcPac: $('pc-pac'),
      pcSho: $('pc-sho'),
      pcPas: $('pc-pas'),
      pcOvr: $('pc-ovr'),
    };

    this._bind();
    this._detectTouch(); // capability first: the settings sync needs it
    this._syncSettingsUI();
  }

  /* --------------------------------------------------------------- */
  _bind() {
    $('btn-quick')?.addEventListener('click', () => {
      this.sound.init();
      this.sound.resume();
      this.sound.uiClick();
      this.openQuickMatch();
    });
    $('btn-kickoff')?.addEventListener('click', () => {
      this.sound.init();
      this.sound.resume();
      this.sound.uiClick();
      this.cb.onQuickMatch?.();
    });
    $('btn-howto')?.addEventListener('click', () => {
      this.sound.uiClick();
      this.showScreen('howto');
    });
    $('btn-settings')?.addEventListener('click', () => {
      this.sound.uiClick();
      this.showScreen('settings');
    });
    $('btn-squad')?.addEventListener('click', () => {
      this.sound.uiClick();
      this.renderSquad(this.settings.formation);
      this.showScreen('squad');
    });

    this._buildFormationGrid();
    document.querySelectorAll('[data-back]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sound.uiClick();
        const to = btn.dataset.backto || 'title';
        this.showScreen(to);
      });
    });

    $('btn-pause')?.addEventListener('click', () => this.togglePause());
    $('btn-resume')?.addEventListener('click', () => this.resume());
    $('btn-restart')?.addEventListener('click', () => {
      this.closePause();
      this.cb.onRestart?.();
    });
    $('btn-mainmenu')?.addEventListener('click', () => {
      this.closePause();
      this.cb.onMainMenu?.();
    });
    $('btn-rematch')?.addEventListener('click', () => {
      this.hideFullTime();
      this.cb.onRestart?.();
    });
    $('btn-ft-menu')?.addEventListener('click', () => {
      this.hideFullTime();
      this.cb.onMainMenu?.();
    });

    // Segmented settings groups (both in the settings screen and the pause menu)
    document.querySelectorAll('[data-setting]').forEach((group) => {
      group.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-value]');
        if (!btn) return;
        const key = group.dataset.setting;
        const raw = btn.dataset.value;
        let value = raw;
        if (raw === 'on') value = true;
        else if (raw === 'off') value = false;
        else if (!Number.isNaN(Number(raw)) && raw !== '') value = Number(raw);
        this.applySetting(key, value);
        this.sound.uiClick();
      });
    });

    // Audio needs a gesture before it can start
    const unlock = () => {
      this.sound.init();
      this.sound.resume();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  _buildFormationGrid() {
    const grids = document.querySelectorAll('.formation-grid[data-setting="formation"]');
    for (const grid of grids) {
      grid.innerHTML = '';
      for (const key of FORMATION_KEYS) {
        const f = FORMATIONS[key];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.value = key;
        btn.className = 'formation-btn';
        btn.innerHTML = `<span class="fb-name">${f.label}</span><span class="fb-style">${f.style}</span>`;
        btn.title = f.desc;
        grid.appendChild(btn);
      }
    }
  }

  /** Renders the full squad with attributes for the chosen formation. */
  renderSquad(formationKey) {
    const squad = squadForDisplay('home', formationKey);
    const r = this._refs;
    if (!r.squadStarters) return;
    if (r.squadTitle) r.squadTitle.textContent = TEAMS.home.name;
    if (r.squadFormation) r.squadFormation.textContent = `${squad.formationLabel} formation`;
    if (r.squadSummary) r.squadSummary.textContent = `${squad.starters.length} starters + ${squad.bench.length} substitutes`;

    const row = (p, isBench) => {
      const stat = (k, label) => `<span class="sq-stat"><b>${p.stats[k]}</b>${label}</span>`;
      return `
        <div class="squad-row${isBench ? ' is-bench' : ''}">
          <span class="sq-num">${p.number}</span>
          <span class="sq-name">${p.name}</span>
          <span class="sq-role">${p.role}</span>
          <span class="sq-stats">
            ${stat('pace', 'PAC')}${stat('shooting', 'SHO')}${stat('passing', 'PAS')}
            ${stat('dribbling', 'DRI')}${stat('defending', 'DEF')}${stat('physical', 'PHY')}
          </span>
          <span class="sq-ovr">${p.overall}</span>
        </div>`;
    };
    r.squadStarters.innerHTML = squad.starters.map((p) => row(p, false)).join('');
    r.squadBench.innerHTML = squad.bench.map((p) => row(p, true)).join('');
  }

  showSubstitution(team, incoming, outgoing) {
    if (!team || !incoming) return;
    this.toast(
      `SUB · ${team.def.short} — ${incoming.name} ON FOR ${outgoing ? outgoing.name : ''}`,
      team.isHuman ? 'default' : 'warn'
    );
  }

  /** Capability sniff — only used as the default for the control-type setting. */
  _detectTouch() {
    this.isTouch =
      window.matchMedia?.('(pointer: coarse)').matches ||
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0;
    // body.controls-touch is driven by the *chosen* control type instead
    // (see _applyControlType), so HUD layout always matches the real inputs.
  }

  applySetting(key, value) {
    this.settings[key] = value;
    this.cb.onSettingChange?.(key, value);
    this._syncSettingsUI();
  }

  _syncSettingsUI() {
    const s = this.settings;
    const valuesByKey = {
      difficulty: s.difficulty,
      halfMinutes: String(s.halfMinutes),
      camera: s.camera,
      autoSwitch: s.autoSwitch === false ? 'off' : 'on',
      sound: s.sound ? 'on' : 'off',
      formation: s.formation || '4-3-3',
      controls: this.controlType(),
      touchLayout: this.settings.touchLayout === 'dls' ? 'dls' : 'fc',
    };
    document.querySelectorAll('[data-setting]').forEach((group) => {
      const key = group.dataset.setting;
      const current = String(valuesByKey[key]);
      group.querySelectorAll('button[data-value]').forEach((b) => {
        b.classList.toggle('active', b.dataset.value === current);
      });
    });
    if (this._refs.metaDiff) {
      this._refs.metaDiff.textContent = (DIFFICULTY[s.difficulty] || DIFFICULTY.normal).label;
    }
    if (this._refs.metaHalf) {
      this._refs.metaHalf.textContent = `${s.halfMinutes} min`;
    }
    const currentFormation = FORMATIONS[s.formation] || FORMATIONS['4-3-3'];
    if (this._refs.metaFormation) this._refs.metaFormation.textContent = currentFormation.label;
    for (const desc of document.querySelectorAll('#setup-formation-desc')) {
      desc.textContent = `${currentFormation.style} · ${currentFormation.desc}`;
    }

    // --- control type ---------------------------------------------------
    const mobile = this.controlType() === 'touch';
    const touchCapable = this.isTouch;
    const layout = this.settings.touchLayout === 'dls' ? 'dls' : 'fc';
    for (const el of document.querySelectorAll('#setup-mobile-layout')) {
      el.classList.toggle('is-muted', !mobile);
    }
    // a device without a touchscreen (Android TV, desktop) explains itself
    const touchBtn = document.querySelector('[data-setting="controls"] button[data-value="touch"]');
    if (touchBtn) {
      touchBtn.disabled = !touchCapable;
      touchBtn.title = touchCapable ? 'On-screen mobile controls' : 'No touchscreen detected on this device';
      touchBtn.classList.toggle('is-unavailable', !touchCapable);
    }
    const touchCopy = {
      fc: 'FC Mobile style — button cluster with a power ring on Shoot',
      dls: 'DLS-like — A shoot/hard pass, B pass, C through ball; sprint is automatic at full stick',
    };
    const setupDesc = document.getElementById('setup-touch-desc');
    if (setupDesc) setupDesc.textContent = touchCopy[layout];

    const summary = document.getElementById('setup-summary');
    if (summary) {
      const diff = (DIFFICULTY[s.difficulty] || DIFFICULTY.normal).label;
      const mode = mobile ? (layout === 'dls' ? 'DLS-like mobile' : 'FC Mobile-style') : 'Computer / Controller';
      summary.textContent = `${diff} · ${s.halfMinutes} min halves · ${currentFormation.label} · ${mode}`;
    }
    const preview = document.getElementById('setup-preview');
    if (preview) {
      preview.classList.toggle('mode-desktop', !mobile);
      preview.classList.toggle('mode-mobile', mobile);
      preview.classList.toggle('mode-dls', layout === 'dls');
      const label = document.getElementById('sp-label');
      if (label) label.textContent = mobile ? (layout === 'dls' ? 'DLS-like pad' : 'FC Mobile-style pad') : 'keyboard + controller';
    }

    this.sound.setEnabled(!!s.sound);
    this._applyControlType();
  }

  /* --------------------------------------------------------------- */
  /* Control type (computer/controller vs mobile)                     */
  /* --------------------------------------------------------------- */
  /** Resolves the stored preference to 'desktop' or 'touch'. */
  controlType() {
    const pref = this.settings.controls;
    if (pref === 'touch' || pref === 'desktop') return pref;
    return this.isTouch ? 'touch' : 'desktop';
  }

  _applyControlType() {
    const mobile = this.controlType() === 'touch';
    document.body.classList.toggle('controls-touch', mobile);
    document.body.classList.toggle('controls-desktop', !mobile);
    this.touchControls?.setLayout(this.settings.touchLayout === 'dls' ? 'dls' : 'fc');
    if (this.hudVisible) this.touchControls?.setVisible(mobile);
  }

  /** Called when the touch pad module is ready (main.js wires it up). */
  attachTouchControls(controls) {
    this.touchControls = controls;
    this._applyControlType();
    return controls;
  }

  openQuickMatch() {
    this._syncSettingsUI();
    this.showScreen('match');
  }

  /** Per-frame refresh of the touch pad (context labels, charge ring). */
  updateTouch(game) {
    this.touchControls?.update(game);
  }

  /* --------------------------------------------------------------- */
  /* Screens                                                         */
  /* --------------------------------------------------------------- */
  showScreen(name) {
    for (const [key, el] of Object.entries(this._refs.screens)) {
      if (el) el.classList.toggle('hidden', key !== name);
    }
  }

  hideAllScreens() {
    for (const el of Object.values(this._refs.screens)) {
      if (el) el.classList.add('hidden');
    }
  }

  hideLoading() {
    this._refs.loading?.classList.add('hidden');
  }

  showHud(on) {
    this.hudVisible = on;
    this._refs.hud?.classList.toggle('hidden', !on);
    this.touchControls?.setVisible(on && this.controlType() === 'touch');
  }

  setTeams(home = TEAMS.home, away = TEAMS.away) {
    if (this._refs.homeName) this._refs.homeName.textContent = home.name.toUpperCase();
    if (this._refs.awayName) this._refs.awayName.textContent = away.name.toUpperCase();
    document.documentElement.style.setProperty('--home', `#${home.primary.toString(16).padStart(6, '0')}`);
    document.documentElement.style.setProperty('--away', `#${away.primary.toString(16).padStart(6, '0')}`);
    if (this._refs.homeSwatch) this._refs.homeSwatch.style.background = `#${home.primary.toString(16).padStart(6, '0')}`;
    if (this._refs.awaySwatch) this._refs.awaySwatch.style.background = `#${away.primary.toString(16).padStart(6, '0')}`;
  }

  setScore(home, away) {
    if (this._refs.scoreHome) this._refs.scoreHome.textContent = String(home.score ?? 0);
    if (this._refs.scoreAway) this._refs.scoreAway.textContent = String(away.score ?? 0);
    if (this._refs.pauseScore) this._refs.pauseScore.textContent = `${home.score ?? 0} – ${away.score ?? 0}`;
  }

  setHalf(half) {
    if (this._refs.halfLabel) this._refs.halfLabel.textContent = half === 2 ? '2ND HALF' : '1ST HALF';
  }

  updateHud(data) {
    const r = this._refs;
    if (this._cache.clock !== data.clock) {
      r.clock.textContent = data.clock;
      this._cache.clock = data.clock;
    }
    if (this._cache.half !== data.half) {
      this.setHalf(data.half);
      this._cache.half = data.half;
    }
    const p = data.controlled;
    if (p) {
      if (this._cache.num !== p.number) {
        r.pcNumber.textContent = String(p.number);
        this._cache.num = p.number;
      }
      if (this._cache.name !== p.name) {
        r.pcName.textContent = p.name;
        this._cache.name = p.name;
      }
      if (this._cache.role !== p.role) {
        r.pcRole.textContent = p.role;
        this._cache.role = p.role;
      }
      const st = Math.round(p.stamina);
      if (this._cache.stamina !== st) {
        r.stamina.style.width = `${st}%`;
        r.stamina.style.background =
          st < 25
            ? 'linear-gradient(90deg,#ff5a4d,#ff9d4d)'
            : st < 55
            ? 'linear-gradient(90deg,#ffd23f,#c9ff4a)'
            : 'linear-gradient(90deg,#c9ff4a,#7ef0a0)';
        this._cache.stamina = st;
      }
    }
    if (p && this._refs.pcPac) {
      if (this._cache.statPlayer !== p.id) {
        this._refs.pcPac.textContent = p.stats.pace;
        this._refs.pcSho.textContent = p.stats.shooting;
        this._refs.pcPas.textContent = p.stats.passing;
        this._refs.pcOvr.innerHTML = `${p.overall} <i>OVR</i>`;
        this._cache.statPlayer = p.id;
      }
    }
    if (data.possession) {
      const h = data.possession.home;
      const a = data.possession.away;
      if (this._cache.poss !== h) {
        r.possHome.style.width = `${h}%`;
        r.possAway.style.width = `${a}%`;
        r.possHomeLabel.textContent = `${h}%`;
        r.possAwayLabel.textContent = `${a}%`;
        this._cache.poss = h;
      }
    }
    this.setPower(data.power || 0);
  }

  setPower(v) {
    const r = this._refs;
    const pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
    if (this._cache.power !== pct) {
      r.power.style.width = `${pct}%`;
      this._cache.power = pct;
      r.powerWrap?.classList.toggle('charging', pct > 0);
    }
  }

  /* --------------------------------------------------------------- */
  showGoalBanner(team, scorer) {
    const r = this._refs;
    if (!r.goalBanner) return;
    const color = `#${team.def.primary.toString(16).padStart(6, '0')}`;
    r.goalBanner.querySelector('.goal-text').style.color = color;
    r.goalSub.textContent = `${team.def.name.toUpperCase()} — ${scorer ? scorer.name : 'TEAM GOAL'}`;
    r.goalBanner.classList.remove('hidden');
    clearTimeout(this._goalTimer);
    this._goalTimer = setTimeout(() => this.hideGoalBanner(), 3400);
    if (team.isHuman) this.sound.crowdExcitement(0.9);
    else this.sound.crowdExcitement(0.2);
  }

  hideGoalBanner() {
    this._refs.goalBanner?.classList.add('hidden');
  }

  showHalftime(score) {
    if (this._refs.halftimeScore) {
      this._refs.halftimeScore.textContent = `${score.home} – ${score.away}`;
    }
    this._refs.halftime?.classList.remove('hidden');
    this.sound.whistle(true);
  }

  hideHalftime() {
    this._refs.halftime?.classList.add('hidden');
  }

  showFullTime(home, away, stats) {
    const r = this._refs;
    r.ftResult.textContent = `${home.score} – ${away.score}`;
    const homeWin = home.score > away.score;
    const awayWin = away.score > home.score;
    r.ftVerdict.textContent = homeWin
      ? `${home.def.name} win`
      : awayWin
      ? `${away.def.name} win`
      : 'Honours even';
    r.ftVerdict.style.color = homeWin ? 'var(--lime)' : awayWin ? 'var(--away)' : 'var(--muted)';
    r.ftShotsH.textContent = stats.shots.home;
    r.ftShotsA.textContent = stats.shots.away;
    r.ftSavesH.textContent = stats.saves.home;
    r.ftSavesA.textContent = stats.saves.away;
    const total = home.possessionTime + away.possessionTime;
    const h = total > 0 ? Math.round((home.possessionTime / total) * 100) : 50;
    r.ftPossH.textContent = `${h}%`;
    r.ftPossA.textContent = `${100 - h}%`;
    r.fulltime.classList.remove('hidden');
    this.sound.whistle(true);
  }

  hideFullTime() {
    this._refs.fulltime?.classList.add('hidden');
  }

  /* --------------------------------------------------------------- */
  togglePause() {
    if (this.pauseOpen) this.resume();
    else this.openPause();
  }

  openPause() {
    if (this.pauseOpen) return;
    this.pauseOpen = true;
    this._refs.pause?.classList.remove('hidden');
    this.cb.onPause?.(true);
  }

  resume() {
    if (!this.pauseOpen) return;
    this.pauseOpen = false;
    this._refs.pause?.classList.add('hidden');
    this.cb.onPause?.(false);
  }

  closePause() {
    this.pauseOpen = false;
    this._refs.pause?.classList.add('hidden');
    this.cb.onPause?.(false);
  }

  resetForMatch() {
    this.hideGoalBanner();
    this.hideHalftime();
    this.hideFullTime();
    this.closePause();
    this._cache = {};
    this.setPower(0);
  }

  /* --------------------------------------------------------------- */
  toast(message, tone = 'default') {
    const el = this._refs.toast;
    if (!el) return;
    el.textContent = message;
    el.style.color = tone === 'warn' ? '#ff9d4d' : tone === 'away' ? '#ff8f99' : 'var(--lime)';
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 1200);
  }

  flashSave(gk, caught) {
    if (!gk || !gk.team.isHuman) {
      if (gk && gk.team !== undefined) this.toast(caught ? 'KEEPER CATCHES IT' : 'KEEPER PARRIES', 'warn');
      return;
    }
    this.toast(caught ? 'SAVE! KEEPER CATCHES IT' : 'SAVE! KEEPER PARRIES');
  }

  flashTackle(player, won) {
    if (!player || !player.team.isHuman) return;
    this.toast(won ? 'TACKLE WON' : 'TACKLE MISSED', won ? 'default' : 'warn');
  }

  flashTurnover() {
    /* possession changes are communicated by the play itself */
  }

  flashRestart(type, team) {
    if (!team || !team.isHuman) return;
    const labels = {
      throwIn: 'THROW-IN',
      corner: 'CORNER',
      goalKick: 'GOAL KICK',
    };
    if (labels[type]) this.toast(labels[type]);
  }

  flashShoot() {
    /* shot feedback handled by ball + power bar */
  }

  flashPass() {
    /* intentionally quiet */
  }

  flashSwitch(player) {
    if (player) this.toast(`${player.name} · ${player.role}`);
  }

  flashContact() {
    /* quiet */
  }

  /** First touch: a small, non-intrusive confirmation that the ball was controlled */
  flashReceive(player) {
    if (!player || !player.team?.isHuman) return;
    const el = document.getElementById('receive-pip');
    if (!el) return;
    el.classList.add('show');
    clearTimeout(this._receiveTimer);
    this._receiveTimer = setTimeout(() => el.classList.remove('show'), 420);
  }

  /** Skill move feedback (roulette) */
  flashSkill(label) {
    this.toast(label, 'default');
  }

  /** Sprint auto-tackle fired: tell the player it was automatic. */
  flashAutoTackle(player) {
    if (!player || !player.team?.isHuman) return;
    this.toast('AUTO TACKLE', 'default');
  }

  /** Lofted / crossed pass confirmation. */
  flashLoft(player) {
    if (!player || !player.team?.isHuman) return;
    this.toast('LOFTED BALL', 'default');
  }
}
