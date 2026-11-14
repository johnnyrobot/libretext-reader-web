// Server-relative timing avoids depending on the reader's wall-clock setting.
export function createSessionTimer({ now = () => performance.now(), onWarning, onExpired }) {
  let task, deadline, warningAt, warned = false;
  function clear() {
    clearTimeout(task);
    deadline = undefined;
    warned = false;
  }
  function check() {
    clearTimeout(task);
    if (deadline === undefined) return;
    const current = now();
    if (current >= deadline) {
      clear();
      onExpired();
      return;
    }
    if (!warned && current >= warningAt) {
      warned = true;
      onWarning();
    }
    task = setTimeout(check, Math.min(2147483647, Math.max(1, (warned ? deadline : warningAt) - current)));
  }
  function update(timing, receivedAt = now()) {
    clear();
    if (!Number.isFinite(receivedAt) || !timing || !Number.isFinite(timing.serverNow) || !Number.isFinite(timing.expiresAt) ||
        !Number.isFinite(timing.warningSeconds) || timing.warningSeconds < 20) return false;
    deadline = receivedAt + timing.expiresAt - timing.serverNow;
    warningAt = deadline - timing.warningSeconds * 1000;
    check();
    return true;
  }
  return { update, check, clear };
}
