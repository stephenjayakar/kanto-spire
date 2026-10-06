// Poké Mart stock generation and purchasing.
import { TUNING } from './run.js';
import { D } from './data.js';
import { CONSUMABLES, BALLS, RELICS, RELIC_PRICE, VITAMIN_COMBO, APRICORN_BALLS } from './items.js';
import { regionIdOf } from './regions.js';
import { canLearn, knowsMove, canUseStone } from './pokemon.js';

export function generateShop(run, rng, opts = {}) {
  const a = run.actIndex;
  const items = [];
  if (opts.plateau) return plateauShop(run);
  const add = (kind, key, base, extra = {}) => { if (D.items[key] || kind === 'service') items.push({ kind, key, price: run.price(base), sold: false, ...extra }); };
  // Balls (unlimited stock)
  add('ball', 'POKE_BALL', BALLS.POKE_BALL.price, { stock: true });
  if (a >= 1) add('ball', 'GREAT_BALL', BALLS.GREAT_BALL.price, { stock: true });
  if (a >= 2) add('ball', 'ULTRA_BALL', BALLS.ULTRA_BALL.price, { stock: true });
  add('ball', rng.pick(['NET_BALL', 'NEST_BALL', 'TIMER_BALL', 'REPEAT_BALL', 'DIVE_BALL']), 1000, { stock: true });
  // JOHTO MARTS also stock KURT's APRICORN BALLS (1, then 2 from act 2 on)
  if (regionIdOf(run) === 'johto') for (const k of rng.sample(APRICORN_BALLS, a >= 1 ? 2 : 1)) add('ball', k, BALLS[k].price, { stock: true });
  // Medicine
  add('consumable', a >= 2 ? 'HYPER_POTION' : 'SUPER_POTION', CONSUMABLES[a >= 2 ? 'HYPER_POTION' : 'SUPER_POTION'].price, { stock: true });
  add('consumable', 'POTION', CONSUMABLES.POTION.price, { stock: true });
  add('consumable', 'REVIVE', CONSUMABLES.REVIVE.price, { stock: true });
  add('consumable', 'FULL_HEAL', CONSUMABLES.FULL_HEAL.price, { stock: true });
  for (const k of rng.sample(['X_ATTACK', 'X_SPECIAL', 'X_DEFEND', 'X_SPEED', 'DIRE_HIT', 'GUARD_SPEC', 'ESCAPE_ROPE'], 2)) add('consumable', k, CONSUMABLES[k].price);
  // Vitamins (combo level ups)
  for (const k of rng.sample(Object.keys(VITAMIN_COMBO).filter(k => !['CARBOS', 'ZINC', 'YELLOW_SHARD'].includes(k)), 2)) add('consumable', k, CONSUMABLES[k].price + 400 * (run.vitaminsBought || 0), { stock: true, vitamin: true });
  if (rng.chance(0.5)) add('consumable', 'RARE_CANDY', CONSUMABLES.RARE_CANDY.price);
  if (rng.chance(0.5)) add('consumable', 'PP_UP', CONSUMABLES.PP_UP.price);
  // Evolution stone if anyone can use one
  const stones = ['FIRE_STONE', 'WATER_STONE', 'THUNDER_STONE', 'LEAF_STONE', 'MOON_STONE', 'SUN_STONE'].filter(s => run.party.some(m => canUseStone(m.species, s)));
  if (stones.length) add('consumable', rng.pick(stones), 2100);
  // TMs
  for (const t of tmChoices(run, rng, 2)) add('tm', t.item, t.price, { move: t.move });
  // Held items
  const nRelics = TUNING.shopRelics + (run.mods().martItems || 0);
  for (const k of run.relicChoices(rng, nRelics, { common: 50, uncommon: 38, rare: 12 })) add('relic', k, RELIC_PRICE[RELICS[k].rarity]);
  // Services
  add('service', 'MOVE_DELETER', 500, { stock: true, name: 'MOVE DELETER', desc: 'Remove one copy of a move card from your deck.' });
  return { items, rerollCost: run.price(300), rerolls: 0 };
}

export function tmChoices(run, rng, n, exclude = []) {
  const tms = Object.values(D.items).filter(it => /^TM\d\d$/.test(it.key) && it.move && D.moves[it.move] && !exclude.includes(it.key));
  const ok = tms.filter(it => run.party.some(m => canLearn(m.species, it.move) && !knowsMove(m, it.move)));
  const maxPower = [80, 95, 150, 150, 150][run.actIndex] ?? 150;
  const pool = ok.filter(it => (D.moves[it.move].power || 0) <= maxPower);
  return rng.sample(pool.length ? pool : ok, n).map(it => ({ item: it.key, move: it.move, price: Math.min(4000, Math.max(1500, it.price || 3000)) }));
}

