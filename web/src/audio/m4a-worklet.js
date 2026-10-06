// Kanto Spire - AudioWorkletProcessor wrapping the m4a driver core (m4a-core.js).
// Main-thread API lives in sound.js; message routing is EngineHost (shared with the
// ScriptProcessor fallback), this file just binds it to the worklet port and render quanta.
import { EngineHost } from './m4a-core.js';

class M4AProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // `sampleRate` is a global of AudioWorkletGlobalScope
    this.host = new EngineHost((msg) => this.port.postMessage(msg), sampleRate);
    this.port.onmessage = (e) => this.host.onMessage(e.data);
  }
  process(inputs, outputs) {
    const out = outputs[0];
    if (out[0]) this.host.process(out[0], out[1], out[0].length);
    return true;
  }
}

registerProcessor('m4a-processor', M4AProcessor);
