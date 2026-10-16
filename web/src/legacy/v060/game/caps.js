// Content capabilities (v0.6.0, the Notion plan "Platinum / Sinnoh ideas" §5). A cap names CONTENT, not a ROM: each
// content block lists the ROMs that can provide it, and the cap is on when any of them is there. Regions say which caps
// they need (regions.js REGIONS[id].requires) and runs store the caps their regions need (Run.requires), so a run
// started with HeartGold can go on with Platinum, and the other way round.
//
// Mechanics never depend on the source ROM: stats, learnsets, evolutions, trainers and pools are committed data. A ROM
// only provides presentation (sprites, cries, portraits, music), so every player plays the same game.
//
// Mainline (the hosted build) derives the caps from the asset packs its server has (capsFromPacks: all on in prod);
// local dev and the Node tests, which have no packs, get every cap (ALL_CAPS). BYO-ROM (a design, not built yet) would
// call capsFrom(loaded ROMs) instead.

// The ROMs the game knows (offline extractors: tools/extract_*.py). sha1: accepted clean dumps.
export const ROMS = {
  firered: { codes: ['BPRE'], required: true, name: 'Pokemon FireRed (USA)' },
  emerald: { codes: ['BPEE'], name: 'Pokemon Emerald (USA)' },
  heartgold: { codes: ['IPKE'], name: 'Pokemon HeartGold (USA)', sha1: ['4fcded0e2713dc03929845de631d0932ea2b5a37'] },
  platinum: {
    codes: ['CPUE'], name: 'Pokemon Platinum (USA)',
    sha1: ['0862ec35b24de5c7e2dcb88c9eea0873110d755c', 'ce81046eda7d232513069519cb2085349896dec7'], // Rev 1, Rev 0
  },
};

// Content -> the ROMs that can provide it (prefer: which one wins when several are there).
export const CONTENT = {
  core: { from: ['firered'], label: 'KANTO and every Gen 1-3 POKéMON' },
  hoenn: { from: ['emerald'], label: 'HOENN music and art' }, // (HOENN itself falls back to FireRed's art)
  johto: { from: ['heartgold'], label: 'JOHTO portraits, walkers and APRICORNS' },
  sinnoh: { from: ['platinum'], label: 'SINNOH portraits, walkers and GIRATINA ORIGIN' },
  gen4: { from: ['heartgold', 'platinum'], prefer: ['heartgold', 'platinum'], label: 'Gen 4 POKéMON (sprites, cries, stone icons)' },
};
export const CAP_IDS = Object.keys(CONTENT);
export const ALL_CAPS = Object.freeze(Object.fromEntries(CAP_IDS.map(k => [k, true])));

// loaded: a Set / array of ROM ids -> { cap: bool }
export function capsFrom(loaded) {
  const has = new Set(loaded || []);
  return Object.fromEntries(CAP_IDS.map(k => [k, CONTENT[k].from.some(r => has.has(r))]));
}
// The ROM a cap comes from when several are loaded (null: none).
export const capSource = (cap, loaded) => { const has = new Set(loaded || []); const c = CONTENT[cap]; return (c?.prefer || c?.from || []).find(r => has.has(r)) || null; };

// Mainline: the asset packs (tools/upload_packs.cjs) that carry each cap's content. A cap is on when its pack is there.
// core / hoenn have no gate (HOENN falls back to FireRed art).
export const PACK_CAPS = { johto: ['hgss'], sinnoh: ['sinnoh'], gen4: ['pokemon-gen4'] };
export function capsFromPacks(names) {
  const has = new Set(names || []);
  return Object.fromEntries(CAP_IDS.map(k => [k, !PACK_CAPS[k] || PACK_CAPS[k].some(p => has.has(p))]));
}

// The caps of this session (main.js sets them once the pack list is known). Read by regions.js unlockedRegions and
// the starter list; never by battle or run logic, so co-op replay can't depend on them.
let current = ALL_CAPS;
export const getCaps = () => current;
export function setCaps(caps) { current = Object.freeze({ ...ALL_CAPS, ...(caps || {}) }); return current; }
// every cap in `list` is on
export const capsOk = (list, caps = current) => (list || []).every(k => caps[k] !== false);
// "HeartGold or Platinum" for a cap (gate texts)
export const capRoms = (cap) => (CONTENT[cap]?.from || []).map(r => ROMS[r]?.name.replace(/^Pokemon /, '').replace(/ \(USA\)$/, '')).join(' or ');
