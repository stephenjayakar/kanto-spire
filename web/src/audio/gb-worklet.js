// Kanto Spire - AudioWorkletProcessor for the RETRO music (Game Boy engine, gb-core.js). Loaded only once a player
// picks AUDIO: RETRO (sound.js); message routing is GbPlayer.onMessage.
import { GbPlayer } from './gb-core.js';

class GbProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.player = new GbPlayer(sampleRate, (msg) => this.port.postMessage(msg));
    this.port.onmessage = (e) => this.player.onMessage(e.data);
    this.port.postMessage({ type: 'ready' });
  }
  process(inputs, outputs) {
    const out = outputs[0];
    if (out[0]) this.player.process(out[0], out[1] || null, out[0].length);
    return true;
  }
}

registerProcessor('gb-processor', GbProcessor);
