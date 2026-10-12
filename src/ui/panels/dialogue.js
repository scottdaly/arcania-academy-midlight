// Dialogue box (team: ui). Contract: ARCHITECTURE.md §7.7.
// data = DIALOGUE_OPEN payload {dialogueId, dialogue, npcId, speakers}.
// - Node actions are emitted (EV.DIALOGUE_ACTION) when a node is entered; choice actions when picked.
// - EV.DIALOGUE_CLOSED is emitted exactly once, whichever way the panel closes (onClose fallback).
// Hit ids: 'dialogue-advance' (whole screen; tap = skip typing / next) and 'choice-<i>'.
import { EV } from '../../core/events.js';
import { checkRequirements } from '../../core/state.js';
import { drawText, measureText, wrapText } from '../font.js';
import { createHits, drawPrompt } from '../widgets.js';
import { COL, panel, rrect, clamp, easeOutCubic, mix } from '../theme.js';
import { sfx, hash32, R, confirmPressed, createMenu, drawButton } from './menu-kit.js';

const CPS = 45; // typewriter characters per second
const LINES = 3; // visible lines per page
const LINE_H = 9;
const NODE_LOCK = 0.08; // ignore advance input this long after entering a node / page
const FRAME = 36; // portrait frame (32 px portrait + border)

