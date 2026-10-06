// Ported battle-anim callbacks (each file registers its functions with gba.js register()).
// Files are loaded independently so one missing/broken group doesn't disable the others.
const groups = ['./core.js', './elemental.js', './effects.js', './batch_a.js', './batch_b.js', './batch_c.js', './batch_d.js'];
const results = await Promise.allSettled(groups.map(g => import(g)));
results.forEach((r, i) => { if (r.status === 'rejected' && !/Failed to fetch|Cannot find module|ERR_MODULE_NOT_FOUND/.test(String(r.reason))) console.warn('anim callbacks', groups[i], r.reason); });
