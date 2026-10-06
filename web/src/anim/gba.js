// A small emulation of the bits of FireRed's engine that battle animations use: sprites with
// ANIMCMD/AFFINEANIMCMD tables, tasks, OAM matrices, palettes (gPlttBuffer*), a few GPU registers.
// The C animation callbacks (src/battle_anim_*.c) are ported to JS almost line by line against this
// API, so names follow the decomp. Coordinates are GBA screen pixels (240x160); render.js maps them
// onto the battle scene. Scalar globals live on S (S.gBattleAnimAttacker, S.gBattle_BG3_X, ...).
import { gSineTable, gSineDegreeTable } from './trig.js';

// ---- constants -------------------------------------------------------------------------------
export const MAX_SPRITES = 64, MAX_TASKS = 16, SPRITE_NONE = 0xFF, TASK_NONE = 0xFF;
export const ANIM_ATTACKER = 0, ANIM_TARGET = 1, ANIM_ATK_PARTNER = 2, ANIM_DEF_PARTNER = 3;
export const BATTLER_COORD_X = 0, BATTLER_COORD_Y = 1, BATTLER_COORD_X_2 = 2, BATTLER_COORD_Y_PIC_OFFSET = 3, BATTLER_COORD_Y_PIC_OFFSET_DEFAULT = 4;
export const BATTLER_COORD_ATTR_HEIGHT = 0, BATTLER_COORD_ATTR_WIDTH = 1, BATTLER_COORD_ATTR_TOP = 2, BATTLER_COORD_ATTR_BOTTOM = 3, BATTLER_COORD_ATTR_LEFT = 4, BATTLER_COORD_ATTR_RIGHT = 5, BATTLER_COORD_ATTR_RAW_BOTTOM = 6;
export const B_SIDE_PLAYER = 0, B_SIDE_OPPONENT = 1;
export const B_POSITION_PLAYER_LEFT = 0, B_POSITION_OPPONENT_LEFT = 1, B_POSITION_PLAYER_RIGHT = 2, B_POSITION_OPPONENT_RIGHT = 3;
export const ST_OAM_OBJ_NORMAL = 0, ST_OAM_OBJ_BLEND = 1, ST_OAM_OBJ_WINDOW = 2;
export const ST_OAM_AFFINE_OFF = 0, ST_OAM_AFFINE_NORMAL = 1, ST_OAM_AFFINE_ERASE = 2, ST_OAM_AFFINE_DOUBLE = 3, ST_OAM_AFFINE_ON_MASK = 1, ST_OAM_AFFINE_DOUBLE_MASK = 2;
export const F_PAL_BG = 1, F_PAL_ATTACKER = 2, F_PAL_TARGET = 4, F_PAL_ATK_PARTNER = 8, F_PAL_DEF_PARTNER = 16, F_PAL_ANIM_1 = 32, F_PAL_ANIM_2 = 64;
export const F_PAL_ATK_SIDE = F_PAL_ATTACKER | F_PAL_ATK_PARTNER, F_PAL_DEF_SIDE = F_PAL_TARGET | F_PAL_DEF_PARTNER, F_PAL_BATTLERS = F_PAL_ATK_SIDE | F_PAL_DEF_SIDE;
export const BG_ANIM_PAL_1 = 8, BG_ANIM_PAL_2 = 9;
export const RGB = (r, g, b) => (r & 31) | ((g & 31) << 5) | ((b & 31) << 10);
export const RGB_BLACK = 0, RGB_WHITE = RGB(31, 31, 31), RGB_RED = RGB(31, 0, 0), RGB_GREEN = RGB(0, 31, 0), RGB_BLUE = RGB(0, 0, 31), RGB_YELLOW = RGB(31, 31, 0), RGB_MAGENTA = RGB(31, 0, 31), RGB_CYAN = RGB(0, 31, 31), RGB_WHITEALPHA = RGB_WHITE | 0x8000;
export const SOUND_PAN_ATTACKER = -64, SOUND_PAN_TARGET = 63;
// GPU registers are kept by name: SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(12, 8)).
export const REG_OFFSET_DISPCNT = 'DISPCNT', REG_OFFSET_BLDCNT = 'BLDCNT', REG_OFFSET_BLDALPHA = 'BLDALPHA', REG_OFFSET_BLDY = 'BLDY',
  REG_OFFSET_BG1CNT = 'BG1CNT', REG_OFFSET_BG2CNT = 'BG2CNT', REG_OFFSET_BG3CNT = 'BG3CNT', REG_OFFSET_MOSAIC = 'MOSAIC',
  REG_OFFSET_WININ = 'WININ', REG_OFFSET_WINOUT = 'WINOUT', REG_OFFSET_WIN0H = 'WIN0H', REG_OFFSET_WIN0V = 'WIN0V', REG_OFFSET_WIN1H = 'WIN1H', REG_OFFSET_WIN1V = 'WIN1V',
  REG_OFFSET_BG1HOFS = 'BG1HOFS', REG_OFFSET_BG1VOFS = 'BG1VOFS', REG_OFFSET_BG2HOFS = 'BG2HOFS', REG_OFFSET_BG2VOFS = 'BG2VOFS', REG_OFFSET_BG3HOFS = 'BG3HOFS', REG_OFFSET_BG3VOFS = 'BG3VOFS';
