import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/setup-guide.js';

const {read, update, progress} = globalThis.PeakSetupGuide;
function store() {
  const values = new Map();
  return { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v) };
}
const empty = {players:[],rounds:[]};

test('new race has no setup milestones and guide is initially dismissible', () => {
  const data = read(store(), 'ABCDEFGH');
  assert.equal(data.dismissed,true);
  assert.deepEqual(progress(empty,data).done,[false,false,false,false,false]);
});

test('race-specific setup progress stays separate', () => {
  const storage = store();
  update(storage,'ABCDEFGH',{dismissed:false,routeReviewed:true});
  assert.equal(read(storage,'ABCDEFGH').routeReviewed,true);
  assert.equal(read(storage,'BCDEFGHJ').routeReviewed,false);
  assert.equal(read(storage,'ABCDEFGH').dismissed,false);
});

test('the guide detects racers, draft campfires and finalized scores', () => {
  const racers = [{id:'a',name:'Climber'}];
  const draft = {finalized:false,order:[{id:'a',ghost:false}]};
  assert.deepEqual(progress({players:racers,rounds:[draft]},{}).done,[true,true,true,false,false]);
  assert.deepEqual(progress({players:racers,rounds:[{...draft,finalized:true}]},{linkReady:true}).done,[true,true,true,true,true]);
});

test('marking shared does not require race mutations', () => {
  const storage = store();
  update(storage,'ABCDEFGH',{linkReady:true});
  assert.deepEqual(progress(empty,read(storage,'ABCDEFGH')).done,[false,false,false,false,true]);
});

test('dismissal can be reversed and other preferences remain', () => {
  const storage = store();
  update(storage,'ABCDEFGH',{routeReviewed:true,dismissed:false});
  update(storage,'ABCDEFGH',{dismissed:true});
  assert.deepEqual(read(storage,'ABCDEFGH'),{dismissed:true,routeReviewed:true,linkReady:false});
  update(storage,'ABCDEFGH',{dismissed:false});
  assert.equal(read(storage,'ABCDEFGH').dismissed,false);
});

test('does not trust invalid or corrupt stored values', () => {
  const storage = store();
  storage.setItem('peak_cloud_setup_v1_ABCDEFGH','{broken');
  assert.equal(read(storage,'ABCDEFGH').routeReviewed,false);
  assert.equal(read(storage,'invalid').dismissed,true);
});

test('storage failure never breaks the guide', () => {
  const broken={getItem(){throw Error('disabled')},setItem(){throw Error('disabled')}};
  assert.doesNotThrow(()=>update(broken,'ABCDEFGH',{routeReviewed:true}));
  assert.equal(read(broken,'ABCDEFGH').routeReviewed,false);
});
