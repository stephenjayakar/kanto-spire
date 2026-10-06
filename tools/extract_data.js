#!/usr/bin/env node
// Kanto Spire data pipeline: parses the pret/pokefirered decomp (C headers + JSON)
// and writes game data JSON to web/assets/data/. Node 22, no npm deps.
//
//   node tools/extract_data.js            # extract + verify
//   node tools/extract_data.js --no-verify
//
// See tools/DATA.md for the output schemas.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PF = path.join(ROOT, 'pokefirered');
const OUT = path.join(ROOT, 'web', 'assets', 'data');
// Only symbols the FireRed (rev 0, English) build actually defines; #ifdef LEAFGREEN must be false.
const GAME_DEFINES = { FIRERED: 1, ENGLISH: 1, REVISION: 0 };

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------
const rd = (rel) => fs.readFileSync(path.join(PF, rel), 'utf8').replace(/\r\n?/g, '\n');
const exists = (rel) => fs.existsSync(path.join(PF, rel));
const strip = (s, prefix) => (s.startsWith(prefix) ? s.slice(prefix.length) : s);
const warnings = [];
const warn = (m) => { warnings.push(m); };

// Remove /* */ and // comments, leaving string/char literals intact.
function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === '"' || c === "'") {
      const q = c; out += c; i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') { out += src[i++]; }
        if (src[i] === '\n') break; // unterminated (e.g. apostrophe in a #error); bail
        out += src[i++];
      }
      if (i < src.length) out += src[i];
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const chunk = src.slice(i, end < 0 ? src.length : end + 2);
      out += chunk.replace(/[^\n]/g, ' ');
      i = end < 0 ? src.length : end + 1;
    } else if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
    } else out += c;
  }
  return out;
}

// Minimal preprocessor: joins continuation lines, evaluates #if/#ifdef/#ifndef/#elif/#else/#endif
// against GAME_DEFINES (+ any simple #defines seen), drops non-#define directives.
function preprocess(src, extraDefs = {}) {
  src = stripComments(src).replace(/\\\n/g, ' ');
  const defs = Object.assign({}, GAME_DEFINES, extraDefs);
  const lines = src.split('\n');
  const stack = []; // {active, taken, parentActive}
  const isActive = () => stack.every((s) => s.active);
  const evalCond = (expr) => {
    let e = expr.replace(/defined\s*\(\s*(\w+)\s*\)|defined\s+(\w+)/g, (_, a, b) => ((a || b) in defs ? '1' : '0'));
    e = e.replace(/\b0[xX][0-9a-fA-F]+\b|\b\d+\b|[A-Za-z_]\w*/g, (id) => (/^\d/.test(id) ? id : id in defs ? String(Number(defs[id]) || 0) : '0'));
    try { return !!Function(`return (${e});`)(); } catch { warn(`#if eval failed: ${expr}`); return false; }
  };
  const out = [];
  for (const line of lines) {
    const m = line.match(/^\s*#\s*(\w+)\s*(.*)$/);
    if (!m) { out.push(isActive() ? line : ''); continue; }
    const [, dir, rest] = m;
    if (dir === 'ifdef' || dir === 'ifndef') {
      const has = rest.trim().split(/\s/)[0] in defs;
      const v = dir === 'ifdef' ? has : !has;
      stack.push({ active: v, taken: v });
    } else if (dir === 'if') {
      const v = isActive() && evalCond(rest);
      stack.push({ active: v, taken: v });
    } else if (dir === 'elif') {
      const top = stack[stack.length - 1];
      const v = !top.taken && evalCond(rest);
      top.active = v; top.taken = top.taken || v;
    } else if (dir === 'else') {
      const top = stack[stack.length - 1];
      top.active = !top.taken; top.taken = true;
    } else if (dir === 'endif') {
      stack.pop();
    } else if (dir === 'define' && isActive()) {
      const dm = rest.match(/^(\w+)(?:\s+(.*))?$/);
      if (dm) defs[dm[1]] = dm[2] === undefined ? 1 : dm[2];
      out.push(line);
      continue;
    }
    out.push('');
  }
  return out.join('\n');
}

const ppCache = new Map();
const src = (rel) => { if (!ppCache.has(rel)) ppCache.set(rel, preprocess(rd(rel))); return ppCache.get(rel); };

// Find matching close bracket starting at index of an open bracket.
function matchBrace(s, open) {
  const pairs = { '{': '}', '(': ')', '[': ']' };
  const stack = [];
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") { const q = c; i++; while (i < s.length && s[i] !== q) { if (s[i] === '\\') i++; i++; } continue; }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === '}' || c === ')' || c === ']') { if (stack.pop() !== c) throw new Error('brace mismatch at ' + i); if (!stack.length) return i; }
  }
  throw new Error('unterminated brace');
}

// Split on top-level commas.
function splitTop(s) {
  const parts = []; let depth = 0, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") { const q = c; let j = i + 1; while (j < s.length && s[j] !== q) { if (s[j] === '\\') j++; j++; } cur += s.slice(i, j + 1); i = j; continue; }
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// Body (between braces) of an array/struct initialiser `name[...] = { ... }`.
function arrayBody(text, name) {
  const re = new RegExp(`\\b${name}\\s*(\\[[^\\]]*\\]\\s*)*=\\s*\\{`);
  const m = re.exec(text);
  if (!m) throw new Error(`array ${name} not found`);
  const open = m.index + m[0].length - 1;
  return text.slice(open + 1, matchBrace(text, open));
}

// Parse an initialiser list into [{key, value}] where key is from `[KEY] =` / `.field =` or null.
function parseInit(body) {
  return splitTop(body).map((part) => {
    let m = part.match(/^\[([^\]]+)\]\s*=\s*([\s\S]*)$/);
    if (m) return { key: m[1].trim(), value: m[2].trim() };
    m = part.match(/^\.(\w+)\s*=\s*([\s\S]*)$/);
    if (m) return { key: m[1], value: m[2].trim(), field: true };
    return { key: null, value: part };
  });
}
const unbrace = (v) => { v = v.trim(); return v.startsWith('{') && v.endsWith('}') ? v.slice(1, -1) : v; };
function parseStruct(v) {
  const o = {};
  for (const e of parseInit(unbrace(v))) if (e.key) o[e.key] = e.value;
  return o;
}