export const BLDALPHA_BLEND = (a, b) => ((b & 0x1F) << 8) | (a & 0x1F);
export const BLDCNT_TGT1_BG1 = 1 << 1, BLDCNT_TGT1_BG2 = 1 << 2, BLDCNT_TGT1_BG3 = 1 << 3, BLDCNT_TGT1_OBJ = 1 << 4, BLDCNT_TGT1_BD = 1 << 5, BLDCNT_TGT1_ALL = 0x3F,
  BLDCNT_EFFECT_NONE = 0, BLDCNT_EFFECT_BLEND = 1 << 6, BLDCNT_EFFECT_LIGHTEN = 2 << 6, BLDCNT_EFFECT_DARKEN = 3 << 6,
  BLDCNT_TGT2_BG0 = 1 << 8, BLDCNT_TGT2_BG1 = 1 << 9, BLDCNT_TGT2_BG2 = 1 << 10, BLDCNT_TGT2_BG3 = 1 << 11, BLDCNT_TGT2_OBJ = 1 << 12, BLDCNT_TGT2_BD = 1 << 13, BLDCNT_TGT2_ALL = 0x3F00;
export const DISPCNT_OBJWIN_ON = 1 << 15, DISPCNT_WIN0_ON = 1 << 13, DISPCNT_WIN1_ON = 1 << 14;
export const TRUE = 1, FALSE = 0;

// ---- integer helpers (C semantics) ---------------------------------------------------------------
export const idiv = (a, b) => (b === 0 ? 0 : Math.trunc(a / b)); // C '/': truncate toward zero
export const imod = (a, b) => (b === 0 ? 0 : a % b);
export const u8 = (v) => v & 0xFF;
export const s8 = (v) => (v << 24) >> 24;
export const u16 = (v) => v & 0xFFFF;
export const s16 = (v) => (v << 16) >> 16;
export const u32 = (v) => v >>> 0;
export const abs = Math.abs;
export const min = Math.min, max = Math.max;

// ---- trig (src/trig.c, BIOS) ---------------------------------------------------------------------
export function Sin(index, amplitude) { return s16((amplitude * gSineTable[index & 0x1FF] ?? 0) >> 8); }
export function Cos(index, amplitude) { return s16((amplitude * (gSineTable[(index + 64) & 0x1FF] ?? 0)) >> 8); }
export const gSineTableRef = gSineTable;
export { gSineTable, gSineDegreeTable };
export function Sin2(angle) { angle &= 0xFFFF; const v = gSineDegreeTable[angle % 180]; return ((angle / 180) | 0) & 1 ? -v : v; }
export function Cos2(angle) { return Sin2(angle + 90); }
// BIOS ArcTan2(x, y): angle of (x, y) as 0..0xFFFF.
export function ArcTan2(x, y) { let a = Math.atan2(y, x); if (a < 0) a += Math.PI * 2; return Math.round(a / (Math.PI * 2) * 65536) & 0xFFFF; }

// Deterministic Random() (the animations only use it for cosmetic jitter).
let rngState = 0x1234;
export function Random() { rngState = (Math.imul(rngState, 1103515245) + 24691) >>> 0; return rngState >>> 16; }
export function Random32() { return ((Random() << 16) | Random()) >>> 0; }
export function SeedAnimRng(s) { rngState = s >>> 0; }

// ---- global state ------------------------------------------------------------------------------------
export const S = {
  gBattleAnimAttacker: 0, gBattleAnimTarget: 1, gBattlerAttacker: 0, gBattlerTarget: 1,
  gAnimVisualTaskCount: 0, gAnimSoundTaskCount: 0, gAnimMoveTurn: 0, gAnimMovePower: 0, gAnimMoveDmg: 0, gAnimFriendship: 0,
  gAnimDisableStructPtr: { rolloutTimer: 0, rolloutTimerStartValue: 0, furyCutterCounter: 0, chargeTimer: 0, mimickedMoves: 0 },
  gWeatherMoveAnim: 0, gAnimCustomPanning: 0, gBattlersCount: 2, gBattleTypeFlags: 0,
  gBattle_BG1_X: 0, gBattle_BG1_Y: 0, gBattle_BG2_X: 0, gBattle_BG2_Y: 0, gBattle_BG3_X: 0, gBattle_BG3_Y: 0,
  gBattle_WIN0H: 0, gBattle_WIN0V: 0, gBattle_WIN1H: 0, gBattle_WIN1V: 0,
  gSpriteCoordOffsetX: 0, gSpriteCoordOffsetY: 0,
  gMonShrinkDuration: 0, gMonShrinkDelta: 0, gMonShrinkDistance: 0,
  bgBlack: 0, // 0..16: fadetobg's fade of the battle background to black
  animBgs: { 1: null, 2: null }, // anim BG layers: {key (anims.json bgs/extraBgs), alpha}
  moveBg: null, // BG_* key of the move background currently shown instead of the terrain (fadetobg)
  frame: 0,
  // battlers: [{present, x, y, picY, species, back, h}] in GBA coordinates (set by the player per animation)
  battlers: [],
};
export const gBattleAnimArgs = new Int16Array(8);
export const gBattlerSpriteIds = new Uint8Array([0, 1, 2, 3]);
export const gBattlerPositions = [0, 1, 2, 3];
export const gBattleMonForms = [0, 0, 0, 0];
export const gOamMatrices = Array.from({ length: 32 }, () => ({ a: 0x100, b: 0, c: 0, d: 0x100 }));
let oamMatrixAlloc = 0;
export const gPlttBufferUnfaded = new Uint16Array(512);
export const gPlttBufferFaded = new Uint16Array(512);
export const gPaletteFade = { active: false, y: 0, targetY: 0, deltaY: 2, delay: 0, delayCounter: 0, selected: 0, color: 0, yDec: false };
const gpuRegs = Object.create(null);
export function SetGpuReg(reg, v) { gpuRegs[reg] = v & 0xFFFF; }
export function GetGpuReg(reg) { return gpuRegs[reg] || 0; }
export function SetGpuRegBits(reg, v) { gpuRegs[reg] = (gpuRegs[reg] || 0) | v; }
export function ClearGpuRegBits(reg, v) { gpuRegs[reg] = (gpuRegs[reg] || 0) & ~v; }
export function gpuRegsAll() { return gpuRegs; }

