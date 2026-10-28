import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/peakmap-schedule.js';

const { parseSchedule, rotationKey } = globalThis.PeakMapSchedule;
const current = {
  StartDate: '24-10-2026', StartLevel: 'Level_81',
  LevelBiomes: {
    Level_81: ['Shore', 'Roots', 'Mesa', 'Swamp'],
    Level_82: ['Shore', 'Tropics', 'Mesa', 'Volcano'],
    Level_83: ['Shore', 'Tropics', 'Alpine', 'Swamp'],
    Level_84: ['Shore', 'Roots', 'Mesa', 'Volcano']
  }
};

test('parses the current level-based format', () => {
  const dates = parseSchedule(current, new Date('2026-10-26T19:00:00Z'));
  assert.deepEqual(Object.keys(dates).sort(), ['24-10-2026','25-10-2026','26-10-2026','27-10-2026'].sort());
  assert.deepEqual(dates['26-10-2026'], {level:'Level_83',biomes:['Shore','Tropics','Alpine','Swamp']});
});

test('preserves the previous DayLevels format', () => {
  const dates = parseSchedule({DayLevels:{'26-10-2026':{Level:'Level_83',Biomes:['Shore','Swamp']}}});
  assert.deepEqual(dates['26-10-2026'], {level:'Level_83',biomes:['Shore','Swamp']});
});

test('rotation rolls over at 17:00 UTC', () => {
  assert.equal(rotationKey(new Date('2026-10-26T16:59:59Z')), '25-10-2026');
  assert.equal(rotationKey(new Date('2026-10-26T17:00:00Z')), '26-10-2026');
});

test('never invents maps for unpublished level records', () => {
  const dates = parseSchedule(current, new Date('2026-10-28T20:00:00Z'));
  assert.equal(dates['28-10-2026'], undefined);
  assert.equal(dates['27-10-2026'].level, 'Level_84');
});

test('wraps from level 207 to 0 and then 1', () => {
  const dates = parseSchedule({
    StartDate:'24-10-2026', StartLevel:'Level_207',
    LevelBiomes:{Level_207:['Shore'],Level_0:['Roots'],Level_1:['Mesa']}
  }, new Date('2026-10-26T20:00:00Z'));
  assert.equal(dates['24-10-2026'].level, 'Level_207');
  assert.equal(dates['25-10-2026'].level, 'Level_0');
  assert.equal(dates['26-10-2026'].level, 'Level_1');
});

test('reuses published levels after 208 days', () => {
  const now = new Date(Date.UTC(2026, 9, 24 + 208, 20));
  assert.equal(parseSchedule(current, now)[rotationKey(now)].level, 'Level_81');
});

test('rejects malformed and empty schedule data', () => {
  assert.throws(() => parseSchedule({}), /Unexpected/);
  assert.throws(() => parseSchedule({DayLevels:{}}), /No supported/);
  assert.throws(() => parseSchedule({...current,StartDate:'31-2-2026'}), /Unexpected/);
});

test('ignores bad individual level entries', () => {
  const dates = parseSchedule({
    ...current,LevelBiomes:{Level_83:['Shore'],Level_85:[17],Level_9999:['Bad']}
  },new Date('2026-10-26T19:00:00Z'));
  assert.deepEqual(Object.keys(dates),['26-10-2026']);
});
