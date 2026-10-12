// Menu panels (team: ui): title, settings, pause, game over, victory.
// Factory contract: (game, ui, data) -> { update(game, dt), render(game, ctx, age), hits, onClose? }.
// Hit ids (ui.findTarget): title 'continue' 'new-game' 'settings' | settings 'set-row:<i>' 'dec:<key>'
// 'inc:<key>' 'slider:<key>' 'opt:<key>:<i>' 'settings-back' | pause 'resume' 'inventory' 'settings'
// 'quit' | gameover 'respawn' | victory 'title' | prompts 'confirm-yes' 'confirm-no'.
import { EV } from '../../core/events.js';
import { drawText, measureText } from '../font.js';
import { createHits, promptDevice } from '../widgets.js';
import {
  COL, panel, inset, ribbon, keycap, mouseGlyph, bar, dim, rrect, sparkle, mix, clamp,
  easeOutCubic, easeOutBack, elColor,
} from '../theme.js';
import {
  sfx, fmtTime, R, confirmPressed, createMenu, drawButton, createConfirm, getLogo, drawLogo, createMotes,
  createFireworks, glow, vignette, divider,
} from './menu-kit.js';

const ELS = ['fire', 'ice', 'lightning', 'arcane', 'earth'];
const RAMP_GOLD = ['#fffbe0', '#fff2b0', '#ffe27a', '#ffd25a', '#ffb83a', '#f0962a', '#c86a1a'];
const RAMP_VIOLET = ['#ffffff', '#ece4ff', '#c8b8ff', '#a890ff', '#8a6aff'];
const RAMP_RED = ['#ffd0c0', '#ff8a7a', '#ff4a4a', '#e0203a', '#a8102a', '#70081c'];

const safeRect = (game) => {
  const { width: W, height: H, safe: s } = game.display;
  return { W, H, L: s.left, T: s.top, Rr: W - s.right, B: H - s.bottom };
};

// ===================================================================== TITLE

