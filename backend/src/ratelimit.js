/** Fixed-window in-memory limiter. Single-instance only; use a shared store (Redis) if scaled out. */
export function createLimiter() {
  const hits = new Map();
  const timer = setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset <= now) hits.delete(k); }, 60_000);
  timer.unref();
  return {
    /** returns seconds to wait, or 0 if allowed */
    hit(key, limit, windowMs = 60_000) {
      const now = Date.now(); let e = hits.get(key);
      if (!e || e.reset <= now) { e = { n: 0, reset: now + windowMs }; hits.set(key, e); }
      e.n++;
      return e.n > limit ? Math.ceil((e.reset - now) / 1000) : 0;
    },
    stop() { clearInterval(timer); }
  };
}
