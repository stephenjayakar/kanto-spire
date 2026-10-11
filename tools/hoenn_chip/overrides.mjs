// Hoenn chiptune: hand-tuning for the automatic conversion (m4a2gsc.mjs). Per song and Game Boy channel, an ordered
// list of rules { track, bars: [first, last] (optional, inclusive, 96-tick bars from the song's start) }: the first
// rule whose Emerald track has notes in the bar (and isn't already on pulse 1) feeds the channel; no match = the
// automatic pick. Chosen by ear-proxy analysis of which Emerald track carries the tune bar by bar (the automatic pick
// wandered to accompaniment lines in these bars).
export const OVERRIDES = {
  // the melody is track 1 throughout; track 0 is the counter-line, track 3's square part takes over in bars 38-41
  mus_vs_wild: { 1: [{ track: 1 }], 2: [{ track: 3, bars: [38, 41] }, { track: 0 }] },
  // melody on track 1 wherever it plays; the second voice alternates between track 0 and track 3's square part
  mus_vs_gym_leader: {
    1: [{ track: 1 }],
    2: [{ track: 3, bars: [22, 24] }, { track: 3, bars: [30, 33] }, { track: 3, bars: [54, 61] }, { track: 0 }],
  },
  // the second voice is track 3's square part in these sections (the automatic pick kept the piano chords)
  mus_vs_trainer: { 2: [{ track: 3, bars: [33, 38] }, { track: 3, bars: [54, 73] }] },
};