// Animation data (anims.json): templates, anim tables, tags, palettes ... set by the loader.
export const DATA = { json: null, tiles: null };

// ---- sound hooks (set by the player) ---------------------------------------------------------------
export const SoundHooks = { playSE: (_name) => {}, playCry: (_species, _mode) => {} };
export function seName(id) { if (typeof id === 'string') return id; return DATA.json?.seNames?.[id] || null; }
export function PlaySE(id) { const n = seName(id); if (n) SoundHooks.playSE(n.toLowerCase()); }
export function PlaySE12WithPanning(id, _pan) { PlaySE(id); }
export function PlaySE1WithPanning(id, _pan) { PlaySE(id); }
export function PlaySE2WithPanning(id, _pan) { PlaySE(id); }
export function SE12PanpotControl(_pan) {}
export function IsSEPlaying() { return false; }
export function IsCryPlaying() { return false; }
export function BattleAnimAdjustPanning(pan) { return pan; }
export function BattleAnimAdjustPanning2(pan) { return pan; }
export function KeepPanInRange(pan) { return Math.max(-64, Math.min(63, pan)); }
export function CalculatePanIncrement(src, target, inc) { const d = target - src; return d > 0 ? Math.abs(inc) : d < 0 ? -Math.abs(inc) : 0; }

// ---- tags / templates --------------------------------------------------------------------------
const TAG_STRIDE = 4096; // virtual VRAM: tag i's tiles start at i * TAG_STRIDE
const tagIndex = new Map(), tagById = new Map();
export function tagName(tag) {
  if (typeof tag === 'string') return tag;
  if (!tagById.size && DATA.json) for (const [k, v] of Object.entries(DATA.json.tags)) tagById.set(v.id, k);
  return tagById.get(tag) || null;
}
function tagSlot(tag) {
  const name = tagName(tag);
  if (!name) return -1;
  let i = tagIndex.get(name);
  if (i === undefined) { i = tagIndex.size + 1; tagIndex.set(name, i); }
  return i;
}
export function tagOfTileNum(tileNum) {
  const slot = Math.floor(tileNum / TAG_STRIDE);
  for (const [k, v] of tagIndex) if (v === slot) return k;
  return null;
}
export function GetSpriteTileStartByTag(tag) { const s = tagSlot(tag); return s < 0 ? 0xFFFF : s * TAG_STRIDE; }
export function LoadCompressedSpriteSheetUsingHeap(_sheet) {}
export function LoadSpriteSheet(_sheet) {}
export function FreeSpriteTilesByTag(_tag) {}

// Sprite palettes: OBJ palette slots 6..15 (0..5 = battlers etc.), data in gPlttBuffer*[256 + slot*16].
const palSlots = new Array(16).fill(null);
export function IndexOfSpritePaletteTag(tag) { const n = tagName(tag); const i = palSlots.indexOf(n); return i < 0 ? 0xFF : i; }
export function AllocSpritePalette(tag) {
  const n = tagName(tag);
  let i = palSlots.indexOf(n);
  if (i >= 0) return i;
  i = palSlots.indexOf(null, 6);
  if (i < 0) i = 15;
  palSlots[i] = n;
  return i;
}
export function LoadSpritePaletteByTag(tag) {
  const n = tagName(tag);
  if (!n) return 0xFF;
  const existing = palSlots.indexOf(n);
  if (existing >= 0) return existing;
  const i = AllocSpritePalette(n);
  const pal = DATA.json?.palettes?.[n] || DATA.json?.palettes?.[DATA.json?.tags?.[n]?.pal];
  const off = 256 + i * 16;
  for (let k = 0; k < 16; k++) {
    const hex = pal?.[k] || '#000000';
    const v = parseInt(hex.slice(1), 16);
    const c = RGB((v >> 16 & 255) >> 3, (v >> 8 & 255) >> 3, (v & 255) >> 3);
    gPlttBufferUnfaded[off + k] = c; gPlttBufferFaded[off + k] = c;
  }
  return i;
}
export const LoadCompressedSpritePaletteUsingHeap = (p) => LoadSpritePaletteByTag(p?.tag ?? p);
export function FreeSpritePaletteByTag(tag) { const i = IndexOfSpritePaletteTag(tag); if (i !== 0xFF && i >= 6) palSlots[i] = null; }
export function AllocSpritePaletteIndex() { return AllocSpritePalette('__anon' + Math.random()); }

// Virtual palettes (battlers, battle background): entries 0 = black, 1 = white, so any blend applied
// to them can be read back as "lerp toward colour c by amount a" when drawing (see paletteTint()).
function resetVirtualPal(p) { const o = p * 16; for (let k = 0; k < 16; k++) { const c = k & 1 ? RGB_WHITE : 0; gPlttBufferUnfaded[o + k] = c; gPlttBufferFaded[o + k] = c; } }
// -> {r,g,b (0..1 tint colour), a (0..1 amount)} or null when untinted
export function paletteTint(p) {
  const o = p * 16, f0 = gPlttBufferFaded[o], f1 = gPlttBufferFaded[o + 1];
  if (f0 === 0 && f1 === RGB_WHITE) return null;
  const ch = (c, s) => (c >> s) & 31;
  let a = 0, r = 0, g = 0, b = 0;
  const comps = [0, 5, 10].map(s => [ch(f0, s), ch(f1, s)]);
  // per channel: f0 = col*a, f1 = 31 - (31 - col)*a  => a = 1 - (f1 - f0)/31
  a = Math.max(0, Math.min(1, 1 - comps.reduce((t, [lo, hi]) => t + (hi - lo), 0) / 93));
  if (a <= 0.001) return null;
  [r, g, b] = comps.map(([lo]) => Math.min(1, lo / 31 / a));
  return { r, g, b, a };
}

