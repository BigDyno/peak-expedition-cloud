import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/peakmap-campfires.js';

const {fromBiomes} = globalThis.PeakMapCampfires;

test('Swamp routes append The Citadel after the fourth biome', () => {
  const input = ['Shore','Roots','Mesa','Swamp'];
  const result = fromBiomes(input);
  assert.equal(result.length, 5);
  assert.equal(result[3].campfireName, 'Swamp Campfire');
  assert.equal(result[4].campfireName, 'The Citadel');
  assert.equal(result[4].isFinalCampfire, true);
  assert.deepEqual(input,['Shore','Roots','Mesa','Swamp']);
});

test('Volcano routes append The Kiln', () => {
  const result = fromBiomes(['Shore','Tropics','Alpine','Volcano']);
  assert.equal(result.length, 5);
  assert.equal(result[4].campfireName,'The Kiln');
  assert.equal(result[4].isFinalCampfire,true);
});

test('unrelated biomes stay unchanged', () => {
  assert.equal(fromBiomes(['Shore','Roots','Mesa']).length,3);
});

test('missing or invalid rotation data produces no invented campfires', () => {
  assert.deepEqual(fromBiomes(null),[]);
  assert.deepEqual(fromBiomes([]),[]);
});

test('does not duplicate a finale provided by upstream data', () => {
  assert.equal(fromBiomes(['Swamp','The Citadel']).length,2);
  assert.equal(fromBiomes(['Volcano','The Kiln']).length,2);
});

test('case and whitespace in ending biome are handled', () => {
  assert.equal(fromBiomes(['Shore',' swamp ']).at(-1).campfireName,'The Citadel');
  assert.equal(fromBiomes(['Shore',' volcano ']).at(-1).campfireName,'The Kiln');
});
