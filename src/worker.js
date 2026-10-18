/** PEAK Cloud — Cloudflare Worker + D1. Public reads, secret-token organizer writes. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LIMIT = 350_000;
const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
}
function failure(message, status = 400, details = {}) {
  return reply({ error: message, ...details }, status);
}
function randString(length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}
function randomKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
async function sha256(secret) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
function raceCode(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/^PEAK-/, '');
  return /^[A-HJ-NP-Z2-9]{8}$/.test(normalized) ? normalized : null;
}
function parseBearer(req) {
  const match = /^Bearer ([a-f0-9]{64})$/i.exec(req.headers.get('Authorization') || '');
  return match ? match[1].toLowerCase() : null;
}
async function jsonBody(request, max = LIMIT) {
  const length = Number(request.headers.get('content-length'));
  if (length > max) throw Object.assign(new Error('Request exceeds allowed size'), { status: 413 });
  const text = await request.text();
  if (new TextEncoder().encode(text).length > max) throw Object.assign(new Error('Request exceeds allowed size'), { status: 413 });
  try { return JSON.parse(text); }
  catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }); }
}
function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return 'Race state must be an object';
  if (!Array.isArray(state.players) || state.players.length > 300) return 'Invalid racers list (maximum 300)';
  if (!Array.isArray(state.teams) || state.teams.length > 100) return 'Invalid teams list (maximum 100)';
  if (!Array.isArray(state.rounds) || state.rounds.length > 250) return 'Invalid campfires list (maximum 250)';
  if (!Array.isArray(state.scoring) || state.scoring.length < 1 || state.scoring.length > 100 || state.scoring.some((n) => !Number.isInteger(n) || n < 0 || n > 100)) return 'Invalid scoring positions';
  if (typeof state.raceName !== 'string' || !state.raceName.trim() || state.raceName.length > 80) return 'Invalid race name';
  const unique = (items) => new Set(items.map((item) => item.id)).size === items.length;
  const validItem = (x) => x && typeof x === 'object' && typeof x.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(x.id) && typeof x.name === 'string' && x.name.length <= 90;
  if (!state.players.every(validItem) || !unique(state.players)) return 'Invalid or duplicate racer IDs';
  if (!state.teams.every((t) => validItem(t) && /^#[0-9a-fA-F]{6}$/.test(t.color)) || !unique(state.teams)) return 'Invalid team IDs or colors';
  if (!state.rounds.every((r) => validItem(r) && typeof r.finalized === 'boolean' && (!r.note || (typeof r.note === 'string' && r.note.length <= 500)) && Array.isArray(r.order) && r.order.length <= 300)) return 'Invalid campfire records';
  if (!unique(state.rounds)) return 'Duplicate campfire IDs';
  const playerIds = new Set(state.players.map((p) => p.id));
  const teamIds = new Set(state.teams.map((t) => t.id));
  if (state.players.some((p) => p.teamId && !teamIds.has(p.teamId))) return 'Unknown racer team';
  for (const round of state.rounds) {
    if (!Array.isArray(round.order) || round.order.some((o) => !o || !playerIds.has(o.id) || typeof o.ghost !== 'boolean')) return 'Invalid campfire placements';
    if (new Set(round.order.map((o) => o.id)).size !== round.order.length) return 'Duplicate racer within campfire';
  }
  return null;
}
function defaultState(name) {
  return { version: 5, raceName: name, players: [], teams: [], rounds: [], scoring: [4, 3, 2, 1], appMode: 'individual', updatedAt: new Date().toISOString() };
}
function sameOrigin(req) {
  const origin = req.headers.get('Origin');
  return !origin || origin === new URL(req.url).origin;
}
async function rateLimitCreate(env, req) {
  const day = new Date().toISOString().slice(0, 10);
  const source = req.headers.get('CF-Connecting-IP') || 'local';
  const id = await sha256(`${day}:${source}`);
  const updated = await env.DB.prepare(`INSERT INTO create_limits (bucket, usage_count) VALUES (?, 1)
      ON CONFLICT(bucket) DO UPDATE SET usage_count=usage_count+1 WHERE usage_count < 20
      RETURNING usage_count`).bind(`${day}:${id}`).first();
  return !!updated;
}
async function createRace(req, env) {
  if (!(await rateLimitCreate(env, req))) return failure('Daily race-creation limit reached. Try tomorrow.', 429);
  const input = await jsonBody(req, 5000);
  const name = String(input?.name || 'The Great Climb').trim().slice(0, 80) || 'The Great Climb';
  const manageKey = randomKey();
  const recoveryKey = randomKey();
  const manageHash = await sha256(manageKey);
  const recoveryHash = await sha256(recoveryKey);
  const initialState = defaultState(name);
  const initialJson = JSON.stringify(initialState);
  let code;
  for (let attempts = 0; attempts < 8; attempts++) {
    code = randString(8);
    try {
      await env.DB.prepare(`INSERT INTO races (code, title, state_json, revision, manage_hash, recovery_hash, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?)`).bind(code, name, initialJson, manageHash, recoveryHash, new Date().toISOString(), new Date().toISOString()).run();
      return reply({ code: `PEAK-${code}`, revision: 1, state: initialState, manageKey, recoveryKey }, 201);
    } catch (err) {
      if (!String(err.message || '').includes('UNIQUE')) throw err;
    }
  }
  return failure('Could not allocate a unique race code. Please retry.', 503);
}
async function findRace(env, code) {
  return env.DB.prepare('SELECT * FROM races WHERE code = ?').bind(code).first();
}
async function checkOrganizer(req, row) {
  const key = parseBearer(req);
  return !!key && (await sha256(key)) === row.manage_hash;
}
async function getRace(env, code) {
  const row = await findRace(env, code);
  if (!row) return failure('Race code not found', 404);
  return reply({ code: `PEAK-${code}`, revision: row.revision, state: JSON.parse(row.state_json), updatedAt: row.updated_at });
}
async function putRace(req, env, code) {
  const row = await findRace(env, code);
  if (!row) return failure('Race code not found', 404);
  if (!(await checkOrganizer(req, row))) return failure('Organizer key is required to edit this race', 403);
  const body = await jsonBody(req);
  const revision = body?.revision;
  const state = body?.state;
  if (!Number.isInteger(revision) || revision < 1) return failure('Revision is required');
  const validation = validateState(state);
  if (validation) return failure(validation, 422);
  const now = new Date().toISOString();
  const stored = await env.DB.prepare(`UPDATE races SET state_json = ?, title = ?, revision = revision + 1, updated_at = ?
    WHERE code = ? AND revision = ? AND manage_hash = ? RETURNING revision`)
    .bind(JSON.stringify(state), state.raceName, now, code, revision, row.manage_hash).first();
  if (!stored) {
    const current = await findRace(env, code);
    return failure('Race was updated on another device. Save rejected to protect newer results.', 409, { revision: current?.revision });
  }
  return reply({ ok: true, revision: stored.revision, updatedAt: now });
}
async function rotateKeys(req, env, code, type) {
  const row = await findRace(env, code);
  if (!row) return failure('Race code not found', 404);
  let authorized = false;
  if (type === 'rotate') authorized = await checkOrganizer(req, row);
  else {
    const input = await jsonBody(req, 5000);
    if (typeof input?.recoveryKey === 'string' && /^[0-9a-f]{64}$/i.test(input.recoveryKey)) {
      authorized = (await sha256(input.recoveryKey.toLowerCase())) === row.recovery_hash;
    }
  }
  if (!authorized) return failure('Invalid organizer or recovery key', 403);
  const manageKey = randomKey();
  const recoveryKey = randomKey();
  const newManageHash = await sha256(manageKey);
  const newRecoveryHash = await sha256(recoveryKey);
  // Compare the previous hash as well: concurrent rotations cannot revive old credentials.
  const matchingHash = type === 'rotate' ? row.manage_hash : row.recovery_hash;
  const column = type === 'rotate' ? 'manage_hash' : 'recovery_hash';
  const updated = await env.DB.prepare(`UPDATE races SET manage_hash=?, recovery_hash=? WHERE code=? AND ${column}=? RETURNING code`)
    .bind(newManageHash, newRecoveryHash, code, matchingHash).first();
  if (!updated) return failure('Keys were changed from another device. Try again.', 409);
  return reply({ code: `PEAK-${code}`, manageKey, recoveryKey });
}
export default {
  async fetch(request, env) {
    try {
      const { pathname } = new URL(request.url);
      if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
      if (!env.DB) return failure('Database binding is not configured', 503);
      if (!sameOrigin(request) && request.method !== 'GET') return failure('Cross-origin writes are not allowed', 403);
      if (pathname === '/api/health' && request.method === 'GET') {
        const result = await env.DB.prepare('SELECT 1 AS ok').first();
        return reply({ ok: result?.ok === 1, service: 'PEAK Cloud' });
      }
      if (pathname === '/api/races' && request.method === 'POST') return createRace(request, env);
      const parts = /^\/api\/races\/([a-zA-Z0-9-]+)(?:\/(state|recover|rotate))?$/.exec(pathname);
      if (!parts) return failure('API endpoint not found', 404);
      const code = raceCode(parts[1]);
      if (!code) return failure('Invalid race code', 400);
      if (request.method === 'GET' && !parts[2]) return getRace(env, code);
      if (request.method === 'PUT' && parts[2] === 'state') return putRace(request, env, code);
      if (request.method === 'POST' && ['recover', 'rotate'].includes(parts[2])) return rotateKeys(request, env, code, parts[2]);
      return failure('Method not allowed', 405);
    } catch (error) {
      if (error.status) return failure(error.message, error.status);
      console.error('PEAK Worker error:', error);
      return failure('Unexpected server error. Try again shortly.', 500);
    }
  }
};
