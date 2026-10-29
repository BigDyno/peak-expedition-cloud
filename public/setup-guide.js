/* PEAK organizer setup preferences. Race results remain in Cloudflare D1. */
(function(root) {
  'use strict';

  const PREFIX = 'peak_cloud_setup_v1_';
  const defaults = Object.freeze({ dismissed: true, routeReviewed: false, linkReady: false });

  function validCode(code) {
    return typeof code === 'string' && /^[A-HJ-NP-Z2-9]{8}$/.test(code);
  }

  function read(store, code) {
    if (!validCode(code)) return { ...defaults };
    try {
      const raw = store.getItem(PREFIX + code);
      const parsed = raw ? JSON.parse(raw) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...defaults };
      return {
        dismissed: typeof parsed.dismissed === 'boolean' ? parsed.dismissed : defaults.dismissed,
        routeReviewed: parsed.routeReviewed === true,
        linkReady: parsed.linkReady === true
      };
    } catch {
      return { ...defaults };
    }
  }

  function update(store, code, patch) {
    const next = read(store, code);
    for (const field of Object.keys(defaults)) {
      if (typeof patch?.[field] === 'boolean') next[field] = patch[field];
    }
    if (validCode(code)) {
      try { store.setItem(PREFIX + code, JSON.stringify(next)); }
      catch { /* Local storage is optional; never block the race. */ }
    }
    return next;
  }

  function progress(state, prefs) {
    const racers = Array.isArray(state?.players) ? state.players : [];
    const rounds = Array.isArray(state?.rounds) ? state.rounds : [];
    const done = [
      racers.length > 0,
      prefs?.routeReviewed === true || rounds.length > 0,
      rounds.length > 0,
      rounds.some(round => round?.finalized === true && Array.isArray(round.order) && round.order.length > 0),
      prefs?.linkReady === true
    ];
    return { done, count: done.filter(Boolean).length, total: done.length, complete: done.every(Boolean) };
  }

  root.PeakSetupGuide = Object.freeze({ read, update, progress });
})(globalThis);
