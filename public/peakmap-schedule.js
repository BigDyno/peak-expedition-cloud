/* Parse the legacy dated PeakMap feed and the 208-map level rotation feed.
   This only supplies read-only map metadata; it never changes race results. */
(function (root) {
  'use strict';

  const DAY_MS = 86400000;
  const ROTATION_LENGTH = 208;
  const CYCLE_MS = ROTATION_LENGTH * DAY_MS;

  function dayMs(key) {
    const match = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(String(key));
    if (!match) return null;
    const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
    if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const result = Date.UTC(year, month - 1, day);
    const parsed = new Date(result);
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? result : null;
  }

  function keyFromMs(ms) {
    const date = new Date(ms);
    return `${date.getUTCDate()}-${date.getUTCMonth() + 1}-${date.getUTCFullYear()}`;
  }

  function rotationKey(now = new Date()) {
    const current = new Date(now);
    if (!Number.isFinite(current.getTime())) throw new Error('Invalid rotation clock');
    if (current.getUTCHours() < 17) current.setUTCDate(current.getUTCDate() - 1);
    return keyFromMs(current.getTime());
  }

  function biomesFrom(input) {
    if (!Array.isArray(input) || !input.length ||
        !input.every(v => typeof v === 'string' && v.trim().length)) return null;
    return input.slice(0, 12).map(v => v.trim().slice(0, 40));
  }

  function parseSchedule(data, now = new Date()) {
    if (!data || typeof data !== 'object') throw new Error('Unexpected PeakMap schedule format');

    // Previous format: {DayLevels: {"24-10-2026": {Level, Biomes}}}
    if (data.DayLevels && typeof data.DayLevels === 'object' && !Array.isArray(data.DayLevels)) {
      const dates = {};
      for (const [key, value] of Object.entries(data.DayLevels)) {
        if (dayMs(key) === null || !value || typeof value !== 'object') continue;
        const biomes = biomesFrom(value.Biomes);
        if (biomes) dates[key] = { level: String(value.Level || ''), biomes };
      }
      if (!Object.keys(dates).length) throw new Error('No supported map rotations in response');
      return dates;
    }

    // New format: {StartDate, StartLevel, LevelBiomes: {Level_81: ['Shore', ...]}}
    const startMs = dayMs(data.StartDate);
    const startMatch = /^Level_(\d+)$/.exec(String(data.StartLevel || ''));
    if (startMs === null || !startMatch || !data.LevelBiomes ||
        typeof data.LevelBiomes !== 'object' || Array.isArray(data.LevelBiomes)) {
      throw new Error('Unexpected PeakMap schedule format');
    }
    const startLevel = Number(startMatch[1]);
    if (!Number.isInteger(startLevel) || startLevel < 0 || startLevel >= ROTATION_LENGTH) {
      throw new Error('Invalid PeakMap starting level');
    }

    const todayMs = dayMs(rotationKey(now));
    // Limit the picker to recent and near-future dates. Never invent data
    // for levels that are absent from the publisher's LevelBiomes collection.
    const oldestMs = Math.max(startMs, todayMs - 31 * DAY_MS);
    const newestMs = Math.max(startMs, todayMs) + 14 * DAY_MS;
    const dates = {};
    let bestPast = null, nearestFuture = null;

    for (const [level, value] of Object.entries(data.LevelBiomes)) {
      const levelMatch = /^Level_(\d+)$/.exec(level);
      if (!levelMatch) continue;
      const number = Number(levelMatch[1]);
      if (!Number.isInteger(number) || number < 0 || number >= ROTATION_LENGTH) continue;
      const biomes = biomesFrom(value);
      if (!biomes) continue;

      const offset = (number - startLevel + ROTATION_LENGTH) % ROTATION_LENGTH;
      const firstMs = startMs + offset * DAY_MS;
      const record = { level, biomes };
      let occurrenceMs = firstMs;
      if (firstMs <= todayMs) {
        occurrenceMs += Math.floor((todayMs - firstMs) / CYCLE_MS) * CYCLE_MS;
      }
      if (occurrenceMs <= todayMs && (!bestPast || occurrenceMs > bestPast.ms)) {
        bestPast = { ms: occurrenceMs, record };
      }
      const nextMs = occurrenceMs <= todayMs ? occurrenceMs + CYCLE_MS : occurrenceMs;
      if (!nearestFuture || nextMs < nearestFuture.ms) nearestFuture = { ms: nextMs, record };

      let day = firstMs;
      if (day < oldestMs) day += Math.ceil((oldestMs - day) / CYCLE_MS) * CYCLE_MS;
      for (; day <= newestMs; day += CYCLE_MS) dates[keyFromMs(day)] = record;
    }

    // If the source is behind today's rotation, offer the most recent dated
    // record rather than falsely labeling it as today's map.
    if (!Object.keys(dates).length) {
      const fallback = bestPast || nearestFuture;
      if (fallback) dates[keyFromMs(fallback.ms)] = fallback.record;
    }
    if (!Object.keys(dates).length) throw new Error('No supported map rotations in response');
    return dates;
  }

  root.PeakMapSchedule = Object.freeze({ parseSchedule, rotationKey });
})(globalThis);