// ---- palette ops (src/palette.c) -----------------------------------------------------------------
export function BlendPalette(palOffset, numEntries, coeff, blendColor) {
  for (let i = 0; i < numEntries; i++) {
    const idx = palOffset + i, c = gPlttBufferUnfaded[idx];
    const r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31;
    const r2 = blendColor & 31, g2 = (blendColor >> 5) & 31, b2 = (blendColor >> 10) & 31;
    gPlttBufferFaded[idx] = RGB(r + (((r2 - r) * coeff) >> 4), g + (((g2 - g) * coeff) >> 4), b + (((b2 - b) * coeff) >> 4));
  }
}
export function BlendPalettes(selectedPalettes, coeff, color) {
  for (let off = 0; selectedPalettes; off += 16, selectedPalettes >>>= 1) if (selectedPalettes & 1) BlendPalette(off, 16, coeff, color);
}
export function BlendPalettesUnfaded(selectedPalettes, coeff, color) { gPlttBufferFaded.set(gPlttBufferUnfaded); BlendPalettes(selectedPalettes, coeff, color); }
export function CpuCopyPal(src, srcOff, dst, dstOff, count) { for (let i = 0; i < count; i++) dst[dstOff + i] = src[srcOff + i]; }
export function BeginNormalPaletteFade(selectedPalettes, delay, startY, targetY, blendColor) {
  if (gPaletteFade.active) return false;
  gPaletteFade.deltaY = 2;
  if (delay < 0) { gPaletteFade.deltaY += -delay; delay = 0; }
  Object.assign(gPaletteFade, { selected: selectedPalettes >>> 0, delayCounter: delay, delay, y: startY, targetY, color: blendColor, active: true, yDec: startY > targetY });
  UpdatePaletteFade();
  return true;
}
export function UpdatePaletteFade() {
  const f = gPaletteFade;
  if (!f.active) return;
  if (f.delayCounter < f.delay) { f.delayCounter++; return; }
  f.delayCounter = 0;
  BlendPalettes(f.selected, f.y, f.color);
  if (f.y === f.targetY) { f.active = false; return; }
  if (!f.yDec) { f.y += f.deltaY; if (f.y > f.targetY) f.y = f.targetY; }
  else { f.y -= f.deltaY; if (f.y < f.targetY) f.y = f.targetY; }
}
export function BeginHardwarePaletteFade(_sel, _delay, startY, targetY, _r) { BeginNormalPaletteFade(0xE, 0, startY, targetY, RGB_BLACK); }
export function InvertPlttBuffer(_sel) {}
export function TintPlttBuffer() {}
export function UnfadePlttBuffer() {}

// ---- sprites ------------------------------------------------------------------------------------
export function SpriteCallbackDummy(_s) {}
const DUMMY_ANIMS = [[{ end: 1 }]];
const DUMMY_AFFINE = [[{ end: 1 }]];
function animsOf(name) { if (!name) return DUMMY_ANIMS; if (Array.isArray(name)) return name; const t = DATA.json?.animTables?.[name]; return t ? t.map(a => (typeof a === 'string' ? DATA.json.anims?.[a] || [{ end: 1 }] : a)) : DUMMY_ANIMS; }
function affineOf(name) { if (!name) return DUMMY_AFFINE; if (Array.isArray(name)) return name; const t = DATA.json?.affineTables?.[name]; return t ? t.map(a => (typeof a === 'string' ? DATA.json.affineAnims?.[a] || [{ end: 1 }] : a)) : DUMMY_AFFINE; }
export function affineAnimByName(name) { return DATA.json?.affineAnims?.[name] || null; }

class Sprite {
  constructor(id) { this.id = id; this.reset(); }
  reset() {
    this.inUse = false; this.x = 0; this.y = 0; this.x2 = 0; this.y2 = 0; this.centerToCornerVecX = 0; this.centerToCornerVecY = 0;
    this.data = new Int16Array(8); this.callback = SpriteCallbackDummy; this.template = null;
    this.oam = { affineMode: 0, objMode: 0, priority: 2, tileNum: 0, paletteNum: 0, matrixNum: 0, w: 8, h: 8, shape: 0, size: 0, mosaic: 0, bpp: 0 };
    this.subpriority = 0; this.invisible = false; this.hFlip = false; this.vFlip = false; this.flipH = false; this.flipV = false;
    this.anims = DUMMY_ANIMS; this.affineAnims = DUMMY_AFFINE;
    this.animNum = 0; this.animCmdIndex = 0; this.animDelayCounter = 0; this.animLoopCounter = 0;
    this.animBeginning = true; this.animEnded = false; this.animPaused = false;
    this.affineAnimBeginning = false; this.affineAnimEnded = false; this.affineAnimPaused = false;
    this.usingSheet = true; this.sheetTileStart = 0; this.sheetTag = null; this.coordOffsetEnabled = false;
    this.isMon = false; this.battler = -1; this.monClone = -1; this.storedCb = null; this.ptrs = {};
  }
}
export const gSprites = Array.from({ length: MAX_SPRITES + 1 }, (_, i) => new Sprite(i));
// Affine anim state per OAM matrix (sAffineAnimStates)
const affState = Array.from({ length: 32 }, () => ({ animNum: 0, animCmdIndex: 0, delayCounter: 0, loopCounter: 0, xScale: 0x100, yScale: 0x100, rotation: 0 }));

