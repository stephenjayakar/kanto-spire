// Dev-only viewer for the Gen 4 species (game/gen4.js): a contact sheet of all 107 front sprites (animated, 2x like in
// battle), icons, the cross-gen evolution pairs next to their FireRed pre-evolutions (HGSS method -> this game's rule),
// cries on click. An art / data check, not part of the game.
// Reads web/assets directly (local only; build_site.cjs leaves this page out of dist/). tests/gen4_shots.cjs
// screenshots it. Window hooks: gen4Lab.ready, gen4Lab.count, gen4Lab.errors, gen4Lab.set({shiny, back, still}).
import { loadGen4, applyGen4 } from '../game/gen4.js';

const A = 'assets/';
const $ = (id) => document.getElementById(id);
const lab = window.gen4Lab = { ready: false, count: 0, errors: [] };
const opt = { shiny: false, back: false, still: false };
const json = (f) => fetch(A + 'data/' + f).then(r => { if (!r.ok) throw new Error(f + ': HTTP ' + r.status); return r.json(); });
const imgOk = (src) => new Promise(res => { const i = new Image(); i.onload = () => res(true); i.onerror = () => { lab.errors.push('missing ' + src); res(false); }; i.src = src; });

async function main() {
  const [g4, fr] = await Promise.all([loadGen4(json), json('species.json')]);
  // the merge as data.js does it (on a copy of FireRed's species): how each cross-gen evolution works in the game
  const D = { species: structuredClone(fr) };
  const added = applyGen4(D, g4);
  const list = Object.values(g4.species).sort((a, b) => a.dex - b.dex);
  const cards = [];
  for (const s of list) {
    const c = document.createElement('div');
    c.className = 'card' + (s.mythical ? ' myth' : s.legendary ? ' leg' : '');
    c.title = `${s.name} #${s.dex}\n${s.category} POKéMON\n${s.dexText}\nfront scale x${s.spriteScale}\nabilities: ${s.abilities.join(', ') || '-'} (HGSS: ${s.gen4Abilities.join(', ')})`;
    c.innerHTML = `<div class="spr"></div><div class="ico"></div><div class="nm">${String(s.dex).padStart(3, '0')} ${s.name}</div><div class="tp">${s.types.join('/')}${s.legendary ? ' · LEGENDARY' : s.mythical ? ' · MYTHICAL' : ''}</div>`;
    c.onclick = () => { if (s.cryWav) new Audio(A + s.cryWav).play().catch(() => {}); };
    $('grid').appendChild(c);
    cards.push({ s, spr: c.querySelector('.spr'), ico: c.querySelector('.ico') });
  }
  let frame = 0;
  const paint = () => {
    const f = opt.still ? 0 : frame, sh = opt.shiny ? '_shiny' : '';
    for (const { s, spr, ico } of cards) {
      if (opt.back) Object.assign(spr.style, { backgroundImage: `url(${A}${s.gfxDir}/back${sh}.png)`, backgroundSize: '128px 128px', backgroundPosition: '0 0' });
      else Object.assign(spr.style, { backgroundImage: `url(${A}${s.gfxDir}/anim_front${sh}.png)`, backgroundSize: '256px 128px', backgroundPosition: `${-128 * f}px 0` });
      Object.assign(ico.style, { backgroundImage: `url(${A}${s.gfxDir}/icon.png)`, backgroundPosition: `0 ${-32 * f}px` });
    }
  };
  paint();
  setInterval(() => { frame ^= 1; paint(); }, 500);
  lab.set = (o) => { Object.assign(opt, o); for (const k of Object.keys(opt)) $(k).checked = opt[k]; paint(); };
  for (const k of Object.keys(opt)) $(k).onchange = (e) => { opt[k] = e.target.checked; paint(); };

  // cross-gen pairs: FireRed pre-evolution -> Gen 4 evolution; Gen 4 baby -> FireRed evolution
  const frFront = (key) => `${A}gfx/pokemon/${(fr[key].gfx || key.toLowerCase()).replace('/', '_')}/front.png`;
  const g4Front = (key) => `${A}${g4.species[key].gfxDir}/front.png`;
  const pair = (a, aSrc, b, bSrc, how) => {
    const r = document.createElement('div');
    r.className = 'row';
    r.innerHTML = `<div><img src="${aSrc}"><div class="cap">${a}</div></div><div class="arrow">&rarr;<div class="cap">${how}</div></div><div><img src="${bSrc}"><div class="cap">${b}</div></div>`;
    $('cross').appendChild(r);
  };
  const word = (m, p) => m.toLowerCase().replace(/_/g, ' ') + (p ? ' ' + String(p).toLowerCase().replace(/_/g, ' ') : '');
  const how = (e) => (e.gen4Method ? word(e.gen4Method, e.gen4Param) + ' &rArr; ' : '') + word(e.method, e.param);
  const gameEvo = (from, into) => (D.species[from].evolutions || []).find(x => x.into === into);
  for (const [pre, evos] of Object.entries(g4.crossGen.evolutions)) for (const e of evos) pair(fr[pre].name, frFront(pre), g4.species[e.into].name, g4Front(e.into), how(gameEvo(pre, e.into) || e));
  for (const [evo, baby] of Object.entries(g4.crossGen.preEvolutions)) {
    const e = gameEvo(baby, evo);
    pair(g4.species[baby].name, g4Front(baby), fr[evo].name, frFront(evo), e ? how(e) : '');
  }
  const crossN = Object.values(g4.crossGen.evolutions).flat().length + Object.keys(g4.crossGen.preEvolutions).length;
  $('info').textContent = `${list.length} species (${list.filter(s => s.legendary).length} legendary, ${list.filter(s => s.mythical).length} mythical), ${crossN} cross-gen links; merge test: ${added} added -> ${Object.keys(D.species).length} species`;

  // every file the species point at must exist
  const files = list.flatMap(s => ['front', 'front_shiny', 'back', 'back_shiny', 'anim_front', 'anim_front_shiny', 'icon'].map(k => `${A}${s.gfxDir}/${k}.png`));
  await Promise.all(files.map(imgOk));
  lab.count = list.length;
  lab.ready = true;
}
main().catch(e => { lab.errors.push(String(e)); lab.ready = true; $('info').textContent = 'ERROR ' + e; });