export function titlePanel(game, ui, data = {}) {
  const hits = createHits();
  const confirm = createConfirm();
  const motes = createMotes({ n: 46, colors: [COL.gold, COL.edgeHi, '#b05aff', '#4fc8ff', COL.goldHi] });
  let age = 0, done = false, queued = false;
  const canContinue = !!data.canContinue;

  const start = (ev) => {
    if (done) return;
    done = true;
    // (audio plays 'title_start' itself on MENU_NEW_GAME / MENU_CONTINUE)
    game.bus.emit(ev, {});
  };
  const items = [];
  if (canContinue) items.push({ id: 'continue', label: 'Continue', silent: true, onSelect: () => start(EV.MENU_CONTINUE) });
  items.push({
    id: 'new-game', label: 'New Game', silent: true,
    onSelect: () => {
      if (canContinue) {
        sfx(game, 'ui_select');
        confirm.open(game, 'Overwrite your saved game?\nYour current progress will be lost.', () => start(EV.MENU_NEW_GAME));
      } else start(EV.MENU_NEW_GAME);
    },
  });
  items.push({ id: 'settings', label: 'Settings', onSelect: () => ui.open('settings', { from: 'title' }) });
  const menu = createMenu(items, { focus: 0 });

  return {
    hits,
    update(g, dt) {
      age += dt;
      const evs = hits.poll(g.input);
      if (done) return;
      if (confirm.active) { confirm.update(g, evs); return; }
      if (age < 0.1) { // tiny settle time; buffer an early confirm instead of dropping it
        if (confirmPressed(g.input)) queued = true;
        menu.handle(g, evs, { allowKeys: false });
        return;
      }
      if (queued) { queued = false; menu.activate(g, menu.focus); return; }
      menu.handle(g, evs);
    },
    render(g, ctx, a) {
      hits.begin();
      const { W, H, L, T, Rr, B } = safeRect(g);
      const t = g.realTime;
      const portrait = H > W;

      // ---- layout
      const s1 = clamp(Math.floor((Rr - L - 32) / 34), 3, H >= 400 ? 6 : 5);
      const s2 = Math.max(2, s1 - 2);
      const logoH = 5 * s1 + s1 + 3 + 5 * s2 + 10 + 5;
      const bh = 18, bgap = portrait ? 8 : 5;
      const btnH = items.length * bh + (items.length - 1) * bgap;
      const avail = B - T - 14;
      const spare = Math.max(0, avail - logoH - btnH);
      const gapLB = clamp(Math.round(spare * 0.3), 14, portrait ? 70 : 34);
      const top = T + Math.round(Math.max(4, (avail - logoH - btnH - gapLB) * (portrait ? 0.42 : 0.45)));
      const cx = R((L + Rr) / 2);

      // ---- ambience behind the logo
      const intro = easeOutCubic(a / 0.6);
      const logoCY = top + R(logoH * 0.4);
      glow(ctx, cx, logoCY, 34 * s1, 13 * s1, '#7a5aff', (0.22 + 0.06 * Math.sin(t * 1.6)) * intro);
      glow(ctx, cx, logoCY, 18 * s1, 6 * s1, '#ffd25a', (0.10 + 0.04 * Math.sin(t * 2.3)) * intro);
      motes.render(ctx, W, H, t);

      // ---- orbiting element motes (back half)
      const A = getLogo('ARCANIA', s1, RAMP_GOLD);
      const rx = R(A.w / 2 + 6 * s1), ry = R(5 * s1 + 4);
      const orbit = (front) => {
        for (let i = 0; i < ELS.length; i++) {
          const ang = t * 0.9 + (i * Math.PI * 2) / ELS.length;
          const isFront = Math.sin(ang) > 0;
          if (isFront !== front) continue;
          for (let k = 3; k >= 0; k--) {
            const aa = ang - k * 0.06;
            const x = cx + Math.cos(aa) * rx, y = logoCY + Math.sin(aa) * ry;
            ctx.globalAlpha = intro * (k === 0 ? 1 : 0.5 - k * 0.12) * (front ? 1 : 0.55);
            ctx.fillStyle = elColor(ELS[i], k === 0 ? 1 : 0);
            if (k === 0 && front) sparkle(ctx, x, y, 2, elColor(ELS[i], 1));
            else ctx.fillRect(R(x), R(y), k === 0 ? 2 : 1, k === 0 ? 2 : 1);
          }
        }
        ctx.globalAlpha = 1;
      };
      orbit(false);

      // ---- logo
      const shimmerT = (t % 4.2) / 0.9; // sweep 0.9 s every 4.2 s
      const ax = cx - R((A.w - A.pad * 2) / 2);
      drawLogo(ctx, A, ax, top, {
        wave: (i) => Math.sin(t * 2.2 + i * 0.7) * Math.max(1, s1 / 3) - (1 - easeOutBack(clamp((a - i * 0.04) / 0.45, 0, 1))) * 14,
        letterAlpha: (i) => clamp((a - i * 0.04) / 0.25, 0, 1),
        shimmer: shimmerT <= 1 ? shimmerT : -1,
      });
      const y2 = top + 5 * s1 + s1 + 3;
      const B2 = getLogo('ACADEMY', s2, RAMP_VIOLET, { rim: '#1a0e34' });
      const bw2 = B2.w - B2.pad * 2;
      const fadeB = clamp((a - 0.2) / 0.35, 0, 1);
      drawLogo(ctx, B2, cx - R(bw2 / 2), y2 + R((1 - fadeB) * 4), { alpha: fadeB, shimmer: shimmerT - 0.35 >= 0 && shimmerT - 0.35 <= 1 ? shimmerT - 0.35 : -1 });
      // flourishes either side of ACADEMY
      const fl = R(clamp((Rr - L - bw2) / 2 - 18, 6, 10 * s2) * fadeB);
      const fy = y2 + R(5 * s2 / 2);
      if (fl > 2) {
        ctx.fillStyle = COL.goldLo;
        ctx.fillRect(cx - R(bw2 / 2) - 6 - fl, fy, fl, 1);
        ctx.fillRect(cx + R(bw2 / 2) + 6, fy, fl, 1);
        ctx.fillStyle = COL.gold;
        ctx.fillRect(cx - R(bw2 / 2) - 5, fy - 1, 2, 3);
        ctx.fillRect(cx + R(bw2 / 2) + 3, fy - 1, 2, 3);
        sparkle(ctx, cx - R(bw2 / 2) - 7 - fl, fy, 1, COL.goldHi);
        sparkle(ctx, cx + R(bw2 / 2) + 6 + fl, fy, 1, COL.goldHi);
      }
      orbit(true);
      const subY = y2 + 5 * s2 + 10;
      drawText(ctx, 'A Spell-Crafting Adventure', cx, subY, { align: 'center', color: COL.edgeHi, alpha: clamp((a - 0.35) / 0.4, 0, 1) });

      // ---- buttons (hit rects are always at their final position)
      const bw = portrait ? Math.min(Rr - L - 60, 140) : 112;
      const by0 = top + logoH + gapLB;
      for (let i = 0; i < items.length; i++) {
        const x = cx - R(bw / 2), y = by0 + i * (bh + bgap);
        const k = easeOutCubic((a - 0.05 - i * 0.05) / 0.3);
        if (!confirm.active) menu.place(hits, i, x, y, bw, bh);
        menu.draw(ctx, g, i, x, y, bw, bh, { hits, oy: R((1 - k) * 10), alpha: k, accent: items[i].id === 'continue' ? '#4a8a5a' : COL.edge });
      }

      // ---- footer
      const fy2 = B - 10;
      drawText(ctx, `v${g.VERSION || '0.1.0'}`, L + 6, fy2, { color: COL.dimmer });
      const hint = promptDevice(g) === 'touch' ? 'Tap to choose' : 'Arrows/Enter · Mouse';
      drawText(ctx, hint, Rr - 6, fy2, { align: 'right', color: COL.dim });

      if (confirm.active) confirm.render(ctx, g, hits);
      if (done) { // brief flash as the game starts
        ctx.fillStyle = 'rgba(255,240,200,0.06)';
        ctx.fillRect(0, 0, W, H);
      }
    },
  };
}

// ===================================================================== SETTINGS