export function AllocOamMatrix() { for (let i = 0; i < 32; i++) if (!(oamMatrixAlloc & (1 << i))) { oamMatrixAlloc |= 1 << i; return i; } return 0xFF; }
export function FreeOamMatrix(i) { oamMatrixAlloc &= ~(1 << i); gOamMatrices[i] = { a: 0x100, b: 0, c: 0, d: 0x100 }; }
export function FreeSpriteOamMatrix(sprite) { if (sprite.oam.affineMode & ST_OAM_AFFINE_ON_MASK) { FreeOamMatrix(sprite.oam.matrixNum); sprite.oam.affineMode = ST_OAM_AFFINE_OFF; } }
export function CalcCenterToCornerVec(sprite, _shape, _size, affineMode) {
  const dbl = (affineMode ?? sprite.oam.affineMode) === ST_OAM_AFFINE_DOUBLE;
  sprite.centerToCornerVecX = -(sprite.oam.w >> 1) * (dbl ? 2 : 1); sprite.centerToCornerVecY = -(sprite.oam.h >> 1) * (dbl ? 2 : 1);
}

function applyOam(sprite, o) {
  Object.assign(sprite.oam, { w: o?.w || 8, h: o?.h || 8, affineMode: o?.affine || 0, objMode: o?.objMode || 0, priority: o?.priority ?? 2, mosaic: o?.mosaic || 0 });
}
// template: an entry of DATA.json.templates (or a JS object with the same fields + callback function)
export function CreateSpriteAt(index, template, x, y, subpriority) {
  const sprite = gSprites[index];
  sprite.reset();
  sprite.inUse = true; sprite.template = template;
  applyOam(sprite, template.oamData || template);
  sprite.x = x; sprite.y = y; sprite.subpriority = subpriority;
  sprite.anims = animsOf(template.anims); sprite.affineAnims = affineOf(template.affineAnims);
  sprite.callback = template.callbackFn || resolveCallback(template.callback) || SpriteCallbackDummy;
  if (sprite.oam.affineMode & ST_OAM_AFFINE_ON_MASK) {
    const m = AllocOamMatrix();
    sprite.oam.matrixNum = m === 0xFF ? 31 : m;
    gOamMatrices[sprite.oam.matrixNum] = { a: 0x100, b: 0, c: 0, d: 0x100 };
    InitSpriteAffineAnim(sprite);
  }
  CalcCenterToCornerVec(sprite);
  if (template.tileTag && template.tileTag !== 'TAG_NONE' && template.tileTag !== 0xFFFF) {
    sprite.sheetTag = tagName(template.tileTag); sprite.sheetTileStart = GetSpriteTileStartByTag(template.tileTag); sprite.oam.tileNum = sprite.sheetTileStart;
  }
  if (template.monBattler !== undefined) { sprite.isMon = true; sprite.battler = template.monBattler; }
  if (template.paletteTag && template.paletteTag !== 'TAG_NONE' && template.paletteTag !== 0xFFFF) sprite.oam.paletteNum = LoadSpritePaletteByTag(template.paletteTag);
  return index;
}
export function CreateSprite(template, x, y, subpriority) {
  for (let i = 0; i < MAX_SPRITES; i++) if (!gSprites[i].inUse) return CreateSpriteAt(i, template, x, y, subpriority);
  return MAX_SPRITES;
}
export function CreateSpriteAndAnimate(template, x, y, subpriority) {
  for (let i = 0; i < MAX_SPRITES; i++) {
    if (!gSprites[i].inUse) {
      CreateSpriteAt(i, template, x, y, subpriority);
      const s = gSprites[i];
      s.callback(s);
      if (s.inUse) AnimateSprite(s);
      return i;
    }
  }
  return MAX_SPRITES;
}
export function DestroySprite(sprite) { if (!sprite || !sprite.inUse) return; if (sprite.isMon && sprite.monClone < 0 && sprite.battler >= 0) return; sprite.reset(); }
export function DestroySpriteAndFreeResources(sprite) { FreeSpriteOamMatrix(sprite); DestroySprite(sprite); }
export function SetSubspriteTables() {}

