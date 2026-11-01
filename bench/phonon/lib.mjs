// THROWAWAY SPIKE (LT-213). Helpers shared by the two browser renderers.
import { execFileSync } from 'node:child_process';

export const parseArgs = (argv) => Object.fromEntries(
  argv.join(' ').split('--').filter(Boolean)
    .map((s) => s.trim().split(/\s+/)).map(([k, v]) => [k, v ?? true]));

// Summed RSS (MB) of a process and all its descendants: Chrome's browser,
// renderer, GPU and utility processes together.
export function treeRssMb(root) {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=']).toString().trim().split('\n')
    .map((l) => l.trim().split(/\s+/).map(Number));
  const kids = new Map();
  for (const [pid, ppid] of rows) kids.set(ppid, [...(kids.get(ppid) ?? []), pid]);
  const rss = new Map(rows.map(([pid, , r]) => [pid, r]));
  let total = 0;
  const stack = [root];
  while (stack.length) {
    const pid = stack.pop();
    total += rss.get(pid) ?? 0;
    stack.push(...(kids.get(pid) ?? []));
  }
  return total / 1024;
}

export const loadAvg1m = () => +execFileSync('sysctl', ['-n', 'vm.loadavg']).toString().split(' ')[1];

// 16-bit PCM mono WAV.
export function wav(samples, rate) {
  const pcm = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// Warm rows exclude item one, which ran straight after the cold load.
export function summarise(rows) {
  const warm = rows.slice(1);
  return {
    warm_ttfa_median_s: warm.map((r) => r.ttfa_s).sort((a, b) => a - b)[Math.floor(warm.length / 2)],
    warm_rtf_aggregate: +(warm.reduce((a, r) => a + r.total_s, 0) / warm.reduce((a, r) => a + r.audio_s, 0)).toFixed(4),
  };
}
