import { describe, it, expect, vi, afterEach } from "vitest";
import { createSessionTimer } from "../src/session-timer.mjs";

afterEach(() => vi.useRealTimers());
describe("server-relative session timing", () => {
  it("warns five minutes before expiry despite a different local wall clock", () => {
    vi.useFakeTimers();
    const warn = vi.fn(), expire = vi.fn();
    const timer = createSessionTimer({ now: () => Date.now(), onWarning: warn, onExpired: expire });
    timer.update({ serverNow: 1000, expiresAt: 601000, warningSeconds: 300 });
    vi.advanceTimersByTime(299999);
    expect(warn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(warn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(300000);
    expect(expire).toHaveBeenCalledTimes(1);
  });
  it("rechecks elapsed time after background suspension and cancels stale timers", () => {
    vi.useFakeTimers();
    let now = 0;
    const warn = vi.fn(), expire = vi.fn();
    const timer = createSessionTimer({ now: () => now, onWarning: warn, onExpired: expire });
    timer.update({ serverNow: 0, expiresAt: 600000, warningSeconds: 300 });
    now = 700000;
    timer.check();
    expect(expire).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    timer.update({ serverNow: 100, expiresAt: 28800100, warningSeconds: 300 });
    timer.clear();
    now += 30000000;
    timer.check();
    expect(expire).toHaveBeenCalledTimes(1);
  });
  it("rejects missing or invalid timing without scheduling a misleading countdown", () => {
    const timer = createSessionTimer({ onWarning: vi.fn(), onExpired: vi.fn() });
    expect(timer.update({ expiresAt: NaN })).toBe(false);
  });
  it("does not add thread-loading delay to the server deadline", () => {
    vi.useFakeTimers();
    const warn = vi.fn();
    const timer = createSessionTimer({ now: () => Date.now(), onWarning: warn, onExpired: vi.fn() });
    const receivedAt = Date.now();
    vi.advanceTimersByTime(120000);
    timer.update({ serverNow: 1000, expiresAt: 601000, warningSeconds: 300 }, receivedAt);
    vi.advanceTimersByTime(180000);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