// Text: _("..." "...") -> plain string; \n \l \p -> space.
function cleanText(t) {
  return t.replace(/\\[nlp]/g, ' ').replace(/\{PKMN\}/g, 'PKMN').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    .replace(/\s+/g, ' ').trim();
}
function parseText(v) {
  const lits = [...v.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  return cleanText(lits.join(''));
}
// All `const u8 sym[] = _("...");` strings in a file.
function textSymbols(text) {
  const map = {};
  for (const m of text.matchAll(/\bu8\s+(\w+)\s*\[[^\]]*\]\s*=\s*_\(((?:\s*"(?:[^"\\]|\\.)*")*)\s*\)/g)) map[m[1]] = parseText(m[2]);
  return map;
}

// ---------------------------------------------------------------------------
// Constants (#define + enum) with expression evaluation
// ---------------------------------------------------------------------------
const C = { raw: {}, cache: {}, order: {} };
function loadConstants(rel) {
  const text = src(rel);
  const order = [];
  for (const m of text.matchAll(/^[ \t]*#[ \t]*define[ \t]+(\w+)(?![\w(])[ \t]+(.+)$/gm)) {
    if (!(m[1] in C.raw)) C.raw[m[1]] = m[2].trim();
    order.push(m[1]);
  }
  for (const m of text.matchAll(/\benum\s*\w*\s*\{([^}]*)\}/g)) {
    let next = 0;
    for (const part of splitTop(m[1])) {
      const em = part.match(/^(\w+)(?:\s*=\s*(.+))?$/);
      if (!em) continue;
      if (em[2] !== undefined) next = evalExpr(em[2]);
      C.raw[em[1]] = String(next); C.cache[em[1]] = next; order.push(em[1]);
      next++;
    }
  }
  C.order[rel] = order;
}
const HELPERS = {
  min: Math.min, max: Math.max,
  PERCENT_FEMALE: (p) => Math.trunc(Math.min(254, (p * 255) / 100)),
};
function constVal(name, seen = new Set()) {
  if (name in C.cache) return C.cache[name];
  if (!(name in C.raw)) throw new Error(`unknown constant ${name}`);
  if (seen.has(name)) throw new Error(`recursive constant ${name}`);
  seen.add(name);
  const v = evalExpr(C.raw[name], seen);
  C.cache[name] = v;
  return v;
}
function evalExpr(expr, seen = new Set()) {
  const e = String(expr).replace(/\b(\d+)[uUlL]+\b/g, '$1').replace(/\(u\d+\)|\(s\d+\)/g, '')
    .replace(/\b0[xX][0-9a-fA-F]+\b|\b\d+(?:\.\d+)?\b|[A-Za-z_]\w*/g, (id) => (/^\d/.test(id) ? id : id in HELPERS ? `H.${id}` : String(constVal(id, new Set(seen)))));
  const v = Function('H', `return (${e});`)(HELPERS);
  if (typeof v !== 'number' || Number.isNaN(v)) throw new Error(`bad expr ${expr}`);
  return v;
}
const tryVal = (name) => { try { return constVal(name); } catch { return null; } };
const namesWithPrefix = (rel, prefix, exclude = []) =>
  C.order[rel].filter((n) => n.startsWith(prefix) && !exclude.includes(n));

// Parse a C `switch (...) { case A: case B: return X; / x = X; break; default: ... }` into a case->value map.
function parseSwitch(text, switchRe) {
  const m = switchRe.exec(text);
  if (!m) throw new Error(`switch ${switchRe} not found`);
  const open = text.indexOf('{', m.index + m[0].length);
  const body = text.slice(open + 1, matchBrace(text, open));
  const cases = {}; let pending = []; let def = null;
  for (const tok of body.matchAll(/case\s+(\w+)\s*:|default\s*:|(?:return|\w+\s*=)\s*(\w+)\s*;/g)) {
    if (tok[1]) pending.push(tok[1]);
    else if (tok[0].startsWith('default')) pending.push('__default');
    else if (pending.length) {
      for (const p of pending) { if (p === '__default') def = tok[2]; else cases[p] = tok[2]; }
      pending = [];
    }
  }
  return { cases, default: def };
}

// ---------------------------------------------------------------------------
// Graphics path resolution (INCBIN symbol -> source png/pal on disk)
// ---------------------------------------------------------------------------
function incbinMap(rel) {
  const map = {};
  for (const m of src(rel).matchAll(/\b(\w+)\s*\[\]\s*=\s*INCBIN_U(?:8|16|32)\(\s*"([^"]+)"/g)) map[m[1]] = m[2];
  return map;
}
let mkRules = null;
function loadMkRules() {
  mkRules = {};
  const vars = {};
  const text = rd('graphics_file_rules.mk').replace(/\\\n/g, ' ');
  const expand = (s) => s.replace(/\$\((\w+)\)/g, (_, v) => vars[v] ?? '');
  for (const line of text.split('\n')) {
    let m = line.match(/^(\w+)\s*:=\s*(.*)$/);
    if (m) { vars[m[1]] = expand(m[2].trim()); continue; }
    m = line.match(/^([^\s:#][^:=]*):\s*([^=].*)?$/);
    if (m && !line.startsWith('\t')) {
      const deps = expand(m[2] || '').trim().split(/\s+/).filter(Boolean);
      for (const t of expand(m[1]).trim().split(/\s+/)) if (deps.length) mkRules[t] = deps;
    }
  }
}
// Map a build artefact path (e.g. graphics/x/front.4bpp.lz) to its committed source file.
function resolveSource(built, depth = 0) {
  if (!mkRules) loadMkRules();
  const base = built.replace(/\.lz$/, '').replace(/\.rl$/, '');
  const cands = [];
  if (/\.(4bpp|8bpp|1bpp)$/.test(base)) cands.push(base.replace(/\.(4bpp|8bpp|1bpp)$/, '.png'));
  if (/\.gbapal$/.test(base)) cands.push(base.replace(/\.gbapal$/, '.pal'), base.replace(/\.gbapal$/, '.png'));
  for (const c of cands) if (exists(c)) return c;
  const rule = mkRules[base] || mkRules[built];
  if (rule && depth < 4) return resolveSource(rule[0], depth + 1);
  return null;
}

// ---------------------------------------------------------------------------
// Load constants
// ---------------------------------------------------------------------------
const CONST_FILES = [
  'include/constants/global.h', 'include/constants/species.h', 'include/constants/pokedex.h',
  'include/constants/moves.h', 'include/constants/items.h', 'include/constants/abilities.h',
  'include/constants/pokemon.h', 'include/constants/battle_move_effects.h', 'include/constants/hold_effects.h',
  'include/constants/trainers.h', 'include/constants/opponents.h', 'include/constants/hoenn_cries.h',
  'include/constants/battle.h', 'include/constants/battle_ai.h', 'include/battle_main.h',
];
for (const f of CONST_FILES) if (exists(f)) loadConstants(f); else warn(`missing constants file ${f}`);
// Move-target / move-flag constants may live in battle.h or pokemon.h; tolerate either.

// ---------------------------------------------------------------------------
// Shared lookups
// ---------------------------------------------------------------------------
const speciesNames = (() => {
  const o = {};
  for (const e of parseInit(arrayBody(src('src/data/text/species_names.h'), 'gSpeciesNames'))) o[strip(e.key, 'SPECIES_')] = parseText(e.value);
  return o;
})();
const moveNames = (() => {
  const o = {};
  for (const e of parseInit(arrayBody(src('src/data/text/move_names.h'), 'gMoveNames'))) o[strip(e.key, 'MOVE_')] = parseText(e.value);
  return o;
})();
const tmhmMoves = splitTop(arrayBody(src('src/data/party_menu.h'), 'sTMHMMoves')).map((m) => strip(m, 'MOVE_'));
const itemsJson = JSON.parse(rd('src/data/items.json')).items;
const itemKeyByValue = {};
for (const it of itemsJson) { const v = tryVal(it.itemId); if (v !== null && !(v in itemKeyByValue)) itemKeyByValue[v] = strip(it.itemId, 'ITEM_'); }
const itemKey = (constName) => { const v = tryVal(constName); return v !== null && itemKeyByValue[v] ? itemKeyByValue[v] : strip(constName, 'ITEM_'); };

// ---------------------------------------------------------------------------
// species.json
// ---------------------------------------------------------------------------
function buildSpecies() {
  const SPH = 'include/constants/species.h';
  const realSpecies = namesWithPrefix(SPH, 'SPECIES_').filter((n) => {
    const v = constVal(n);
    return v > 0 && v < constVal('SPECIES_EGG') && !n.startsWith('SPECIES_OLD_UNOWN_');
  });

  const info = {};
  for (const e of parseInit(arrayBody(src('src/data/pokemon/species_info.h'), 'gSpeciesInfo'))) info[e.key] = e.value;

  // national dex
  const natBody = arrayBody(src('src/pokemon.c'), 'sSpeciesToNationalPokedexNum');
  const natOf = {};
  for (const m of natBody.matchAll(/SPECIES_TO_NATIONAL\((\w+)\)/g)) natOf[m[1]] = constVal('NATIONAL_DEX_' + m[1]);

  // pokedex entries (by national dex constant)
  const dexText = textSymbols(src('src/data/pokemon/pokedex_text_fr.h'));
  const dexEntries = {};
  for (const e of parseInit(arrayBody(src('src/data/pokemon/pokedex_entries.h'), 'gPokedexEntries'))) {
    const s = parseStruct(e.value);
    dexEntries[constVal(e.key)] = {
      category: parseText(s.categoryName), height: evalExpr(s.height), weight: evalExpr(s.weight),
      dexText: dexText[s.description] ?? null,
    };
  }

  // evolutions
  const evos = {};
  for (const e of parseInit(arrayBody(src('src/data/pokemon/evolution.h'), 'gEvolutionTable'))) {
    evos[strip(e.key, 'SPECIES_')] = splitTop(unbrace(e.value)).map((x) => {
      const [method, param, target] = splitTop(unbrace(x));
      let p;
      if (/^ITEM_/.test(param)) p = itemKey(param);
      else p = evalExpr(param);
      const meth = strip(method, 'EVO_');
      if (p === 0 && /^(TRADE|FRIENDSHIP|FRIENDSHIP_DAY|FRIENDSHIP_NIGHT)$/.test(meth)) p = null;
      return { method: meth, param: p, into: strip(target, 'SPECIES_') };
    });
  }
  const preEvo = {};
  for (const [from, list] of Object.entries(evos)) for (const ev of list) if (!(ev.into in preEvo)) preEvo[ev.into] = from;

  // level-up learnsets
  const lsText = src('src/data/pokemon/level_up_learnsets.h');
  const lsArrays = {};
  for (const m of lsText.matchAll(/\bu16\s+(\w+)\s*\[\]\s*=\s*\{([^}]*)\}/g)) {
    lsArrays[m[1]] = [...m[2].matchAll(/LEVEL_UP_MOVE\(\s*(\d+)\s*,\s*(\w+)\s*\)/g)].map((x) => [Number(x[1]), strip(x[2], 'MOVE_')]);
  }
  const lsPtr = {};
  for (const e of parseInit(arrayBody(src('src/data/pokemon/level_up_learnset_pointers.h'), 'gLevelUpLearnsets'))) lsPtr[strip(e.key, 'SPECIES_')] = e.value.trim();

  // TM/HM
  const tmBase = constVal('ITEM_TM01');
  const tmhm = {};
  for (const e of parseInit(arrayBody(src('src/data/pokemon/tmhm_learnsets.h'), 'sTMHMLearnsets'))) {
    const labels = [...e.value.matchAll(/TMHM\((\w+)\)/g)].map((m) => m[1]);
    tmhm[strip(e.key, 'SPECIES_')] = labels.map((l) => {
      const idx = constVal('ITEM_' + l) - tmBase;
      return { move: tmhmMoves[idx], item: itemKeyByValue[tmBase + idx] };
    });
  }
  // tutor
  const tutText = src('src/data/pokemon/tutor_learnsets.h');
  const tutor = {};
  for (const e of parseInit(arrayBody(tutText, 'sTutorLearnsets'))) tutor[strip(e.key, 'SPECIES_')] = [...e.value.matchAll(/TUTOR\((\w+)\)/g)].map((m) => strip(m[1], 'MOVE_'));
  // egg moves
  const eggText = arrayBody(src('src/data/pokemon/egg_moves.h'), 'gEggMoves');
  const egg = {};
  for (const m of eggText.matchAll(/egg_moves\(\s*(\w+)\s*,([^)]*)\)/g)) egg[m[1]] = splitTop(m[2]).map((x) => strip(x, 'MOVE_'));

  // graphics
  const gfxSyms = incbinMap('src/data/graphics/pokemon.h');
  const spriteTable = (rel, macro) => {
    const o = {};
    for (const m of src(rel).matchAll(new RegExp(`${macro}\\(\\s*(\\w+)\\s*,\\s*(\\w+)`, 'g'))) o[m[1]] = m[2];
    return o;
  };
  const keyedTable = (rel, name) => {
    const o = {};
    for (const e of parseInit(arrayBody(src(rel), name))) o[strip(e.key, 'SPECIES_')] = e.value.trim();
    return o;
  };
  const frontT = spriteTable('src/data/pokemon_graphics/front_pic_table.h', 'SPECIES_SPRITE');
  const backT = spriteTable('src/data/pokemon_graphics/back_pic_table.h', 'SPECIES_SPRITE');
  const palT = spriteTable('src/data/pokemon_graphics/palette_table.h', 'SPECIES_PAL');
  const shinyT = spriteTable('src/data/pokemon_graphics/shiny_palette_table.h', 'SPECIES_SHINY_PAL');
  const iconT = keyedTable('src/pokemon_icon.c', 'gMonIconTable');
  const iconPalT = keyedTable('src/pokemon_icon.c', 'gMonIconPaletteIndices');
  const footT = keyedTable('src/data/pokemon_graphics/footprint_table.h', 'gMonFootprintTable');
  const gfxFile = (sym, who) => {
    if (!sym) return null;
    const built = gfxSyms[sym];
    if (!built) { warn(`${who}: no incbin for ${sym}`); return null; }
    const s = resolveSource(built);
    if (!s) { warn(`${who}: cannot resolve source for ${built}`); return null; }
    return s.replace(/^graphics\/pokemon\//, '');
  };

  // cries
  const cryHoenn = {};
  for (const m of src('src/data/pokemon/cry_ids.h').matchAll(/\[\s*SPECIES_(\w+)\s*-\s*HOENN_MON_SPECIES_START\s*\]\s*=\s*(\w+)/g)) cryHoenn[m[1]] = constVal(m[2]);
  const cryTable = [...rd('sound/cry_tables.inc').split('gCryTable_Reverse::')[0].matchAll(/^\s*cry\s+(\w+)/gm)].map((m) => m[1]);
  const crySamples = {};
  for (const m of rd('sound/direct_sound_data.inc').matchAll(/^(\w+)::\s*\n\s*\.incbin\s+"([^"]+)"/gm)) crySamples[m[1]] = m[2];
  const firstHoenn = constVal('SPECIES_OLD_UNOWN_B');

  const out = {};
  for (const full of realSpecies) {
    const key = strip(full, 'SPECIES_');
    const id = constVal(full);
    const s = parseStruct(info[full]);
    const types = [...new Set(splitTop(unbrace(s.types)).map((t) => strip(t, 'TYPE_')))];
    const abilities = splitTop(unbrace(s.abilities)).map((a) => strip(a, 'ABILITY_')).filter((a) => a !== 'NONE');
    const eggGroups = [...new Set(splitTop(unbrace(s.eggGroups)).map((g) => strip(g, 'EGG_GROUP_')))];
    const dex = natOf[key];
    const de = dexEntries[dex] || {};
    const front = gfxFile(frontT[key], key);
    const cryId = id < firstHoenn ? id - 1 : cryHoenn[key];
    const cryLabel = cryTable[cryId];
    const cryFile = cryLabel && crySamples[cryLabel] ? path.basename(crySamples[cryLabel]).replace(/\.\w+$/, '') : null;
    const tm = tmhm[key] || [];
    out[key] = {
      id, dex, name: speciesNames[key], types,
      stats: {
        hp: evalExpr(s.baseHP), atk: evalExpr(s.baseAttack), def: evalExpr(s.baseDefense),
        spa: evalExpr(s.baseSpAttack), spd: evalExpr(s.baseSpDefense), spe: evalExpr(s.baseSpeed),
      },
      evYield: {
        hp: evalExpr(s.evYield_HP), atk: evalExpr(s.evYield_Attack), def: evalExpr(s.evYield_Defense),
        spa: evalExpr(s.evYield_SpAttack), spd: evalExpr(s.evYield_SpDefense), spe: evalExpr(s.evYield_Speed),
      },
      catchRate: evalExpr(s.catchRate), expYield: evalExpr(s.expYield),
      growthRate: strip(s.growthRate, 'GROWTH_'), abilities,
      genderRatio: evalExpr(s.genderRatio), eggGroups, eggCycles: evalExpr(s.eggCycles), friendship: evalExpr(s.friendship),
      wildItems: { common: s.itemCommon && s.itemCommon !== "ITEM_NONE" ? itemKey(s.itemCommon) : null, rare: s.itemRare && s.itemRare !== "ITEM_NONE" ? itemKey(s.itemRare) : null },
      safariZoneFleeRate: evalExpr(s.safariZoneFleeRate), bodyColor: strip(s.bodyColor || '', 'BODY_COLOR_'),
      evolutions: evos[key] || [], preEvolution: preEvo[key] ?? null,
      learnset: lsArrays[lsPtr[key]] || [],
      tmhm: tm.map((t) => t.move), tmhmItems: tm.map((t) => t.item),
      tutor: tutor[key] || [], eggMoves: egg[key] || [],
      category: de.category ?? null, dexText: de.dexText ?? null, height: de.height ?? null, weight: de.weight ?? null,
      gfx: front ? path.posix.dirname(front) : null,
      sprites: {
        front, back: gfxFile(backT[key], key), icon: gfxFile(iconT[key], key),
        pal: gfxFile(palT[key], key), shinyPal: gfxFile(shinyT[key], key), footprint: gfxFile(footT[key], key),
        iconPal: iconPalT[key] !== undefined ? Number(iconPalT[key]) : null,
        // Which 64x64 frame of front/back.png the game shows. Deoxys' sheets stack Normal over this
        // version's forme, and DuplicateDeoxysTiles (decompress.c) copies frame 1 over frame 0.
        frame: key === 'DEOXYS' && /DuplicateDeoxysTiles[\s\S]*?pointer\s*\+\s*0x800\s*,\s*pointer/.test(src('src/decompress.c')) ? 1 : 0,
      },
      cryId: cryId ?? null, cry: cryFile,
    };
    if (!lsArrays[lsPtr[key]]) warn(`${key}: no level-up learnset`);
    if (!dex) warn(`${key}: no national dex number`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// moves.json
// ---------------------------------------------------------------------------
function buildMoves() {
  const descSyms = textSymbols(src('src/move_descriptions.c'));
  const descPtr = {};
  for (const e of parseInit(arrayBody(src('src/move_descriptions.c'), 'gMoveDescriptionPointers'))) {
    descPtr[e.key.replace(/\s*-\s*1\s*$/, '').trim()] = e.value.trim();
  }
  const out = {};
  for (const e of parseInit(arrayBody(src('src/data/battle_moves.h'), 'gBattleMoves'))) {
    if (e.key === 'MOVE_NONE') continue;
    const s = parseStruct(e.value);
    const key = strip(e.key, 'MOVE_');
    const flags = s.flags && s.flags !== '0' ? s.flags.split('|').map((f) => strip(f.trim(), 'FLAG_')) : [];
    out[key] = {
      id: constVal(e.key), name: moveNames[key], effect: strip(s.effect, 'EFFECT_'), power: evalExpr(s.power),
      type: strip(s.type, 'TYPE_'), accuracy: evalExpr(s.accuracy), pp: evalExpr(s.pp),
      chance: evalExpr(s.secondaryEffectChance), target: strip(s.target, 'MOVE_TARGET_'), priority: evalExpr(s.priority),
      flags, desc: descSyms[descPtr[e.key]] ?? null,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// types.json
// ---------------------------------------------------------------------------
function buildTypes() {
  const PH = 'include/constants/pokemon.h';
  const list = namesWithPrefix(PH, 'TYPE_').filter((n) => {
    const v = constVal(n);
    return n !== 'TYPE_NONE' && n !== 'TYPE_MYSTERY' && v >= 0 && v < constVal('NUMBER_OF_MON_TYPES');
  }).sort((a, b) => constVal(a) - constVal(b)).map((n) => strip(n, 'TYPE_'));
  const names = {};
  for (const e of parseInit(arrayBody(src('src/battle_main.c'), 'gTypeNames'))) names[strip(e.key, 'TYPE_')] = parseText(e.value);
  const vals = splitTop(arrayBody(src('src/battle_main.c'), 'gTypeEffectiveness'));
  const chart = {}; const foresight = [];
  let afterForesight = false;
  for (let i = 0; i + 2 < vals.length; i += 3) {
    const [a, d, m] = vals.slice(i, i + 3);
    if (a === 'TYPE_ENDTABLE') break;
    if (a === 'TYPE_FORESIGHT') { afterForesight = true; continue; }
    const atk = strip(a, 'TYPE_'), def = strip(d, 'TYPE_');
    const mult = evalExpr(m) / 10;
    (chart[atk] ||= {})[def] = mult;
    if (afterForesight) foresight.push([atk, def]);
  }
  return { list, names: Object.fromEntries(list.map((t) => [t, names[t]])), chart, foresightIgnored: foresight };
}

// ---------------------------------------------------------------------------
// items.json
// ---------------------------------------------------------------------------
function buildItems() {
  const iconSyms = incbinMap('src/data/graphics/items.h');
  const iconTable = {};
  for (const e of parseInit(arrayBody(src('src/data/item_icon_table.h'), 'sItemIconTable'))) {
    const [ic, pal] = splitTop(unbrace(e.value));
    iconTable[constVal(e.key)] = { ic, pal };
  }
  const resolveIcon = (sym, kind) => {
    const built = iconSyms[sym];
    if (!built) { warn(`item icon symbol ${sym} has no incbin`); return null; }
    const s = resolveSource(built);
    if (!s) { warn(`item ${kind} ${built} has no source`); return null; }
    return path.posix.basename(s).replace(/\.\w+$/, '');
  };
  const tmBase = constVal('ITEM_TM01');
  const out = {};
  for (const it of itemsJson) {
    if (it.english === '????????') continue;
    const id = constVal(it.itemId);
    const key = strip(it.itemId, 'ITEM_');
    const ic = iconTable[id];
    const o = {
      id, name: cleanText(it.english), price: it.price, desc: cleanText(it.description_english || ''),
      pocket: strip(it.pocket, 'POCKET_'), holdEffect: strip(it.holdEffect, 'HOLD_EFFECT_'), holdEffectParam: it.holdEffectParam,
      importance: it.importance, type: typeof it.type === 'string' ? strip(it.type, 'ITEM_TYPE_') : it.type,
      battleUsage: it.battleUsage, secondaryId: it.secondaryId,
      icon: ic ? resolveIcon(ic.ic, 'icon') : null, iconPal: ic ? resolveIcon(ic.pal, 'palette') : null,
    };
    if (it.pocket === 'POCKET_TM_CASE' && id >= tmBase) o.move = tmhmMoves[id - tmBase] ?? null;
    if (!ic) warn(`item ${key} has no icon table entry`);
    out[key] = o;
  }
  return out;
}

// ---------------------------------------------------------------------------
// maps.json
// ---------------------------------------------------------------------------
function buildMaps() {
  const secNames = {};
  for (const s of JSON.parse(rd('src/data/region_map/region_map_sections.json')).map_sections) if (s.id) secNames[s.id] = s.name ?? null;
  const groups = JSON.parse(rd('data/maps/map_groups.json'));
  const groupOf = {};
  groups.group_order.forEach((g, gi) => (groups[g] || []).forEach((folder, ni) => { groupOf[folder] = { group: gi, num: ni }; }));
  const out = {}; const folderToId = {};
  for (const folder of fs.readdirSync(path.join(PF, 'data/maps')).sort()) {
    const f = `data/maps/${folder}/map.json`;
    if (!exists(f)) continue;
    const j = JSON.parse(rd(f));
    folderToId[folder] = j.id;
    out[j.id] = {
      name: secNames[j.region_map_section] ?? null, folder, regionMapSection: strip(j.region_map_section || '', 'MAPSEC_'),
      music: j.music, mapType: strip(j.map_type || '', 'MAP_TYPE_'), battleScene: strip(j.battle_scene || '', 'MAP_BATTLE_SCENE_'),
      weather: strip(j.weather || '', 'WEATHER_'), layout: j.layout, floor: j.floor_number ?? 0,
      group: groupOf[folder]?.group ?? null, num: groupOf[folder]?.num ?? null,
      connections: (j.connections || []).map((c) => ({ direction: c.direction, offset: c.offset, map: c.map })),
    };
  }
  return { maps: out, folderToId };
}

// ---------------------------------------------------------------------------
// trainers.json + trainer_classes.json
// ---------------------------------------------------------------------------
function buildTrainers(folderToId) {
  // class names + money
  const classNames = {};
  for (const e of parseInit(arrayBody(src('src/data/text/trainer_class_names.h'), 'gTrainerClassNames'))) classNames[strip(e.key, 'TRAINER_CLASS_')] = parseText(e.value);
  const money = {}; let moneyDefault = 5;
  for (const v of splitTop(arrayBody(src('src/battle_main.c'), 'gTrainerMoneyTable'))) {
    const [cls, val] = splitTop(unbrace(v));
    if (/^0x?ff$/i.test(cls) || cls === '0xFF') moneyDefault = evalExpr(val);
    else money[strip(cls, 'TRAINER_CLASS_')] = evalExpr(val);
  }
  // Songs: battle BGM by trainer class (GetBattleBGM in pokemon.c), encounter jingle by encounter-music id
  // (PlayTrainerEncounterMusic in battle_setup.c).
  const battleBgm = parseSwitch(src('src/pokemon.c'), /switch\s*\(\s*gTrainers\[gTrainerBattleOpponent_A\]\.trainerClass\s*\)/);
  const encBgm = parseSwitch(src('src/battle_setup.c'), /switch\s*\(\s*GetTrainerEncounterMusicId\(/);
  const classes = {};
  for (const n of namesWithPrefix('include/constants/trainers.h', 'TRAINER_CLASS_')) {
    const k = strip(n, 'TRAINER_CLASS_');
    if (!(k in classNames) && !(k in money)) continue;
    classes[k] = {
      id: constVal(n), name: classNames[k] ?? null, money: money[k] ?? moneyDefault, moneyListed: k in money,
      battleSong: battleBgm.cases[n] ?? battleBgm.default,
    };
  }

  // pics
  const picSyms = incbinMap('src/data/graphics/trainers.h');
  const picFront = {}; const picPal = {};
  const fpt = src('src/data/trainer_graphics/front_pic_tables.h');
  for (const m of fpt.matchAll(/TRAINER_SPRITE\(\s*(\w+)\s*,\s*(\w+)/g)) picFront[m[1]] = m[2];
  for (const m of fpt.matchAll(/TRAINER_PAL\(\s*(\w+)\s*,\s*(\w+)/g)) picPal[m[1]] = m[2];
  const picFile = (sym) => { const b = picSyms[sym]; const s = b && resolveSource(b); return s ? path.posix.basename(s).replace(/\.\w+$/, '') : null; };

  // parties
  const ptRaw = src('src/data/trainer_parties.h');
  const macros = {};
  for (const m of ptRaw.matchAll(/^[ \t]*#[ \t]*define[ \t]+(\w+)[ \t]+(\{.*\})[ \t]*$/gm)) macros[m[1]] = m[2];
  const parties = {};
  for (const m of ptRaw.matchAll(/\bstruct\s+(\w+)\s+(\w+)\s*\[\]\s*=\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const body = ptRaw.slice(open + 1, matchBrace(ptRaw, open));
    const elems = splitTop(body);
    const dummy = elems.length > 0 && elems.every((x) => /^DUMMY_\w+$/.test(x.trim()));
    const mons = elems.map((x) => {
      const t = x.trim();
      const s = parseStruct(macros[t] ?? t);
      const moves = s.moves ? splitTop(unbrace(s.moves)).map((mv) => strip(mv, 'MOVE_')) : null;
      return {
        species: strip(s.species, 'SPECIES_'), level: evalExpr(s.lvl), iv: s.iv ? evalExpr(s.iv) : 0,
        moves: moves ? moves.filter((mv) => mv !== 'NONE') : null,
        item: s.heldItem && s.heldItem !== 'ITEM_NONE' ? itemKey(s.heldItem) : null,
      };
    });
    parties[m[2]] = { mons, dummy, struct: m[1] };
  }

  // maps referencing each trainer
  // Route trainers' scripts live in shared data/scripts/trainers.inc, so a trainerbattle line is attributed
  // to (a) the map folder whose scripts file contains it, (b) maps whose object_events use the enclosing
  // script label, and (c) the map folder named by the label prefix (e.g. Route3_EventScript_Ben -> Route3).
  const trMaps = {};
  const addMap = (tr, mapId) => (trMaps[tr] ||= new Set()).add(mapId);
  const labelUsers = {};
  for (const folder of Object.keys(folderToId)) {
    const j = JSON.parse(rd(`data/maps/${folder}/map.json`));
    for (const ev of [...(j.object_events || []), ...(j.coord_events || []), ...(j.bg_events || [])]) {
      if (ev.script) (labelUsers[ev.script] ||= new Set()).add(j.id);
    }
  }
  const scanScript = (text, homeMap) => {
    let label = null;
    for (const line of text.split(/\r?\n/)) {
      const lm = line.match(/^(\w+)::?/);
      if (lm) { label = lm[1]; continue; }
      if (!/^\s*trainerbattle/.test(line)) continue;
      const targets = new Set();
      if (homeMap) targets.add(homeMap);
      if (label) {
        for (const u of labelUsers[label] || []) targets.add(u);
        const prefix = label.split('_EventScript')[0];
        if (folderToId[prefix]) targets.add(folderToId[prefix]);
      }
      for (const t of line.matchAll(/\bTRAINER_(\w+)/g)) for (const m of targets) addMap(t[1], m);
    }
  };
  for (const folder of fs.readdirSync(path.join(PF, 'data/maps'))) {
    const dir = path.join(PF, 'data/maps', folder);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir)) {
      if (/\.(inc|pory)$/.test(file)) scanScript(fs.readFileSync(path.join(dir, file), 'utf8'), folderToId[folder] || null);
    }
  }
  for (const file of fs.readdirSync(path.join(PF, 'data/scripts'))) {
    if (/\.(inc|pory)$/.test(file)) scanScript(rd(`data/scripts/${file}`), null);
  }
  // VS Seeker rematch table: { {base, tier2, SKIP, tier3, ...}, MAP(MAP_X) }
  const rematchOf = {};
  for (const m of src('src/vs_seeker.c').matchAll(/\{\s*\{([^{}]*)\}\s*,\s*MAP\(\s*(\w+)\s*\)\s*\}/g)) {
    const list = splitTop(m[1]).filter((x) => x.startsWith('TRAINER_')).map((x) => strip(x, 'TRAINER_'));
    for (const t of list) { addMap(t, m[2]); if (t !== list[0] && !(t in rematchOf)) rematchOf[t] = list[0]; }
  }

  const out = {};
  for (const e of parseInit(arrayBody(src('src/data/trainers.h'), 'gTrainers'))) {
    if (e.key === 'TRAINER_NONE') continue;
    const s = parseStruct(e.value);
    const key = strip(e.key, 'TRAINER_');
    const pm = (s.party || '').match(/^(\w+)\(\s*(\w+)\s*\)/);
    const party = pm ? parties[pm[2]] : null;
    if (!party) warn(`trainer ${key}: party not found (${s.party})`);
    const mg = (s.encounterMusic_gender || '').split('|').map((x) => x.trim());
    const musicTok = mg.find((x) => x.startsWith('TRAINER_ENCOUNTER_MUSIC_'));
    const cls = strip(s.trainerClass || '', 'TRAINER_CLASS_');
    const pic = strip(s.trainerPic || '', 'TRAINER_PIC_');
    const items = s.items ? splitTop(unbrace(s.items)).filter((x) => x && x !== 'ITEM_NONE').map(itemKey) : [];
    out[key] = {
      id: constVal(e.key), class: cls, className: classNames[cls] ?? null, name: parseText(s.trainerName || '""'),
      pic: (picFile(picFront[pic]) || '').replace(/_front_pic$/, '') || null, picPal: picFile(picPal[pic]),
      trainerPic: pic,
      music: musicTok ? strip(musicTok, 'TRAINER_ENCOUNTER_MUSIC_') : 'MALE', female: mg.includes('F_TRAINER_FEMALE'),
      encounterSong: encBgm.cases[musicTok || 'TRAINER_ENCOUNTER_MUSIC_MALE'] ?? encBgm.default,
      battleSong: classes[cls]?.battleSong ?? battleBgm.default,
      double: s.doubleBattle === 'TRUE', items,
      aiFlags: s.aiFlags && s.aiFlags !== '0' ? s.aiFlags.split('|').map((x) => strip(x.trim(), 'AI_SCRIPT_')) : [],
      party: party ? party.mons : [], dummy: party ? party.dummy : true,
      maps: [...(trMaps[key] || [])].sort(), rematchOf: rematchOf[key] ?? null,
    };
  }
  return { trainers: out, classes };
}

// ---------------------------------------------------------------------------
// encounters.json
// ---------------------------------------------------------------------------
function buildEncounters(maps) {
  const j = JSON.parse(rd('src/data/wild_encounters.json'));
  const group = j.wild_encounter_groups.find((g) => g.label === 'gWildMonHeaders') || j.wild_encounter_groups[0];
  const fields = Object.fromEntries(group.fields.map((f) => [f.type, f]));
  const rodOf = (idx) => {
    const g = fields.fishing_mons.groups || {};
    for (const [rod, slots] of Object.entries(g)) if (slots.includes(idx)) return rod.replace(/_rod$/, '');
    return null;
  };
  const slotList = (block, type) => {
    if (!block) return [];
    const rates = fields[type].encounter_rates;
    return block.mons.map((m, i) => {
      const o = { species: strip(m.species, 'SPECIES_'), min: m.min_level, max: m.max_level, rate: rates[i] };
      if (type === 'fishing_mons') o.rod = rodOf(i);
      return o;
    });
  };
  const chosen = {};
  for (const enc of group.encounters) {
    if (/_LeafGreen$/.test(enc.base_label)) continue;
    const isFR = /_FireRed$/.test(enc.base_label);
    if (chosen[enc.map] && !isFR) continue; // prefer explicit FireRed variant
    chosen[enc.map] = enc;
  }
  const out = {};
  for (const [mapId, enc] of Object.entries(chosen)) {
    const name = maps[mapId]?.name ?? mapId.replace(/^MAP_/, '').replace(/_/g, ' ');
    out[mapId] = {
      name,
      rates: {
        land: enc.land_mons?.encounter_rate ?? 0, water: enc.water_mons?.encounter_rate ?? 0,
        rock: enc.rock_smash_mons?.encounter_rate ?? 0, fishing: enc.fishing_mons?.encounter_rate ?? 0,
      },
      land: slotList(enc.land_mons, 'land_mons'), water: slotList(enc.water_mons, 'water_mons'),
      rock: slotList(enc.rock_smash_mons, 'rock_smash_mons'), fishing: slotList(enc.fishing_mons, 'fishing_mons'),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// abilities.json
// ---------------------------------------------------------------------------
function buildAbilities() {
  const t = src('src/data/text/abilities.h');
  const descSyms = textSymbols(t);
  const names = {}; const desc = {};
  for (const e of parseInit(arrayBody(t, 'gAbilityNames'))) names[e.key] = parseText(e.value);
  for (const e of parseInit(arrayBody(t, 'gAbilityDescriptionPointers'))) desc[e.key] = descSyms[e.value.trim()];
  const out = {};
  for (const n of namesWithPrefix('include/constants/abilities.h', 'ABILITY_', ['ABILITY_NONE', 'ABILITIES_COUNT'])) {
    if (!(n in names)) continue;
    out[strip(n, 'ABILITY_')] = { id: constVal(n), name: names[n], desc: desc[n] ?? null };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------
function verify(d) {
  const results = [];
  const check = (label, cond, detail = '') => results.push({ ok: !!cond, label, detail });
  const { species, moves, types, items, trainers, encounters, abilities, maps, classes } = d;
  const N = (o) => Object.keys(o).length;

  check('386 species', N(species) === 386, N(species));
  check('354 moves', N(moves) === 354, N(moves));
  check('17 types', types.list.length === 17, types.list.length);
  check('77 abilities', N(abilities) === 77, N(abilities));
  const b = species.BULBASAUR;
  check('Bulbasaur basics', b.id === 1 && b.dex === 1 && b.types.join() === 'GRASS,POISON' && b.stats.hp === 45 && b.stats.spa === 65
    && b.growthRate === 'MEDIUM_SLOW' && b.abilities.join() === 'OVERGROW' && b.genderRatio === 31 && b.category === 'SEED'
    && b.gfx === 'bulbasaur' && b.learnset[0].join() === '1,TACKLE' && b.tmhm.includes('TOXIC') && b.tmhmItems.includes('TM06')
    && b.eggMoves.includes('CHARM') && b.tutor.includes('BODY_SLAM') && b.cryId === 0,
    JSON.stringify({ g: b.genderRatio, gfx: b.gfx, cat: b.category, cry: b.cryId }));
  const cz = species.CHARIZARD;
  check('Charizard FIRE/FLYING, from Charmeleon @36', cz.types.join() === 'FIRE,FLYING' && cz.preEvolution === 'CHARMELEON'
    && species.CHARMELEON.evolutions.some((e) => e.method === 'LEVEL' && e.param === 36 && e.into === 'CHARIZARD'));
  check('Pikachu -> Raichu via THUNDER_STONE', species.PIKACHU.evolutions.some((e) => e.method === 'ITEM' && e.param === 'THUNDER_STONE' && e.into === 'RAICHU'));
  const tr = species.TREECKO;
  check('Treecko id 277 dex 252 gfx treecko cry 273', tr.id === 277 && tr.dex === 252 && tr.gfx === 'treecko' && tr.cryId === 273 && tr.cry === 'treecko',
    JSON.stringify({ id: tr.id, dex: tr.dex, gfx: tr.gfx, cry: tr.cryId, f: tr.cry }));
  check('Deoxys uses FireRed (attack) sprite = frame 1 of deoxys/front.png', species.DEOXYS.sprites.front === 'deoxys/front.png' && species.DEOXYS.sprites.frame === 1, species.DEOXYS.sprites.front);
  check('Deoxys dex 386, Chimecho dex 358', species.DEOXYS.dex === 386 && species.CHIMECHO.dex === 358);
  const dexSet = new Set(Object.values(species).map((s) => s.dex));
  check('national dex 1..386 all covered once', dexSet.size === 386 && [...dexSet].every((x) => x >= 1 && x <= 386));
  const brock = trainers.LEADER_BROCK;
  check('Brock: Geodude 12, Onix 14 w/ Rock Tomb', brock && brock.party.length === 2 && brock.party[0].species === 'GEODUDE' && brock.party[0].level === 12
    && brock.party[1].species === 'ONIX' && brock.party[1].level === 14 && brock.party[1].moves.includes('ROCK_TOMB')
    && brock.pic === 'leader_brock' && brock.maps.includes('MAP_PEWTER_CITY_GYM') && brock.className === 'LEADER' && !brock.dummy,
    JSON.stringify(brock && { pic: brock.pic, maps: brock.maps }));
  check('Misty female', trainers.LEADER_MISTY?.female === true);
  check('songs: Brock VS_GYM_LEADER/ENCOUNTER_BOY, Giovanni ENCOUNTER_ROCKET, Champion VS_CHAMPION',
    brock.battleSong === 'MUS_VS_GYM_LEADER' && brock.encounterSong === 'MUS_ENCOUNTER_BOY'
    && trainers.LEADER_GIOVANNI.encounterSong === 'MUS_ENCOUNTER_ROCKET' && trainers.CHAMPION_FIRST_SQUIRTLE.battleSong === 'MUS_VS_CHAMPION'
    && trainers.YOUNGSTER_BEN.battleSong === 'MUS_VS_TRAINER');
  check('VS Seeker rematch: YOUNGSTER_BEN_3 on Route 3, rematchOf BEN', trainers.YOUNGSTER_BEN_3?.rematchOf === 'YOUNGSTER_BEN' && trainers.YOUNGSTER_BEN_3.maps.includes('MAP_ROUTE3'));
  check('Route 1 Pidgey/Rattata', encounters.MAP_ROUTE1 && encounters.MAP_ROUTE1.land.some((s) => s.species === 'PIDGEY') && encounters.MAP_ROUTE1.land.some((s) => s.species === 'RATTATA'),
    encounters.MAP_ROUTE1 && [...new Set(encounters.MAP_ROUTE1.land.map((s) => s.species))].join(','));
  const fr = [...new Set(Object.values(encounters).flatMap((e) => e.land.map((s) => s.species)))];
  check('FireRed exclusives present (EKANS/GROWLITHE), LG exclusives absent (SANDSHREW/VULPIX in land)',
    fr.includes('EKANS') && fr.includes('GROWLITHE') && !fr.includes('SANDSHREW') && !fr.includes('VULPIX'));
  check('type chart FIRE>GRASS 2, NORMAL>GHOST 0, GHOST in foresight list', types.chart.FIRE.GRASS === 2 && types.chart.NORMAL.GHOST === 0
    && types.chart.ELECTRIC.GROUND === 0 && types.foresightIgnored.length === 2);
  check('Potion item + icon', items.POTION && items.POTION.price === 300 && items.POTION.icon === 'potion' && items.POTION.iconPal === 'potion');
  check('TM06 teaches TOXIC', items.TM06?.move === 'TOXIC');
  check('maps: MAP_ROUTE1 music MUS_ROUTE1, name ROUTE 1', maps.MAP_ROUTE1?.music === 'MUS_ROUTE1' && maps.MAP_ROUTE1?.name === 'ROUTE 1');
  check('trainer class LEADER money 25', classes.LEADER?.money === 25);

  // referential integrity
  const missing = [];
  const fileChecks = [];
  for (const [k, s] of Object.entries(species)) {
    if (!s.gfx || !fs.existsSync(path.join(PF, 'graphics/pokemon', s.gfx))) missing.push(`gfx ${k}:${s.gfx}`);
    for (const f of ['front', 'back', 'icon', 'pal', 'shinyPal', 'footprint']) {
      fileChecks.push(1);
      if (!s.sprites[f] || !fs.existsSync(path.join(PF, 'graphics/pokemon', s.sprites[f]))) missing.push(`sprite ${k}.${f}:${s.sprites[f]}`);
    }
    if (!s.cry || !['.wav', '.aif', '.bin'].some((ext) => fs.existsSync(path.join(PF, 'sound/direct_sound_samples/cries', s.cry + ext)))) missing.push(`cry ${k}:${s.cry}`);
    for (const [, mv] of s.learnset) if (!moves[mv]) missing.push(`learnset move ${k}:${mv}`);
    for (const mv of [...s.tmhm, ...s.tutor, ...s.eggMoves]) if (!moves[mv]) missing.push(`move ${k}:${mv}`);
    for (const a of s.abilities) if (!abilities[a]) missing.push(`ability ${k}:${a}`);
    for (const e of s.evolutions) { if (!species[e.into]) missing.push(`evo ${k}->${e.into}`); if (typeof e.param === 'string' && !items[e.param]) missing.push(`evo item ${e.param}`); }
    for (const t of s.types) if (!types.list.includes(t)) missing.push(`type ${k}:${t}`);
    if (!s.dexText || !s.category) missing.push(`dex text ${k}`);
  }
  for (const [k, it] of Object.entries(items)) {
    if (!it.icon || !fs.existsSync(path.join(PF, 'graphics/items/icons', it.icon + '.png'))) missing.push(`item icon ${k}:${it.icon}`);
    if (!it.iconPal || !fs.existsSync(path.join(PF, 'graphics/items/icon_palettes', it.iconPal + '.pal'))) missing.push(`item pal ${k}:${it.iconPal}`);
  }
  for (const [k, t] of Object.entries(trainers)) {
    if (!t.pic || !fs.existsSync(path.join(PF, 'graphics/trainers/front_pics', t.pic + '_front_pic.png'))) missing.push(`trainer pic ${k}:${t.pic}`);
    if (!t.picPal || !fs.existsSync(path.join(PF, 'graphics/trainers/palettes', t.picPal + '.pal'))) missing.push(`trainer pal ${k}:${t.picPal}`);
    for (const m of t.party) {
      if (!species[m.species]) missing.push(`trainer mon ${k}:${m.species}`);
      for (const mv of m.moves || []) if (!moves[mv]) missing.push(`trainer move ${k}:${mv}`);
      if (m.item && !items[m.item]) missing.push(`trainer held ${k}:${m.item}`);
    }
    for (const i of t.items) if (!items[i]) missing.push(`trainer item ${k}:${i}`);
    if (!classes[t.class]) missing.push(`trainer class ${k}:${t.class}`);
    for (const m of t.maps) if (!maps[m]) missing.push(`trainer map ${k}:${m}`);
  }
  for (const [k, e] of Object.entries(encounters)) {
    for (const s of [...e.land, ...e.water, ...e.rock, ...e.fishing]) if (!species[s.species]) missing.push(`enc ${k}:${s.species}`);
    if (!maps[k]) missing.push(`enc map ${k}`);
  }
  for (const [k, m] of Object.entries(moves)) { if (!types.list.includes(m.type) && m.type !== 'MYSTERY') missing.push(`move type ${k}:${m.type}`); if (!m.desc) missing.push(`move desc ${k}`); }
  check('all referenced files exist & cross-refs resolve', missing.length === 0, missing.length ? `${missing.length} problems: ${missing.slice(0, 15).join('; ')}` : `${N(species)} gfx dirs + ${fileChecks.length} mon sprite/pal files + ${N(species)} cries, ${N(items) * 2} item icon/pal files, ${N(trainers) * 2} trainer pic/pal files ok`);
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const t0 = Date.now();
  const species = buildSpecies();
  const moves = buildMoves();
  const types = buildTypes();
  const items = buildItems();
  const { maps, folderToId } = buildMaps();
  const { trainers, classes } = buildTrainers(folderToId);
  const encounters = buildEncounters(maps);
  const abilities = buildAbilities();

  fs.mkdirSync(OUT, { recursive: true });
  const files = {
    'species.json': species, 'moves.json': moves, 'types.json': types, 'items.json': items, 'trainers.json': trainers,
    'encounters.json': encounters, 'abilities.json': abilities, 'maps.json': maps, 'trainer_classes.json': classes,
  };
  console.log(`Kanto Spire data extract -> ${path.relative(ROOT, OUT)}`);
  for (const [name, data] of Object.entries(files)) {
    const json = JSON.stringify(data);
    fs.writeFileSync(path.join(OUT, name), json);
    const count = name === 'types.json' ? data.list.length : Object.keys(data).length;
    console.log(`  ${name.padEnd(22)} ${String(count).padStart(4)} entries  ${(json.length / 1024).toFixed(1).padStart(7)} KB`);
  }
  const tv = Object.values(trainers);
  console.log(`  trainers: ${tv.filter((t) => !t.dummy).length} real, ${tv.filter((t) => t.dummy).length} dummy, ${tv.filter((t) => t.maps.length).length} placed on maps`);

  let failed = 0;
  if (!process.argv.includes('--no-verify')) {
    console.log('Verification:');
    for (const r of verify({ species, moves, types, items, trainers, encounters, abilities, maps, classes })) {
      if (!r.ok) failed++;
      console.log(`  [${r.ok ? 'PASS' : 'FAIL'}] ${r.label}${r.detail !== '' ? '  (' + r.detail + ')' : ''}`);
    }
  }
  if (warnings.length) {
    console.log(`Warnings (${warnings.length}):`);
    for (const w of warnings.slice(0, 40)) console.log('  - ' + w);
  }
  console.log(`Done in ${Date.now() - t0} ms${failed ? `, ${failed} check(s) FAILED` : ''}.`);
  process.exitCode = failed ? 1 : 0;
}

if (require.main === module) main();
module.exports = { preprocess, rd, src, C, constVal, evalExpr };
