// Which co-op backend the scenes talk to.
// Hosted build (Cloud.url set): the real Convex client, net/coopnet.js.
// Local unbuilt game with ?coopdev (no Cloud.url): an in-browser fake server (mocknet.js) shared by the
// tabs of this origin through localStorage, so two tabs can play a room together offline. Without the
// flag nothing here is ever loaded.
import { Cloud } from '../../net/cloud.js';

export function coopDevFlag() {
  try { return typeof location !== 'undefined' && new URLSearchParams(location.search).has('coopdev'); } catch { return false; }
}
// Show the CO-OP entry point on the title screen?
export function coopAvailable() { return !!Cloud.url || coopDevFlag(); }

let netP = null;
export function loadNet() {
  netP ??= (Cloud.url ? import('../../net/coopnet.js') : coopDevFlag() ? import('./mocknet.js') : Promise.reject(new Error('Co-op needs the online build.')));
  return netP;
}
