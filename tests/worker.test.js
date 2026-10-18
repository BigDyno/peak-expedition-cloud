import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/worker.js';

function makeEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  const DB = {
    prepare(sql) {
      let params = [];
      return {
        bind(...args) { params = args; return this; },
        async first() {
          const row = db.prepare(sql).get(...params);
          return row || null;
        },
        async run() { return db.prepare(sql).run(...params); }
      };
    }
  };
  return { DB, ASSETS: { async fetch() { return new Response('OK'); } } };
}
async function call(env, method, path, body, key) {
  const headers = new Headers({ 'Origin': 'https://peak.example' });
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (key) headers.set('Authorization', `Bearer ${key}`);
  const result = await worker.fetch(new Request(`https://peak.example${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: result.status, body: await result.json() };
}

test('race isolation, public read, organizer write, revisions, and recovery', async () => {
  const env = makeEnv();
  const first = await call(env, 'POST', '/api/races', {name:'Saturday Summit'});
  assert.equal(first.status, 201);
  assert.match(first.body.code, /^PEAK-[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(first.body.manageKey.length, 64);
  assert.equal(first.body.recoveryKey.length, 64);
  const code = first.body.code;
  let current = await call(env, 'GET', `/api/races/${code}`);
  assert.equal(current.status, 200);
  assert.equal(current.body.state.raceName, 'Saturday Summit');
  assert.equal(current.body.revision, 1);
  const raceState = structuredClone(current.body.state);
  raceState.players = [{id:'p1',name:'Alex',teamId:null}];
  const denied = await call(env, 'PUT', `/api/races/${code}/state`, { revision:1,state:raceState });
  assert.equal(denied.status,403);
  const saved = await call(env, 'PUT', `/api/races/${code}/state`, { revision:1,state:raceState }, first.body.manageKey);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.revision, 2);
  const conflict = await call(env, 'PUT', `/api/races/${code}/state`, { revision:1,state:raceState }, first.body.manageKey);
  assert.equal(conflict.status,409);
  assert.equal(conflict.body.revision, 2);
  const other = await call(env, 'POST', '/api/races', {name:'Other Group'});
  assert.equal(other.status,201);
  const otherRead = await call(env, 'GET',`/api/races/${other.body.code}`);
  assert.equal(otherRead.body.state.players.length, 0);
  const leakedAccess = await call(env,'PUT',`/api/races/${other.body.code}/state`,{revision:1,state:raceState},first.body.manageKey);
  assert.equal(leakedAccess.status,403);
  const invalid = await call(env, 'PUT', `/api/races/${code}/state`, {revision:2,state:{...raceState, scoring:[]}}, first.body.manageKey);
  assert.equal(invalid.status,422);
  const incorrect = await call(env, 'POST', `/api/races/${code}/recover`, {recoveryKey:'a'.repeat(64)});
  assert.equal(incorrect.status,403);
  const recovery = await call(env,'POST',`/api/races/${code}/recover`,{recoveryKey:first.body.recoveryKey});
  assert.equal(recovery.status,200);
  assert.notEqual(recovery.body.manageKey,first.body.manageKey);
  assert.notEqual(recovery.body.recoveryKey,first.body.recoveryKey);
  const oldDenied = await call(env,'PUT',`/api/races/${code}/state`,{revision:2,state:raceState},first.body.manageKey);
  assert.equal(oldDenied.status,403);
  const newSaved = await call(env,'PUT',`/api/races/${code}/state`,{revision:2,state:raceState},recovery.body.manageKey);
  assert.equal(newSaved.status,200);
  current = await call(env,'GET',`/api/races/${code}`);
  assert.equal(current.body.revision,3);
  assert.equal(current.body.state.players[0].name, 'Alex');
  assert.equal(current.body.manageKey,undefined);
});

test('no race key leakage and write protections', async () => {
  const env = makeEnv();
  const create = await call(env,'POST','/api/races',{name:'Private'});
  const code=create.body.code;
  const page = await worker.fetch(new Request('https://peak.example/'),env);
  assert.equal(await page.text(),'OK');
  const bad = await call(env,'GET','/api/races/PEAK-SHORT');
  assert.equal(bad.status,400);
  const missing = await call(env,'GET','/api/races/PEAK-ABCDEFGH');
  assert.equal(missing.status,404);
  const malicious = await worker.fetch(new Request(`https://peak.example/api/races/${code}/state`,{
    method:'PUT',headers:{'Origin':'https://untrusted.example','Authorization':`Bearer ${create.body.manageKey}`,'Content-Type':'application/json'},body:JSON.stringify({revision:1,state:create.body.state})
  }),env);
  assert.equal(malicious.status,403);
});