export function rerollShop(run, shop, rng) {
  if (run.money < shop.rerollCost) return false;
  run.logEvent?.({ k: 'reroll', cost: shop.rerollCost });
  run.money -= shop.rerollCost;
  shop.rerolls++;
  shop.rerollCost = run.price(300 + 150 * shop.rerolls);
  shop.items = shop.items.filter(it => !(it.kind === 'relic' || it.kind === 'tm') || it.sold);
  const listed = shop.items.map(it => it.key);
  for (const t of tmChoices(run, rng, 2, listed)) shop.items.push({ kind: 'tm', key: t.item, move: t.move, price: run.price(t.price), sold: false });
  for (const k of run.relicChoices(rng, TUNING.shopRelics + (run.mods().martItems || 0), { common: 50, uncommon: 38, rare: 12 }, listed)) shop.items.push({ kind: 'relic', key: k, price: run.price(RELIC_PRICE[RELICS[k].rarity]), sold: false });
  return true;
}

// Returns {ok, reason, pending?, bagFull?}. TMs and the move deleter need a follow-up choice in the UI.
// A full BAG never takes your money: it returns {ok: false, bagFull: true} before paying, and the UI opens
// the bag-full picker (make room, then buy again). opts.consumed: the item was used on the spot instead of
// being stored (the picker's BUY & USE), so it's paid for without needing a slot.
export function buyItem(run, shop, it, opts = {}) {
  const r = buyItemInner(run, shop, it, opts);
  if (r.ok) run.logEvent?.({ k: 'buy', kind: it.kind, item: it.key, move: it.move, price: it.price, ...(opts.consumed ? { used: true } : {}) });
  return r;
}

function buyItemInner(run, shop, it, opts) {
  if (it.sold) return { ok: false, reason: 'Sold out.' };
  if (run.money < it.price) return { ok: false, reason: "You don't have enough money." };
  if (it.kind === 'ball') { run.balls[it.key] = (run.balls[it.key] || 0) + 1; }
  else if (it.kind === 'consumable' && CONSUMABLES[it.key]?.combo) {
    run.applyConsumableToMon(it.key, null); // combo upgrades apply instantly, no bag slot needed
  } else if (it.kind === 'consumable' && opts.consumed) {
    // used right away (bag-full picker): nothing to store
  } else if (it.kind === 'consumable') {
    if (!run.addConsumable(it.key)) return { ok: false, bagFull: true, reason: `Your BAG is full! (${run.maxConsumables} items max) Make room first.` };
  } else if (it.kind === 'relic') {
    if ((shop.relicsBought || 0) >= TUNING.shopRelicBuys) return { ok: false, reason: `This MART only sells you ${TUNING.shopRelicBuys} held items per visit.` };
    if (!run.addRelic(it.key)) return { ok: false, reason: 'You already have that.' };
    shop.relicsBought = (shop.relicsBought || 0) + 1;
    it.sold = true;
  } else if (it.kind === 'tm') {
    it.sold = true;
    run.money -= it.price;
    return { ok: true, pending: { type: 'teach', move: it.move } };
  } else if (it.kind === 'service') {
    run.money -= it.price;
    return { ok: true, pending: { type: 'delete' } };
  }
  run.money -= it.price;
  if (!it.stock) it.sold = true;
  if (it.vitamin) { run.vitaminsBought = (run.vitaminsBought || 0) + 1; for (const x of shop.items) if (x.vitamin) x.price = run.price(CONSUMABLES[x.key].price) + 400 * run.vitaminsBought; }
  return { ok: true };
}

export function sellRelicValue(key) { return Math.floor(RELIC_PRICE[RELICS[key]?.rarity || 'common'] / 3); }

// The INDIGO PLATEAU mart between Elite Four rooms: only supplies for the next fight.
export function plateauShop(run) {
  const items = [];
  const add = (key, stock = true) => { if (D.items[key]) items.push({ kind: 'consumable', key, price: run.price(CONSUMABLES[key].price), sold: false, stock }); };
  ['HYPER_POTION', 'MAX_POTION', 'FULL_RESTORE', 'REVIVE', 'FULL_HEAL', 'X_ATTACK', 'X_SPECIAL', 'X_DEFEND', 'X_SPEED', 'DIRE_HIT', 'GUARD_SPEC'].forEach(k => add(k));
  return { items, rerollCost: 999999, rerolls: 0, plateau: true };
}