export function dialoguePanel(game, ui, data = {}) {
  const { dialogue, npcId = null, dialogueId = null } = data;
  const speakers = data.speakers || {};
  const hits = createHits();

  let node = null, nodeId = null;
  let page = 0, shown = 0, acc = 0, pause = 0, visCount = 0;
  let nodeAge = 0, age = 0, choicesAt = -1;
  let closed = false, emitted = false, pendingFinish = false, starting = true;
  let choiceMenu = null, choiceList = [];
  let wrapKey = '', pages = [[]];

  // ---------------------------------------------------------------- flow
  const emitClosed = () => {
    if (emitted) return;
    emitted = true;
    game.bus.emit(EV.DIALOGUE_CLOSED, { npcId, dialogueId });
  };
  const finish = () => {
    if (closed) return;
    if (starting) { pendingFinish = true; return; } // never close from inside the factory
    closed = true;
    sfx(game, 'ui_close');
    ui.close('dialogue'); // -> onClose -> emitClosed (or emit below if we were already gone)
    emitClosed();
  };
  const visibleChoices = () => (Array.isArray(node?.choices) ? node.choices : [])
    .filter((c) => c && game.guard('dialogue.requires', () => checkRequirements(game.state, c.requires)) !== false);

  const enter = (id) => {
    if (closed) return;
    const nodes = dialogue?.nodes || {};
    if (id == null || !nodes[id]) { finish(); return; }
    nodeId = id;
    node = nodes[id];
    page = 0; shown = 0; acc = 0; pause = 0; visCount = 0; nodeAge = 0; choicesAt = -1;
    wrapKey = '';
    choiceList = visibleChoices();
    choiceMenu = createMenu(choiceList.map((c, i) => ({
      id: `choice-${i}`, label: String(c.text ?? '...'), silent: true, onSelect: () => pick(i),
    })), { focus: 0 });
    for (const action of node.actions || []) {
      game.bus.emit(EV.DIALOGUE_ACTION, { action, npcId, dialogueId });
      if (closed) return; // an action may have closed us (scene change, ...)
    }
  };
  const pick = (i) => {
    const c = choiceList[i];
    if (!c || closed) return;
    sfx(game, 'ui_select');
    for (const action of c.actions || []) {
      game.bus.emit(EV.DIALOGUE_ACTION, { action, npcId, dialogueId });
      if (closed) return;
    }
    enter(c.next ?? null);
  };

  // ---------------------------------------------------------------- layout + text
  /** Narration (speaker 'narrator' or an explicit `portrait: null`) has no portrait frame. */
  const hidePortrait = () => {
    const id = node?.speaker;
    if (!id || id === 'narrator') return true;
    const sp = speakers[id];
    return !!sp && sp.portrait === null;
  };
  const layout = () => {
    const { width: W, height: H, safe } = game.display;
    const L = safe.left, Rr = W - safe.right, B = H - safe.bottom;
    const w = Math.min(Rr - L - 12, 460);
    const h = 50;
    const x = R((L + Rr - w) / 2), y = B - 6 - h;
    const right = node?.speaker === 'player';
    const noPortrait = hidePortrait();
    const fx = right ? x + w - 7 - FRAME : x + 7;
    const tx = noPortrait ? x + 12 : right ? x + 10 : x + 7 + FRAME + 8;
    const tw = noPortrait ? w - 24 : w - FRAME - 7 - 8 - 12;
    return { W, H, L, Rr, B, x, y, w, h, fx, fy: y + 7, tx, ty: y + 12, tw, right, noPortrait };
  };
  const ensureWrap = (lay) => {
    const key = `${nodeId}|${lay.tw}`;
    if (key === wrapKey) return;
    wrapKey = key;
    const lines = wrapText(String(node?.text ?? ''), lay.tw);
    pages = [];
    for (let i = 0; i < lines.length; i += LINES) pages.push(lines.slice(i, i + LINES));
    if (!pages.length) pages.push(['']);
    if (page >= pages.length) { page = pages.length - 1; shown = Infinity; }
  };
  const pageLen = () => pages[page].reduce((n, l) => n + l.length, 0);
  const pageChar = (i) => {
    for (const l of pages[page]) { if (i < l.length) return l[i]; i -= l.length; }
    return '';
  };
  const lastPage = () => page >= pages.length - 1;
  const typing = () => shown < pageLen();
  const showChoices = () => !typing() && lastPage() && choiceList.length > 0;

  const speakerPitch = () => {
    const sp = node?.speaker || '';
    if (sp === 'player') return 1.0;
    return 0.8 + (hash32(sp) % 8) * 0.06;
  };

  const advance = (fromTap = false) => {
    if (closed || !node) return;
    if (nodeAge < NODE_LOCK) return;
    if (typing()) { shown = pageLen(); pause = 0; return; }
    if (!lastPage()) { page++; shown = 0; acc = 0; nodeAge = NODE_LOCK * 0.5; sfx(game, 'ui_move', { volume: 0.5 }); return; }
    if (choiceList.length) {
      if (!fromTap) choiceMenu.activate(game, choiceMenu.focus);
      return;
    }
    sfx(game, 'ui_select', { volume: 0.6 });
    enter(node.next ?? null);
  };

  // ---------------------------------------------------------------- start
  sfx(game, 'dialogue_open');
  if (!dialogue || !dialogue.nodes) pendingFinish = true;
  else {
    enter(dialogue.start);
    if (!node) pendingFinish = true;
  }
  starting = false;

  return {
    hits,
    onClose() {
      closed = true;
      emitClosed();
    },
    update(g, dt) {
      age += dt;
      nodeAge += dt;
      const inp = g.input;
      const evs = hits.poll(inp);
      if (pendingFinish) { pendingFinish = false; finish(); return; }
      if (closed || !node) return;
      const lay = layout();
      ensureWrap(lay);

      // typewriter
      if (typing()) {
        if (pause > 0) pause -= dt;
        else {
          acc += dt * CPS;
          const len = pageLen();
          while (acc >= 1 && shown < len) {
            acc -= 1;
            const ch = pageChar(shown);
            shown++;
            if (ch !== ' ') {
              visCount++;
              if (visCount % 2 === 0) sfx(g, 'type', { pitch: speakerPitch() * (0.96 + Math.random() * 0.08), volume: 0.5 });
            }
            const nx = pageChar(shown);
            if ((ch === '.' || ch === '!' || ch === '?') && (nx === ' ' || nx === '') && shown < len) { pause = 0.22; acc = 0; break; }
            if ((ch === ',' || ch === ';' || ch === ':') && shown < len) { pause = 0.09; acc = 0; break; }
          }
        }
      }
      if (showChoices() && choicesAt < 0) choicesAt = age;

      // pointer
      for (const e of evs) {
        if (e.id === 'dialogue-advance') {
          if (e.type === 'press') advance(true);
        } else if (String(e.id).startsWith('choice-') && showChoices()) {
          // the menu handles hover / click on choices (keys handled below)
          choiceMenu.handle(g, [e], { allowKeys: false });
          if (closed) return;
        }
      }
      if (closed) return;

      // keys
      if (showChoices()) {
        if (inp.pressed('up')) choiceMenu.move(g, -1);
        else if (inp.pressed('down')) choiceMenu.move(g, 1);
        if (confirmPressed(inp) && age - choicesAt >= 0.05) advance(false);
        // cancel with choices: stay (the player must pick)
      } else if (confirmPressed(inp) || inp.pressed('cancel')) advance(false);
    },

    render(g, ctx, a) {
      hits.begin();
      if (!node || closed) return;
      const lay = layout();
      ensureWrap(lay);
      const t = g.realTime;
      const k = easeOutCubic(a / 0.22);
      const off = R((1 - k) * (lay.h + 16));

      // soft dark gradient behind the box for legibility
      const gh = Math.min(lay.H, lay.h + 40);
      const grad = ctx.createLinearGradient(0, lay.H - gh, 0, lay.H);
      grad.addColorStop(0, 'rgba(5,3,10,0)');
      grad.addColorStop(1, `rgba(5,3,10,${0.55 * k})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, lay.H - gh, lay.W, gh);

      hits.add('dialogue-advance', 0, 0, lay.W, lay.H, null);

      const x = lay.x, y = lay.y + off, w = lay.w, h = lay.h;
      ctx.save();
      ctx.globalAlpha = k;
      panel(ctx, x, y, w, h, { glow: 'rgba(122,90,255,0.18)' });

      // portrait
      if (!lay.noPortrait) drawPortrait(ctx, g, node.speaker, speakers, lay.fx, lay.fy + off, typing() && pause <= 0, t, lay.right);

      // name plate
      const sp = speakers[node.speaker] || {};
      const name = String(sp.name ?? (node.speaker === 'player' ? 'You' : node.speaker === 'narrator' ? '' : node.speaker || ''));
      if (name) {
        const nw = measureText(name) + 12;
        const nx = lay.right && !lay.noPortrait ? x + w - 7 - FRAME - 4 - nw : lay.tx - 3;
        const ny = y - 6;
        rrect(ctx, nx - 1, ny - 1, nw + 2, 13, COL.ink);
        rrect(ctx, nx, ny, nw, 11, COL.goldLo);
        ctx.fillStyle = mix(COL.edgeLo, COL.ink, 0.3);
        ctx.fillRect(nx + 1, ny + 1, nw - 2, 9);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(nx + 1, ny + 1, nw - 2, 4);
        drawText(ctx, name, nx + nw / 2, ny + 3, { align: 'center', color: COL.gold });
      }

      // text (typewriter)
      let left = shown;
      const lines = pages[page] || [];
      for (let i = 0; i < lines.length && left > 0; i++) {
        const l = lines[i];
        const part = left >= l.length ? l : l.slice(0, left);
        left -= l.length;
        drawText(ctx, part, lay.tx, lay.ty + off + i * LINE_H, { color: lay.noPortrait && node.speaker !== 'player' ? COL.edgeHi : COL.text });
      }

      // page dots
      if (pages.length > 1) {
        for (let i = 0; i < pages.length; i++) {
          ctx.fillStyle = i === page ? COL.gold : COL.edgeLo;
          ctx.fillRect(lay.tx + i * 4, y + h - 6, 2, 2);
        }
      }

      // advance indicator
      if (!typing() && !showChoices()) {
        const bob = Math.floor(t * 3) % 2;
        const ix = lay.right ? lay.tx + lay.tw - 4 : x + w - 12;
        if (Math.floor(t * 2.5) % 3 !== 2) drawText(ctx, '▼', ix, y + h - 11 + bob, { color: COL.gold });
      }
      ctx.restore();

      // hint (device aware) above the box
      if (k > 0.9) {
        const label = typing() ? 'Skip' : showChoices() ? 'Choose' : lastPage() && !node.next ? 'Close' : 'Next';
        const action = showChoices() ? 'confirm' : 'interact';
        const hx = lay.right ? x + 6 : x + w - 4;
        const align = lay.right ? 'left' : 'right';
        const pw = drawPrompt(ctx, g, action, label, -999, -999, { align: 'left', alpha: 0 }); // measure
        const px0 = align === 'left' ? hx : hx - pw;
        ctx.fillStyle = 'rgba(11,7,22,0.72)';
        rrect(ctx, px0 - 3, y - 14, pw + 6, 13, 'rgba(11,7,22,0.72)');
        drawPrompt(ctx, g, action, label, hx, y - 12, { align, color: COL.edgeHi });
      }

      // choices
      if (showChoices()) {
        const n = choiceList.length;
        const ch = 15, gap = 4;
        const maxW = Math.min(w, lay.Rr - lay.L - 12);
        let cw = 0;
        for (const it of choiceMenu.items) cw = Math.max(cw, measureText(it.label));
        cw = clamp(cw + 28, 110, maxW);
        for (const it of choiceMenu.items) it.label = fitText(it.label, cw - 16);
        const bottom = y - 16;
        const cxr = lay.right ? x : x + w - cw;
        for (let i = 0; i < n; i++) {
          const cy = bottom - (n - i) * (ch + gap);
          const ap = easeOutCubic((age - choicesAt - i * 0.04) / 0.18);
          choiceMenu.place(hits, i, cxr, cy, cw, ch);
          const f = i === choiceMenu.focus;
          drawButton(ctx, cxr + R((1 - ap) * 16 * (lay.right ? -1 : 1)), cy, cw, ch, choiceMenu.items[i].label, {
            focus: f, pressed: hits.isPressed(`choice-${i}`), t, alpha: ap, arrows: false,
          });
          if (f && ap > 0.9) drawText(ctx, '▶', cxr - 7 - (Math.floor(t * 5) % 2), cy + 4, { color: COL.gold });
        }
      }
    },
  };
}

/** Trim a label to fit maxW px (adds '…'). */
function fitText(text, maxW) {
  if (measureText(text) <= maxW) return text;
  let s = text;
  while (s.length > 1 && measureText(s + '…') > maxW) s = s.slice(0, -1);
  return s + '…';
}

/** Portrait frame + speaker portrait (talk anim while typing). (x,y) = frame top-left. */
function drawPortrait(ctx, game, speaker, speakers, x, y, talking, t, flip) {
  x = R(x); y = R(y);
  // ornate frame
  rrect(ctx, x - 1, y - 1, FRAME + 2, FRAME + 2, COL.ink);
  rrect(ctx, x, y, FRAME, FRAME, COL.goldLo);
  ctx.fillStyle = COL.gold;
  ctx.fillRect(x + 1, y, FRAME - 2, 1);
  ctx.fillStyle = '#120a22';
  ctx.fillRect(x + 2, y + 2, FRAME - 4, FRAME - 4);
  ctx.fillStyle = 'rgba(122,90,255,0.18)';
  ctx.fillRect(x + 2, y + 2, FRAME - 4, R((FRAME - 4) / 2));
  const inner = { x: x + 2, y: y + 2, w: FRAME - 4, h: FRAME - 4 };

  const art = game.art || {};
  const sp = speakers[speaker] || {};
  let key = null;
  for (const k of [sp.portrait, `portrait_${speaker}`]) {
    if (!k) continue;
    const has = typeof art.hasSprite === 'function' ? art.hasSprite(k) : !!art.getSprite;
    if (has) { key = k; break; }
  }
  const s = key && typeof art.getSprite === 'function' ? art.getSprite(key) : null;
  if (s && s.canvas && s.fw > 0 && s.fh > 0) {
    const anim = (talking && s.anims?.talk) || s.anims?.idle || null;
    let frame = 0;
    if (anim && anim.frames?.length) frame = anim.frames[Math.floor(t * (anim.fps || 6)) % anim.frames.length] | 0;
    const maxF = Math.max(1, Math.floor(s.canvas.width / s.fw));
    if (frame >= maxF) frame = 0;
    const dw = Math.min(s.fw, inner.w), dh = Math.min(s.fh, inner.h);
    const sx = frame * s.fw + Math.floor((s.fw - dw) / 2), sy = Math.max(0, s.fh - dh);
    const dx = inner.x + Math.floor((inner.w - dw) / 2), dy = inner.y + inner.h - dh;
    ctx.save();
    if (flip) {
      ctx.translate(dx * 2 + dw, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(s.canvas, sx, sy, dw, dh, dx, dy, dw, dh);
    ctx.restore();
  } else {
    // placeholder: hooded silhouette with the speaker's initial
    ctx.fillStyle = '#2a1e4a';
    ctx.fillRect(inner.x + 9, inner.y + 6, 14, 12);
    ctx.fillRect(inner.x + 5, inner.y + 18, 22, 14);
    ctx.fillStyle = '#3a2a6a';
    ctx.fillRect(inner.x + 10, inner.y + 7, 12, 1);
    const initial = String(sp.name || speaker || '?').charAt(0).toUpperCase();
    drawText(ctx, initial, inner.x + inner.w / 2, inner.y + 9, { align: 'center', color: COL.gold });
  }
  // corner studs
  ctx.fillStyle = COL.gold;
  ctx.fillRect(x, y, 2, 2);
  ctx.fillRect(x + FRAME - 2, y, 2, 2);
  ctx.fillRect(x, y + FRAME - 2, 2, 2);
  ctx.fillRect(x + FRAME - 2, y + FRAME - 2, 2, 2);
}