// -- ANIMCMD engine (src/sprite.c)
const cmdType = (c) => (!c ? -1 : c.end ? -1 : c.jump !== undefined ? -2 : c.loop !== undefined ? -3 : 0);
function setFrame(sprite, c) {
  let d = c.d || 0; if (d) d--;
  sprite.animDelayCounter = d;
  if (!(sprite.oam.affineMode & ST_OAM_AFFINE_ON_MASK)) { sprite.flipH = !!c.h !== !!sprite.hFlip; sprite.flipV = !!c.v !== !!sprite.vFlip; }
  if (sprite.usingSheet) sprite.oam.tileNum = sprite.sheetTileStart + (c.f || 0);
}
function BeginAnim(sprite) {
  sprite.animCmdIndex = 0; sprite.animEnded = false; sprite.animLoopCounter = 0;
  const c = sprite.anims[sprite.animNum]?.[0];
  if (c && cmdType(c) === 0 && c.f !== -1) { sprite.animBeginning = false; setFrame(sprite, c); }
}
function ContinueAnim(sprite) {
  const anim = sprite.anims[sprite.animNum] || DUMMY_ANIMS[0];
  if (sprite.animDelayCounter) {
    if (!sprite.animPaused) sprite.animDelayCounter--;
    const c = anim[sprite.animCmdIndex];
    if (c && !(sprite.oam.affineMode & ST_OAM_AFFINE_ON_MASK)) { sprite.flipH = !!c.h !== !!sprite.hFlip; sprite.flipV = !!c.v !== !!sprite.vFlip; }
  } else if (!sprite.animPaused) {
    sprite.animCmdIndex++;
    const c = anim[sprite.animCmdIndex];
    const t = cmdType(c);
    if (t === 0) setFrame(sprite, c);
    else if (t === -1) { sprite.animCmdIndex--; sprite.animEnded = true; }
    else if (t === -2) { sprite.animCmdIndex = c.jump; const f = anim[sprite.animCmdIndex]; if (f && cmdType(f) === 0) setFrame(sprite, f); }
    else if (t === -3) {
      if (sprite.animLoopCounter) sprite.animLoopCounter--; else sprite.animLoopCounter = c.loop;
      if (sprite.animLoopCounter) {
        sprite.animCmdIndex--;
        while (sprite.animCmdIndex > 0 && cmdType(anim[sprite.animCmdIndex - 1]) !== -3) sprite.animCmdIndex--;
        sprite.animCmdIndex--;
      }
      ContinueAnim(sprite);
    }
  }
}
// -- AFFINEANIMCMD engine
const affType = (c) => (!c ? 32767 : c.end ? 32767 : c.jump !== undefined ? 32766 : c.loop !== undefined ? 32765 : 0);
function affFrame(st, sprite) { const c = sprite.affineAnims[st.animNum]?.[st.animCmdIndex] || {}; return { xScale: c.x || 0, yScale: c.y || 0, rotation: c.r || 0, duration: c.d || 0, set: !!c.set }; }
function updateMatrixFromState(m) {
  const st = affState[m];
  const sx = st.xScale ? Math.trunc(0x10000 / st.xScale) : 0, sy = st.yScale ? Math.trunc(0x10000 / st.yScale) : 0;
  gOamMatrices[m] = ObjAffineSet(sx, sy, st.rotation);
}
function applyRel(m, f) {
  const st = affState[m];
  st.xScale = s16(st.xScale + f.xScale); st.yScale = s16(st.yScale + f.yScale);
  st.rotation = ((st.rotation + (s8(f.rotation) << 8)) & ~0xFF) & 0xFFFF;
  updateMatrixFromState(m);
}
function applyFrame(m, f) {
  if (f.duration) { f.duration--; applyRel(m, f); }
  else { const st = affState[m]; st.xScale = f.xScale; st.yScale = f.yScale; st.rotation = (f.rotation << 8) & 0xFFFF; applyRel(m, { xScale: 0, yScale: 0, rotation: 0 }); }
}
function BeginAffineAnim(sprite) {
  if ((sprite.oam.affineMode & ST_OAM_AFFINE_ON_MASK) && affType(sprite.affineAnims[0]?.[0]) !== 32767) {
    const m = sprite.oam.matrixNum, st = affState[m];
    st.animCmdIndex = 0; st.delayCounter = 0; st.loopCounter = 0;
    const f = affFrame(st, sprite);
    sprite.affineAnimBeginning = false; sprite.affineAnimEnded = false;
    applyFrame(m, f);
    st.delayCounter = f.duration;
  }
}
function ContinueAffineAnim(sprite) {
  if (!(sprite.oam.affineMode & ST_OAM_AFFINE_ON_MASK)) return;
  const m = sprite.oam.matrixNum, st = affState[m];
  if (st.delayCounter) {
    if (!sprite.affineAnimPaused) --st.delayCounter;
    if (!sprite.affineAnimPaused) applyRel(m, affFrame(st, sprite));
  } else if (sprite.affineAnimPaused) return;
  else {
    st.animCmdIndex++;
    const anim = sprite.affineAnims[st.animNum] || DUMMY_AFFINE[0];
    const c = anim[st.animCmdIndex], t = affType(c);
    if (t === 32765) {
      if (st.loopCounter) st.loopCounter--; else st.loopCounter = c.loop;
      if (st.loopCounter) {
        st.animCmdIndex--;
        while (st.animCmdIndex > 0 && affType(anim[st.animCmdIndex - 1]) !== 32765) st.animCmdIndex--;
        st.animCmdIndex--;
      }
      ContinueAffineAnim(sprite);
    } else if (t === 32766) { st.animCmdIndex = c.jump; const f = affFrame(st, sprite); applyFrame(m, f); st.delayCounter = f.duration; }
    else if (t === 32767) { sprite.affineAnimEnded = true; st.animCmdIndex--; applyRel(m, { xScale: 0, yScale: 0, rotation: 0 }); }
    else { const f = affFrame(st, sprite); applyFrame(m, f); st.delayCounter = f.duration; }
  }
}
export function AnimateSprite(sprite) {
  if (sprite.animBeginning) BeginAnim(sprite); else ContinueAnim(sprite);
  if (sprite.affineAnimBeginning) BeginAffineAnim(sprite); else ContinueAffineAnim(sprite);
}
export function AnimateSprites() {
  for (let i = 0; i < MAX_SPRITES; i++) { const s = gSprites[i]; if (s.inUse) { s.callback(s); if (s.inUse) AnimateSprite(s); } }
}
export function StartSpriteAnim(sprite, animNum) { sprite.animNum = animNum; sprite.animBeginning = true; sprite.animEnded = false; }
export function StartSpriteAnimIfDifferent(sprite, animNum) { if (sprite.animNum !== animNum) StartSpriteAnim(sprite, animNum); }
export function SeekSpriteAnim(sprite, idx) { const p = sprite.animPaused; sprite.animCmdIndex = idx - 1; sprite.animDelayCounter = 0; sprite.animBeginning = false; sprite.animEnded = false; sprite.animPaused = false; ContinueAnim(sprite); if (sprite.animDelayCounter) sprite.animDelayCounter++; sprite.animPaused = p; }
export function InitSpriteAffineAnim(sprite) {
  const st = affState[sprite.oam.matrixNum];
  Object.assign(st, { animNum: 0, animCmdIndex: 0, delayCounter: 0, loopCounter: 0, xScale: 0x100, yScale: 0x100, rotation: 0 });
  sprite.affineAnimBeginning = true; sprite.affineAnimEnded = false;
}
export function StartSpriteAffineAnim(sprite, animNum) {
  const st = affState[sprite.oam.matrixNum];
  Object.assign(st, { animNum, animCmdIndex: 0, delayCounter: 0, loopCounter: 0, xScale: 0x100, yScale: 0x100, rotation: 0 });
  sprite.affineAnimBeginning = true; sprite.affineAnimEnded = false;
}
export function StartSpriteAffineAnimIfDifferent(sprite, animNum) { if (affState[sprite.oam.matrixNum].animNum !== animNum) StartSpriteAffineAnim(sprite, animNum); }
export function ChangeSpriteAffineAnim(sprite, animNum) { affState[sprite.oam.matrixNum].animNum = animNum; sprite.affineAnimBeginning = true; sprite.affineAnimEnded = false; }
export function ChangeSpriteAffineAnimIfDifferent(sprite, animNum) { if (affState[sprite.oam.matrixNum].animNum !== animNum) ChangeSpriteAffineAnim(sprite, animNum); }
export function SetSpriteMatrixAnchor() {}
// BIOS ObjAffineSet: xScale/yScale are 8.8 *matrix* values (0x100 = 1x, 0x200 = half size).
export function ObjAffineSet(xScale, yScale, rotation) {
  const t = (rotation & 0xFFFF) / 65536 * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
  return { a: Math.trunc(xScale * c), b: Math.trunc(-xScale * s), c: Math.trunc(yScale * s), d: Math.trunc(yScale * c) };
}
export function SetOamMatrix(i, a, b, c, d) { gOamMatrices[i] = { a, b, c, d }; }
export function SetOamMatrixRotationScaling(i, xScale, yScale, rotation) { gOamMatrices[i] = ObjAffineSet(xScale, yScale, rotation); }

