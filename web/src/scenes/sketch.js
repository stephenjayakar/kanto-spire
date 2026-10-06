// Map sketches (like Slay the Spire's map drawing): right-drag on the act map draws freehand strokes to plan a
// route; the PEN button lets a plain drag draw too (touch, trackpads). Strokes live in map coordinates
// (x, screen y - scroll) so they scroll with the map, and belong to one act: { act, strokes: [[x, y, x, y, ...]] }.
// Solo they are saved with the run; in co-op each player's go to the partner (scenes/coop/session.js).
export const SKETCH_LIMITS = { strokes: 80, points: 3000, step: 3 };

// The sketch for this act (a sketch from another act counts as empty).
export function sketchFor(sk, act) { return sk && sk.act === act && Array.isArray(sk.strokes) ? sk : { act, strokes: [] }; }

// Appends a point to a stroke when the pointer moved far enough (keeps sketches small). Returns true if added.
export function addPoint(stroke, x, y) {
  const n = stroke.length;
  x = Math.round(x); y = Math.round(y);
  if (n >= 2 && Math.abs(stroke[n - 2] - x) < SKETCH_LIMITS.step && Math.abs(stroke[n - 1] - y) < SKETCH_LIMITS.step) return false;
  stroke.push(x, y);
  return true;
}

// Drops the oldest strokes beyond the limits. Mutates and returns sk.
export function trimSketch(sk) {
  let pts = sk.strokes.reduce((a, s) => a + s.length / 2, 0);
  while (sk.strokes.length > SKETCH_LIMITS.strokes || (pts > SKETCH_LIMITS.points && sk.strokes.length > 1)) pts -= sk.strokes.shift().length / 2;
  return sk;
}

// Pixel-art marker: 2x2 dots stamped along each segment (no anti-aliased canvas lines).
export function drawStrokes(ctx, strokes, color, scroll) {
  ctx.fillStyle = color;
  for (const s of strokes) {
    if (s.length === 2) { ctx.fillRect(s[0] - 1, s[1] + scroll - 1, 3, 3); continue; }
    for (let i = 2; i < s.length; i += 2) {
      const x0 = s[i - 2], y0 = s[i - 1] + scroll, x1 = s[i], y1 = s[i + 1] + scroll;
      const n = Math.max(1, Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let k = 0; k <= n; k++) ctx.fillRect(Math.round(x0 + (x1 - x0) * k / n) - 1, Math.round(y0 + (y1 - y0) * k / n) - 1, 2, 2);
    }
  }
}
