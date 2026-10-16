// Sinnoh chiptune: hand-tuning for the automatic conversion (tools/hoenn_chip/m4a2gsc.mjs), per Platinum song.
// Chosen from an objective comparison of each Game Boy render against a reference render of the DS original (chroma,
// onset and pitch-class profile correlation; nobody listened), by looking at which SSEQ track carries the tune.
//   overrides: m4a2gsc's per-channel rules ({ 1: [{ track, bars? }], 2: [...] }: the first rule whose track has notes
//              in the bar feeds that pulse channel; no match = the automatic pick)
//   wave:      the wave sample for the whole song (engine_bank.mjs WAVE_NAMES index): 10 = triangleQuiet, for songs whose
//              bass line drowned the pulses (measured: the render's key profile shifted to the bass's root)
//   bass:      tracks whose notes are the song's bass line although their voice isn't a bass (they go to the wave channel)
// Track numbers are the SSEQ's own (sseq_trace.mjs `track`).
export const SINNOH_OVERRIDES = {
  // the trumpet lead (track 2) is the tune; the automatic pick took the loud, high e-piano arpeggio on track 7
  SEQ_ROAD_C_D: { overrides: { 1: [{ track: 2 }] } },
  SEQ_ROAD_C_N: { overrides: { 1: [{ track: 2 }] } },
  // the piano figure (tracks 2, then 1) over the 3-note string pad on track 7
  SEQ_D_03: { overrides: { 1: [{ track: 2 }, { track: 1 }] } },
  // the night version's bass line is a mid-register string part
  SEQ_TOWN03_N: { bass: [7] },
  // a loud bass line over quiet piano / pulses
  SEQ_CITY10_D: { wave: 10 }, SEQ_CITY10_N: { wave: 10 }, SEQ_KENKYUJO: { wave: 10 }, SEQ_WINTGYM: { wave: 10 },
  SEQ_EYE_SPORT: { wave: 10 }, SEQ_ROAD_F_N: { wave: 10 },
};