// ---- tasks ---------------------------------------------------------------------------------------
class Task { constructor(id) { this.id = id; this.reset(); } reset() { this.isActive = false; this.func = null; this.priority = 0; this.data = new Int16Array(16); this.seq = 0; this.ptrs = {}; } }
export const gTasks = Array.from({ length: MAX_TASKS }, (_, i) => new Task(i));
let taskSeq = 0;
export function TaskDummy(_id) {}
export function CreateTask(func, priority) {
  for (let i = 0; i < MAX_TASKS; i++) {
    const t = gTasks[i];
    if (!t.isActive) { t.reset(); t.isActive = true; t.func = func; t.priority = priority; t.seq = ++taskSeq; return i; }
  }
  throw new Error('anim: out of tasks');
}
export function DestroyTask(id) { if (id >= 0 && id < MAX_TASKS) gTasks[id].reset(); }
export function RunTasks() {
  const list = gTasks.filter(t => t.isActive).sort((a, b) => a.priority - b.priority || a.seq - b.seq);
  for (const t of list) if (t.isActive) t.func(t.id);
}
export function FindTaskIdByFunc(func) { const t = gTasks.find(t => t.isActive && t.func === func); return t ? t.id : TASK_NONE; }
export function FuncIsActiveTask(func) { return gTasks.some(t => t.isActive && t.func === func); }
export function SetWordTaskArg(taskId, idx, value) { gTasks[taskId].ptrs[idx] = value; }
export function GetWordTaskArg(taskId, idx) { return gTasks[taskId].ptrs[idx]; }
export function SetTaskFuncWithFollowupFunc(taskId, func, followup) { gTasks[taskId].ptrs.followup = followup; gTasks[taskId].func = func; }
export function SwitchTaskToFollowupFunc(taskId) { gTasks[taskId].func = gTasks[taskId].ptrs.followup; }