const ROWS = [
  { kind: 'slider', key: 'masterVolume', label: 'Master', def: 0.8 },
  { kind: 'slider', key: 'musicVolume', label: 'Music', def: 0.6 },
  { kind: 'slider', key: 'sfxVolume', label: 'Sound FX', def: 0.8 },
  { kind: 'choice', key: 'screenShake', label: 'Screen Shake', def: true, opts: [[true, 'On'], [false, 'Off']] },
  { kind: 'choice', key: 'particleQuality', label: 'Particles', def: 'high', opts: [['low', 'Low'], ['medium', 'Med'], ['high', 'High']] },
  { kind: 'choice', key: 'touchControls', label: 'Touch Controls', def: 'auto', opts: [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']] },
  { kind: 'back', key: 'back', label: 'Back' },
];

export function settingsPanel(game, ui, data = {}) {
  const hits = createHits();
  let focus = 0, age = 0, lastPreview = -1, closing = false;
  const from = data.from || 'title';
  sfx(game, 'ui_open');

  const get = (row) => {
    const v = game.settings?.[row.key];
    return v === undefined ? row.def : v;
  };
  const set = (row, v) => {
    if (!game.settings) return;
    if (game.settings[row.key] === v) return;
    game.settings[row.key] = v;
    game.guard('settings.save', () => game.saveSettings?.());
    game.guard('audio.applySettings', () => game.audio?.applySettings?.());
  };
  const setVol = (row, v, preview = true) => {
    v = Math.round(clamp(v, 0, 1) * 100) / 100;
    const old = get(row);
    set(row, v);
    if (preview && v !== old && game.realTime - lastPreview > 0.06) {
      lastPreview = game.realTime;
      sfx(game, 'ui_slider', { pitch: 0.7 + v * 0.6 });
    }
  };
  const stepVol = (row, d) => setVol(row, Math.round((get(row) + d) * 10) / 10);
  const cycle = (row, d) => {
    const i = row.opts.findIndex((o) => o[0] === get(row));
    const n = row.opts.length;
    const j = ((i < 0 ? 0 : i) + d + n) % n;
    set(row, row.opts[j][0]);
    sfx(game, 'ui_tab');
  };
  const close = () => {
    if (closing) return;
    closing = true;
    sfx(game, 'ui_back');
    ui.close('settings');
  };
  const focusRow = (i, sound = 'ui_hover') => {
    if (i !== focus) { focus = i; if (sound) sfx(game, sound); }
  };

  return {
    hits,
    update(g, dt) {
      age += dt;
      const inp = g.input;
      const evs = hits.poll(inp);
      for (const e of evs) {
        const d = e.data;
        if (!d) continue;
        if (e.type === 'hover') focusRow(d.row);
        if (e.type === 'press') {
          focusRow(d.row, null);
          if (d.kind === 'slider') setVol(ROWS[d.row], (e.x - d.x) / d.w);
        } else if (e.type === 'drag' && d.kind === 'slider') {
          setVol(ROWS[d.row], (e.x - d.x) / d.w);
        } else if (e.type === 'click') {
          if (d.kind === 'dec') stepVol(ROWS[d.row], -0.1);
          else if (d.kind === 'inc') stepVol(ROWS[d.row], 0.1);
          else if (d.kind === 'opt') {
            const row = ROWS[d.row];
            if (get(row) !== row.opts[d.opt][0]) { set(row, row.opts[d.opt][0]); sfx(g, 'ui_tab'); }
          } else if (d.kind === 'back') { close(); return; }
        }
      }
      if (inp.pressed('cancel') || inp.pressed('pause')) { close(); return; }
      if (inp.pressed('up')) { focus = (focus - 1 + ROWS.length) % ROWS.length; sfx(g, 'ui_move'); }
      if (inp.pressed('down')) { focus = (focus + 1) % ROWS.length; sfx(g, 'ui_move'); }
      const row = ROWS[focus];
      const dx = inp.pressed('left') ? -1 : inp.pressed('right') ? 1 : 0;
      if (dx && row.kind === 'slider') stepVol(row, dx * 0.1);
      else if (dx && row.kind === 'choice') cycle(row, dx);
      if (confirmPressed(inp)) {
        if (row.kind === 'back') close();
        else if (row.kind === 'choice') cycle(row, 1);
        else if (row.kind === 'slider') { focus = Math.min(ROWS.length - 1, focus + 1); sfx(g, 'ui_move'); }
      }
    },
    render(g, ctx, a) {
      hits.begin();
      const { W, H, L, T, Rr, B } = safeRect(g);
      const t = g.realTime;
      const k = easeOutCubic(a / 0.2);
      dim(ctx, W, H, (from === 'pause' ? 0.35 : 0.5) * k);
      hits.add('settings-block', 0, 0, W, H, null);

      const pw = Math.min(Rr - L - 12, 300);
      const rowH = H < 260 ? 19 : 22;
      const ph = 22 + (ROWS.length - 1) * rowH + 30;
      const px = R((L + Rr - pw) / 2);
      const py = R(T + (B - T - ph) / 2 + (1 - k) * 12);
      ctx.save();
      ctx.globalAlpha = k;
      panel(ctx, px, py, pw, ph, { glow: 'rgba(122,90,255,0.22)' });
      ribbon(ctx, px + pw / 2, py - 5, 'SETTINGS');

      const labelW = Math.min(80, R(pw * 0.3));
      const cx0 = px + 12 + labelW, cw = pw - 12 - labelW - 10;
      let y = py + 16;
      for (let i = 0; i < ROWS.length; i++) {
        const row = ROWS[i];
        const f = i === focus;
        if (row.kind === 'back') {
          const bw = 90, bx = R(px + pw / 2 - bw / 2), byy = py + ph - 24;
          hits.add('settings-back', bx, byy, bw, 17, { row: i, kind: 'back' });
          drawButton(ctx, bx, byy, bw, 17, 'Back', { focus: f, pressed: hits.isPressed('settings-back'), t });
          continue;
        }
        const ry = y + i * rowH;
        hits.add(`set-row:${i}`, px + 4, ry - 2, pw - 8, rowH - 1, { row: i, kind: 'row' });
        const ly = ry + R((rowH - 2 - 5) / 2) - 1;
        if (f) {
          ctx.fillStyle = 'rgba(122,90,255,0.20)';
          ctx.fillRect(px + 4, ry - 2, pw - 8, rowH - 2);
          ctx.fillStyle = Math.sin(t * 6) > 0 ? COL.gold : COL.goldHi;
          ctx.fillRect(px + 4, ry - 2, 1, rowH - 2);
          drawText(ctx, '▶', px + 8 + R(Math.sin(t * 7) * 0.5 + 0.5) - 1, ly, { color: COL.gold });
        }
        drawText(ctx, row.label, px + 17, ly, { color: f ? COL.goldHi : COL.text });
        const ch = 13, cy = ry + R((rowH - 2 - ch) / 2) - 1;
        if (row.kind === 'slider') {
          const v = get(row);
          const pct = `${Math.round(v * 100)}%`;
          const pctW = 22;
          const sbw = 13;
          const barX = cx0 + sbw + 4, barW = cw - sbw * 2 - 8 - pctW;
          smallButton(ctx, cx0, cy, sbw, ch, '-', hits.isPressed(`dec:${row.key}`), t);
          hits.add(`dec:${row.key}`, cx0, cy - 2, sbw, ch + 4, { row: i, kind: 'dec' });
          smallButton(ctx, barX + barW + 4, cy, sbw, ch, '+', hits.isPressed(`inc:${row.key}`), t);
          hits.add(`inc:${row.key}`, barX + barW + 4, cy - 2, sbw, ch + 4, { row: i, kind: 'inc' });
          // bar
          const bh = 5, byy = cy + R((ch - bh) / 2);
          bar(ctx, barX, byy, barW, bh, v, v, { fill: f ? COL.gold : COL.edge, hi: f ? COL.goldHi : COL.edgeHi, lo: f ? COL.goldLo : COL.edgeLo }, { segments: 10, shimmer: f ? t * 0.6 : 0 });
          const kx = barX + R(barW * v);
          rrect(ctx, kx - 2, byy - 3, 5, bh + 6, COL.ink);
          rrect(ctx, kx - 1, byy - 2, 3, bh + 4, f ? COL.goldHi : COL.text);
          hits.add(`slider:${row.key}`, barX - 3, cy - 3, barW + 6, ch + 6, { row: i, kind: 'slider', x: barX, w: barW }, { drag: true });
          drawText(ctx, pct, cx0 + cw, ly, { align: 'right', color: v === 0 ? COL.dim : COL.text });
        } else {
          const n = row.opts.length, gap = 3;
          const sw = Math.floor((cw - gap * (n - 1)) / n);
          const cur = get(row);
          for (let j = 0; j < n; j++) {
            const [val, lab] = row.opts[j];
            const sx = cx0 + j * (sw + gap);
            const on = val === cur;
            const id = `opt:${row.key}:${j}`;
            const pr = hits.isPressed(id) ? 1 : 0;
            rrect(ctx, sx - 1, cy - 1, sw + 2, ch + 2, COL.ink);
            rrect(ctx, sx, cy + pr, sw, ch, on ? (f ? COL.gold : COL.goldLo) : COL.edgeLo);
            ctx.fillStyle = on ? mix(COL.gold, COL.bg2, 0.55) : COL.ink2;
            ctx.fillRect(sx + 1, cy + 1 + pr, sw - 2, ch - 2);
            if (on) { ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(sx + 1, cy + 1 + pr, sw - 2, 5); }
            drawText(ctx, lab, sx + sw / 2, cy + 4 + pr, { align: 'center', color: on ? COL.goldHi : COL.dim });
            hits.add(id, sx, cy - 2, sw, ch + 4, { row: i, kind: 'opt', opt: j });
          }
        }
      }
      // hint line
      const hint = promptDevice(g) === 'touch' ? 'Tap or drag to adjust' : '↑↓ choose  ←→ adjust  Esc back';
      drawText(ctx, hint, px + pw / 2, py + ph + 6, { align: 'center', color: COL.dim });
      ctx.restore();
    },
  };
}

function smallButton(ctx, x, y, w, h, label, pressed, t) {
  const o = pressed ? 1 : 0;
  rrect(ctx, x - 1, y - 1, w + 2, h + 2, COL.ink);
  if (!o) rrect(ctx, x, y + 1, w, h, COL.edgeLo);
  rrect(ctx, x, y + o, w, h - 1, COL.edge);
  ctx.fillStyle = pressed ? COL.bg3 : COL.bg2;
  ctx.fillRect(x + 1, y + 1 + o, w - 2, h - 3);
  drawText(ctx, label, x + w / 2, y + 3 + o, { align: 'center', color: COL.text });
}

// ===================================================================== PAUSE

const PC_CONTROLS = [
  ['WASD', 'Move'], ['@mouse', 'Aim'], ['1-4', 'Cast spells'], ['E', 'Interact'],
  ['I', 'Bag'], ['C', 'Craft (hub)'], ['ESC', 'Pause'],
];
const TOUCH_CONTROLS = [
  ['STICK', 'Left thumb: move'], ['1-4', 'Spell buttons'], ['E', 'Interact'],
  ['INV', 'Bag'], ['II', 'Pause'],
];

export function pausePanel(game, ui) {
  const hits = createHits();
  const confirm = createConfirm();
  let done = false;
  sfx(game, 'ui_open');
  const resume = () => {
    if (done) return;
    done = true;
    sfx(game, 'ui_close');
    ui.close('pause');
    game.bus.emit(EV.MENU_RESUME, {});
  };
  const items = [
    { id: 'resume', label: 'Resume', silent: true, onSelect: resume },
    { id: 'inventory', label: 'Inventory', onSelect: () => { if (done) return; done = true; ui.close('pause'); ui.open('inventory'); } },
    { id: 'settings', label: 'Settings', onSelect: () => ui.open('settings', { from: 'pause' }) },
    {
      id: 'quit', label: 'Quit to Title', accent: '#8a3a5a',
      onSelect: () => confirm.open(game, 'Quit to the title screen?\nYour progress is saved.', () => {
        if (done) return;
        done = true;
        ui.close('pause');
        game.bus.emit(EV.MENU_QUIT_TO_TITLE, {});
      }),
    },
  ];
  const menu = createMenu(items, { focus: 0 });

  return {
    hits,
    update(g) {
      const inp = g.input;
      const evs = hits.poll(inp);
      if (done) return;
      if (confirm.active) { confirm.update(g, evs); return; } // Esc here only closes the prompt
      if (inp.pressed('pause') || inp.pressed('cancel')) { resume(); return; }
      if (inp.pressed('inventory')) { items[1].onSelect(); return; }
      menu.handle(g, evs);
    },
    render(g, ctx, a) {
      hits.begin();
      const { W, H, L, T, Rr, B } = safeRect(g);
      const t = g.realTime;
      const k = easeOutCubic(a / 0.18);
      dim(ctx, W, H, 0.6 * k);
      vignette(ctx, W, H, '#05030a', 0.5 * k);
      hits.add('pause-block', 0, 0, W, H, null);
      const wide = Rr - L >= 360;
      const touch = promptDevice(g) === 'touch';
      const ctrl = touch ? TOUCH_CONTROLS : PC_CONTROLS;
      const bw = 120, bh = 18, bgap = 5;
      const btnH = items.length * bh + (items.length - 1) * bgap;
      const cardW = wide ? (touch ? 140 : 120) : Math.min(Rr - L - 40, 220);
      const cardH = 18 + ctrl.length * 11 + 4;
      const infoH = 26;
      let pw, ph;
      if (wide) { pw = 14 + bw + 18 + cardW + 14; ph = 18 + Math.max(infoH + btnH, cardH) + 14; }
      else { pw = Math.min(Rr - L - 16, Math.max(bw, cardW) + 40); ph = 18 + infoH + btnH + 12 + cardH + 14; }
      const px = R((L + Rr - pw) / 2);
      const py = R(T + (B - T - ph) / 2 + (1 - k) * -10);
      ctx.save();
      ctx.globalAlpha = k;
      panel(ctx, px, py, pw, ph, { glow: 'rgba(122,90,255,0.25)' });
      ribbon(ctx, px + pw / 2, py - 8, 'PAUSED', { scale: 2 });

      // info + buttons column
      const colX = wide ? px + 14 : R(px + pw / 2 - bw / 2);
      const colCX = colX + bw / 2;
      let y = py + 18;
      const area = g.level?.name || 'Arcania';
      const areaS = measureText(area) > bw + 10 ? area.slice(0, 24) : area;
      drawText(ctx, areaS, colCX, y, { align: 'center', color: COL.gold });
      const pt = g.state?.stats?.playTime || 0;
      drawText(ctx, `Time ${fmtTime(pt)}`, colCX, y + 10, { align: 'center', color: COL.dim });
      y += infoH;
      for (let i = 0; i < items.length; i++) {
        const by = y + i * (bh + bgap);
        if (!confirm.active) menu.place(hits, i, colX, by, bw, bh);
        menu.draw(ctx, g, i, colX, by, bw, bh, { hits, ox: R((1 - easeOutCubic((a - i * 0.04) / 0.2)) * -8) });
      }

      // controls card
      const cxx = wide ? colX + bw + 18 : R(px + pw / 2 - cardW / 2);
      const cyy = wide ? py + 18 : y + btnH + 12;
      inset(ctx, cxx, cyy, cardW, cardH, 'rgba(11,7,22,0.85)');
      drawText(ctx, 'CONTROLS', cxx + cardW / 2, cyy + 5, { align: 'center', color: COL.edgeHi });
      divider(ctx, cxx + cardW / 2, cyy + 14, cardW - 16, COL.edgeLo, COL.edge);
      let colW = 9;
      for (const [key] of ctrl) colW = Math.max(colW, key === '@mouse' ? 7 : measureText(key) + 5);
      for (let i = 0; i < ctrl.length; i++) {
        const [key, label] = ctrl[i];
        const ry = cyy + 19 + i * 11;
        let kw;
        if (key === '@mouse') { mouseGlyph(ctx, cxx + 8, ry - 1, 'left'); kw = 7; }
        else kw = keycap(ctx, key, cxx + 8, ry - 1, touch ? { face: '#2a4a3a' } : {});
        void kw;
        drawText(ctx, label, cxx + 8 + colW + 6, ry + 1, { color: COL.text });
      }
      ctx.restore();
      if (confirm.active) confirm.render(ctx, g, hits);
    },
  };
}

// ===================================================================== GAME OVER

export function gameoverPanel(game, ui, data = {}) {
  const hits = createHits();
  const ash = createMotes({ n: 40, colors: ['#ff6a3a', '#ff9a5a', '#8a2030', '#ffd25a'], vy: [-16, -6], sway: 8 });
  let age = 0, done = false, queued = false;
  const deaths = data.deaths ?? game.state?.stats?.deaths ?? 0;
  const LINE = 'You awaken at the Academy...';
  const respawn = () => {
    if (done) return;
    done = true;
    // (audio plays 'title_start' itself on MENU_NEW_GAME / MENU_CONTINUE)
    game.bus.emit(EV.MENU_RESPAWN, {});
  };
  const menu = createMenu([{ id: 'respawn', label: 'Rise Again', silent: true, accent: '#c03040', onSelect: respawn }]);
  let typed = 0, lastBlip = 0;

  return {
    hits,
    update(g, dt) {
      age += dt;
      const evs = hits.poll(g.input);
      if (done) return;
      if (confirmPressed(g.input)) queued = true;
      for (const e of evs) if (e.type === 'click' && e.id === 'respawn') queued = true;
      if (queued && age >= 0.22) { queued = false; menu.activate(g, 0); }
      // typewriter blips
      if (age > 0.85) {
        const n = Math.min(LINE.length, Math.floor((age - 0.85) * 26));
        if (n > typed) {
          typed = n;
          if (n - lastBlip >= 2 && LINE[n - 1] !== ' ' && n < LINE.length) { lastBlip = n; sfx(g, 'type', { pitch: 0.7, volume: 0.35 }); }
        }
      }
    },
    render(g, ctx, a) {
      hits.begin();
      const { W, H, L, T, Rr, B } = safeRect(g);
      const t = g.realTime;
      const cx = R((L + Rr) / 2);
      // darken + red vignette
      ctx.fillStyle = `rgba(10,0,4,${0.35 * clamp(a / 0.5, 0, 1)})`;
      ctx.fillRect(0, 0, W, H);
      vignette(ctx, W, H, '#200008', 0.75);
      ash.render(ctx, W, H, t);

      const title = 'YOU HAVE FALLEN';
      const s = clamp(Math.floor((Rr - L - 24) / measureText(title)), 2, H >= 400 ? 5 : 4);
      const Lg = getLogo(title, s, RAMP_RED, { rim: '#2a0008' });
      const tw = Lg.w - Lg.pad * 2;
      const blockH = 5 * s + 14 + 8 + 12 + 10 + 26;
      const ty = R(T + (B - T - blockH) * 0.42);
      // slow drop-in, then a heavy impact shake
      const drop = clamp(a / 0.7, 0, 1);
      const dy = -(1 - easeOutCubic(drop)) * (ty + 5 * s + 10);
      const imp = clamp(1 - (a - 0.7) / 0.6, 0, 1) * (a >= 0.7 ? 1 : 0);
      const sx = R(Math.sin(a * 55) * 3 * imp), sy = R(Math.cos(a * 47) * 2 * imp);
      glow(ctx, cx, ty + 5 * s / 2, tw * 0.7, 10 * s, '#ff2030', (0.18 + 0.05 * Math.sin(t * 2)) * drop);
      drawLogo(ctx, Lg, cx - R(tw / 2) + sx, ty + R(dy) + sy, { alpha: clamp(a / 0.3, 0, 1) });
      if (imp > 0) {
        ctx.fillStyle = `rgba(255,60,60,${0.25 * imp * imp})`;
        ctx.fillRect(0, 0, W, H);
      }
      let y = ty + 5 * s + 12;
      divider(ctx, cx, y, Math.min(tw, 160), '#6a1020', '#ff6a5a');
      y += 8;
      // typewriter line
      const n = a > 0.85 ? Math.min(LINE.length, Math.floor((a - 0.85) * 26)) : 0;
      if (n > 0) {
        const full = measureText(LINE);
        const part = LINE.slice(0, n);
        drawText(ctx, part, cx - R(full / 2), y, { color: '#e8c8d0' });
        if (n < LINE.length && Math.floor(t * 4) % 2) {
          ctx.fillStyle = '#e8c8d0';
          ctx.fillRect(cx - R(full / 2) + measureText(part) + 2, y, 3, 5);
        }
      }
      y += 12;
      const dA = clamp((a - 1.4) / 0.4, 0, 1);
      drawText(ctx, `Deaths: ${deaths}`, cx, y, { align: 'center', color: '#c06a7a', alpha: dA });
      y += 14;
      // button: usable almost immediately; fades in
      const bw = 128, bh = 18, bx = cx - R(bw / 2);
      const by = Math.min(y + 4, B - bh - 18);
      menu.place(hits, 0, bx, by, bw, bh);
      const bA = clamp((a - 0.1) / 0.35, 0, 1);
      menu.draw(ctx, g, 0, bx, by, bw, bh, { hits, alpha: bA });
      const hint = promptDevice(g) === 'touch' ? 'Tap to return to the Academy' : 'Enter to return to the Academy';
      drawText(ctx, hint, cx, by + bh + 7, { align: 'center', color: COL.dim, alpha: bA * 0.9 });
    },
  };
}

// ===================================================================== VICTORY

const CREDITS = [
  ['h', 'ARCANIA ACADEMY'], ['', ''],
  ['g', 'Design & Code'], ['', 'The Arcania team'], ['', ''],
  ['g', 'Core & Engine'], ['', 'Core team'], ['', ''],
  ['g', 'Art & FX'], ['', 'Art & FX team'], ['', ''],
  ['g', 'Combat & Spells'], ['', 'Combat team'], ['', ''],
  ['g', 'World & Story'], ['', 'World team'], ['', ''],
  ['g', 'UI & Audio'], ['', 'UI & Audio team'], ['', ''],
  ['d', 'Every pixel and note'], ['d', 'was made in code.'], ['', ''],
  ['h', 'Thank you for playing!'], ['', ''], ['', ''],
];

export function victoryPanel(game, ui, data = {}) {
  const hits = createHits();
  const fw = createFireworks();
  const motes = createMotes({ n: 30, colors: [COL.gold, COL.goldHi, '#ffffff', '#c8b8ff'], vy: [-10, -3] });
  let age = 0, done = false, queued = false;
  const st = data.stats || game.state?.stats || {};
  const state = game.state || {};
  const frags = Object.values(state.fragments || {}).reduce((s, v) => s + (Number(v) || 0), 0);
  const STATS = [
    ['Enemies defeated', st.kills ?? 0],
    ['Spells cast', st.spellsCast ?? 0],
    ['Spells known', state.spells?.known?.length ?? 0],
    ['Fragments held', frags],
    ['Deaths', st.deaths ?? 0],
    ['Time played', fmtTime(st.playTime)],
  ];
  const leave = () => {
    if (done) return;
    done = true;
    sfx(game, 'ui_select');
    game.bus.emit(EV.MENU_QUIT_TO_TITLE, {});
  };
  const menu = createMenu([{ id: 'title', label: 'Return to Title', silent: true, accent: COL.goldLo, onSelect: leave }]);

  return {
    hits,
    update(g, dt) {
      age += dt;
      const evs = hits.poll(g.input);
      if (done) return;
      if (confirmPressed(g.input)) queued = true;
      for (const e of evs) if (e.type === 'click' && e.id === 'title') queued = true;
      if (queued && age >= 0.22) { queued = false; menu.activate(g, 0); }
    },
    render(g, ctx, a) {
      hits.begin();
      const { W, H, L, T, Rr, B } = safeRect(g);
      const t = g.realTime;
      const cx = R((L + Rr) / 2);
      const portrait = H > W;
      ctx.fillStyle = 'rgba(8,4,20,0.25)';
      ctx.fillRect(0, 0, W, H);
      fw.render(ctx, W, H, t, portrait ? { x: L + 20, y: T + 10, w: Rr - L - 40, h: H * 0.22 } : { x: L + 16, y: T + 8, w: Rr - L - 32, h: H * 0.45 });
      motes.render(ctx, W, H, t);

      // title
      const s = clamp(Math.floor((Rr - L - 30) / 36), 3, H >= 400 ? 6 : 5);
      const Lg = getLogo('VICTORY!', s, RAMP_GOLD);
      const tw = Lg.w - Lg.pad * 2;
      const ty = T + (portrait ? R(H * 0.08) : 10);
      glow(ctx, cx, ty + 5 * s / 2, tw * 0.8, 8 * s, '#ffd25a', 0.18 + 0.06 * Math.sin(t * 2));
      const sh = (t % 2.4) / 0.8;
      drawLogo(ctx, Lg, cx - R(tw / 2), ty, {
        wave: (i) => Math.sin(t * 3 + i * 0.8) * 1.5 - (1 - easeOutBack(clamp((a - i * 0.06) / 0.5, 0, 1))) * 12,
        letterAlpha: (i) => clamp((a - i * 0.06) / 0.2, 0, 1),
        shimmer: sh <= 1 ? sh : -1,
      });
      for (let i = 0; i < 4; i++) {
        const ang = t * 1.3 + i * 1.57;
        sparkle(ctx, cx + Math.cos(ang) * (tw / 2 + 10), ty + 5 * s / 2 + Math.sin(ang) * 3 * s, Math.sin(t * 5 + i) > 0.3 ? 2 : 1, elColor(ELS[i], 1));
      }
      let y = ty + 5 * s + 9;
      const subA = clamp((a - 0.5) / 0.5, 0, 1);
      const sub = 'The Archmage is freed. Arcania is saved.';
      if (measureText(sub) <= Rr - L - 12) drawText(ctx, sub, cx, y, { align: 'center', color: COL.edgeHi, alpha: subA });
      else {
        drawText(ctx, 'The Archmage is freed.', cx, y, { align: 'center', color: COL.edgeHi, alpha: subA });
        y += 9;
        drawText(ctx, 'Arcania is saved.', cx, y, { align: 'center', color: COL.edgeHi, alpha: subA });
      }
      y += 13;

      // cards
      const bh = 18, bw = 132;
      const btnY = B - bh - (portrait ? 26 : 16);
      const cardA = clamp((a - 0.7) / 0.4, 0, 1);
      const cardOff = R((1 - easeOutCubic(cardA)) * 10);
      let stats, cred;
      const statsH = 24 + STATS.length * 10;
      if (!portrait && Rr - L >= 330) {
        const cw = Math.min(180, R((Rr - L - 36) / 2));
        const ch = Math.max(60, Math.min(statsH + 10, btnY - 10 - y));
        const cy = y + Math.max(0, R((btnY - 10 - y - ch) * 0.4));
        stats = { x: cx - cw - 6, y: cy, w: cw, h: ch };
        cred = { x: cx + 6, y: cy, w: cw, h: ch };
      } else {
        const cw = Math.min(Rr - L - 24, 240);
        const credH = Math.max(40, Math.min(150, btnY - 18 - y - statsH));
        const gapS = Math.max(8, Math.min(24, R((btnY - 10 - y - statsH - credH) / 3)));
        stats = { x: cx - R(cw / 2), y: y + gapS, w: cw, h: statsH };
        cred = { x: cx - R(cw / 2), y: y + gapS * 2 + statsH, w: cw, h: credH };
      }
      ctx.save();
      ctx.globalAlpha = cardA;
      // stats
      panel(ctx, stats.x, stats.y + cardOff, stats.w, stats.h, { glow: 'rgba(255,210,90,0.12)' });
      drawText(ctx, 'JOURNEY', stats.x + stats.w / 2, stats.y + cardOff + 6, { align: 'center', color: COL.gold });
      divider(ctx, stats.x + stats.w / 2, stats.y + cardOff + 15, stats.w - 20);
      const rowH = Math.min(10, Math.floor((stats.h - 22) / STATS.length));
      STATS.forEach(([lab, val], i) => {
        const ry = stats.y + cardOff + 21 + i * rowH;
        const show = clamp((a - 0.9 - i * 0.12) / 0.2, 0, 1);
        drawText(ctx, lab, stats.x + 9, ry, { color: COL.dim, alpha: show });
        drawText(ctx, String(val), stats.x + stats.w - 9, ry, { align: 'right', color: COL.text, alpha: show });
      });
      // credits (auto-scroll, clipped)
      panel(ctx, cred.x, cred.y + cardOff, cred.w, cred.h, {});
      const clip = { x: cred.x + 3, y: cred.y + cardOff + 3, w: cred.w - 6, h: cred.h - 6 };
      ctx.save();
      ctx.beginPath();
      ctx.rect(clip.x, clip.y, clip.w, clip.h);
      ctx.clip();
      const lineH = 10, total = CREDITS.length * lineH;
      const start = R(clip.h * 0.3), cycle = total + clip.h;
      const scroll = (Math.max(0, a - 1.6) * 12) % cycle;
      let baseY = clip.y + start - scroll;
      if (baseY + total < clip.y) baseY += cycle; // wrap: re-enter from the bottom
      for (let i = 0; i < CREDITS.length; i++) {
        const [kind, text] = CREDITS[i];
        if (!text) continue;
        const ly = R(baseY + i * lineH);
        if (ly < clip.y - 8 || ly > clip.y + clip.h) continue;
        const col = kind === 'h' ? COL.gold : kind === 'g' ? COL.edgeHi : kind === 'd' ? COL.dim : COL.text;
        drawText(ctx, text, cred.x + cred.w / 2, ly, { align: 'center', color: col });
      }
      // soft fade at the clip edges
      const fade = (yy, up) => {
        for (let r = 0; r < 6; r++) {
          ctx.fillStyle = `rgba(28,18,48,${(1 - r / 6) * 0.85})`;
          ctx.fillRect(clip.x, up ? yy + r : yy - r - 1, clip.w, 1);
        }
      };
      fade(clip.y, true);
      fade(clip.y + clip.h, false);
      ctx.restore();
      ctx.restore();

      // button (final position from frame one)
      const bx = cx - R(bw / 2);
      menu.place(hits, 0, bx, btnY, bw, bh);
      menu.draw(ctx, g, 0, bx, btnY, bw, bh, { hits, alpha: clamp((a - 0.1) / 0.35, 0, 1) });
      const hint = promptDevice(g) === 'touch' ? 'Tap to continue' : 'Press Enter';
      drawText(ctx, hint, cx, btnY + bh + 6, { align: 'center', color: COL.dim, alpha: 0.8 });
    },
  };
}