// ---- battlers ------------------------------------------------------------------------------------
export function GetBattlerSide(b) { return b & 1; }
export function GetBattlerPosition(b) { return gBattlerPositions[b] ?? b; }
export function GetBattlerAtPosition(p) { return p; }
export const BATTLE_PARTNER = (b) => b ^ 2;
export const BATTLE_OPPOSITE = (b) => b ^ 1;
export function IsBattlerSpritePresent(b) { return !!S.battlers[b]?.present; }
export function IsBattlerSpriteVisible(b) { return !!S.battlers[b]?.present && !gSprites[gBattlerSpriteIds[b]].invisible; }
export function IsDoubleBattle() { return false; }
export function IsContest() { return false; }
export function GetBattlerSpriteCoord(b, type) {
  const bt = S.battlers[b] || { x: b & 1 ? 176 : 72, y: b & 1 ? 40 : 80, picY: b & 1 ? 40 : 80 };
  switch (type) {
    case BATTLER_COORD_X: case BATTLER_COORD_X_2: return bt.x & 0xFF;
    case BATTLER_COORD_Y: return bt.y & 0xFF;
    default: return bt.picY & 0xFF;
  }
}
export function GetBattlerSpriteCoord2(b, type) { return GetBattlerSpriteCoord(b, type); }
export function GetBattlerSpriteDefault_Y(b) { return GetBattlerSpriteCoord(b, BATTLER_COORD_Y_PIC_OFFSET); }
export function GetBattlerYCoordWithElevation(b) { return GetBattlerSpriteCoord(b, BATTLER_COORD_Y); }
export function GetSubstituteSpriteDefault_Y(b) { return GetBattlerSpriteCoord(b, BATTLER_COORD_Y_PIC_OFFSET) + (GetBattlerSide(b) ? -12 : 16); }
export function GetBattlerSpriteCoordAttr(b, attr) {
  const bt = S.battlers[b] || {}, box = bt.box || { x: 0, y: 0, w: 64, h: 64 };
  const cx = gSprites[gBattlerSpriteIds[b]].x + gSprites[gBattlerSpriteIds[b]].x2, cy = gSprites[gBattlerSpriteIds[b]].y + gSprites[gBattlerSpriteIds[b]].y2;
  const left = cx - 32 + box.x, top = cy - 32 + box.y;
  switch (attr) {
    case BATTLER_COORD_ATTR_HEIGHT: return box.h;
    case BATTLER_COORD_ATTR_WIDTH: return box.w;
    case BATTLER_COORD_ATTR_LEFT: return left;
    case BATTLER_COORD_ATTR_RIGHT: return left + box.w;
    case BATTLER_COORD_ATTR_TOP: return top;
    default: return top + box.h;
  }
}
export function GetAnimBattlerSpriteId(animBattler) {
  let b;
  if (animBattler === ANIM_ATTACKER) b = S.gBattleAnimAttacker;
  else if (animBattler === ANIM_TARGET) b = S.gBattleAnimTarget;
  else if (animBattler === ANIM_ATK_PARTNER) b = BATTLE_PARTNER(S.gBattleAnimAttacker);
  else b = BATTLE_PARTNER(S.gBattleAnimTarget);
  return IsBattlerSpritePresent(b) ? gBattlerSpriteIds[b] : SPRITE_NONE;
}
export function GetBattlerSpriteSubpriority(b) { const p = GetBattlerPosition(b); return p === 0 ? 30 : p === 2 ? 20 : p === 1 ? 40 : 50; }
export function GetBattlerSpriteBGPriority(_b) { return 2; }
export function GetBattlerSpriteBGPriorityRank(b) { const p = GetBattlerPosition(b); return p === 0 || p === 3 ? 2 : 1; }
export function GetAnimBgAttribute() { return 0; }
export function SetAnimBgAttribute() {}
export function GetBattleBgPaletteNum() { return 2; }
export function GetBattlerSpriteSpecies(b) { return S.battlers[b]?.species ?? 0; }

// Mon pseudo-sprites: gSprites[0] = player battler 0, gSprites[1] = opponent battler 1.
export function setupBattlers(battlers) {
  S.battlers = battlers;
  for (let b = 0; b < 4; b++) {
    const sp = gSprites[b];
    sp.reset();
    gBattlerSpriteIds[b] = b;
    resetVirtualPal(16 + b);
    if (!battlers[b]?.present) continue;
    sp.inUse = true; sp.isMon = true; sp.battler = b;
    sp.x = battlers[b].x; sp.y = battlers[b].picY;
    Object.assign(sp.oam, { w: 64, h: 64, affineMode: ST_OAM_AFFINE_NORMAL, objMode: 0, priority: 2, paletteNum: b, matrixNum: 28 + b });
    gOamMatrices[28 + b] = { a: 0x100, b: 0, c: 0, d: 0x100 };
    oamMatrixAlloc |= 1 << (28 + b);
    sp.subpriority = GetBattlerSpriteSubpriority(b);
    sp.data[0] = b; sp.data[2] = battlers[b].species || 0;
    CalcCenterToCornerVec(sp);
  }
  for (let p = 0; p < 16; p++) resetVirtualPal(p); // BG palettes (1..3 = battle background)
}

// ---- callbacks registry ------------------------------------------------------------------------------
// Ported C functions register here by their C names (sprite callbacks and AnimTask_/SoundTask_ functions).
export const CB = Object.create(null);
export function register(map) { for (const [k, v] of Object.entries(map)) if (typeof v === 'function') CB[k] = v; }
export function resolveCallback(name) { return typeof name === 'function' ? name : name ? CB[name] || null : null; }
// SpriteTemplate by C name (anims.json), with its callback resolved.
const tplCache = new Map();
export function T(name) {
  let t = tplCache.get(name);
  if (t) return t;
  const raw = DATA.json?.templates?.[name];
  if (!raw) throw new Error('anim: no template ' + name);
  t = { ...raw, name };
  tplCache.set(name, t);
  return t;
}
// A copy of a template with a different callback or other fields (C code often does this with a local struct)
export function withTemplate(name, fields) { return { ...T(name), ...fields }; }
export function oamData(name) { return DATA.json?.oams?.[name] || null; }

// ---- reset everything between animations ----------------------------------------------------------
export function resetEngine() {
  for (let i = 0; i < MAX_SPRITES + 1; i++) gSprites[i].reset();
  for (const t of gTasks) t.reset();
  palSlots.fill(null);
  oamMatrixAlloc = 0;
  for (let i = 0; i < 32; i++) gOamMatrices[i] = { a: 0x100, b: 0, c: 0, d: 0x100 };
  gPlttBufferUnfaded.fill(0); gPlttBufferFaded.fill(0);
  gPaletteFade.active = false;
  for (const k of Object.keys(gpuRegs)) delete gpuRegs[k];
  gBattleAnimArgs.fill(0);
  Object.assign(S, { gAnimVisualTaskCount: 0, gAnimSoundTaskCount: 0, gBattle_BG1_X: 0, gBattle_BG1_Y: 0, gBattle_BG2_X: 0, gBattle_BG2_Y: 0, gBattle_BG3_X: 0, gBattle_BG3_Y: 0, gBattle_WIN0H: 0, gBattle_WIN0V: 0, gBattle_WIN1H: 0, gBattle_WIN1V: 0, gSpriteCoordOffsetX: 0, gSpriteCoordOffsetY: 0, bgBlack: 0, moveBg: null, animBgs: { 1: null, 2: null }, frame: 0 });
}
