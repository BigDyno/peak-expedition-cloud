/* PEAK Cloud — Cloudflare Workers + D1 edition. No API secrets in browser. */
(() => {
  'use strict';

  const API_BASE = '/api/races';
  const PREVIOUS = ['peak_tracker_state_v2','peak_tracker_state','peak_analytics_state','peak_analytics_v2_state','peak_state'];
  const VAULT_PREFIX = 'peak_cloud_vault_';
  const COLORS = ['#c5f277','#77bdeb','#fa9266','#b6a2f4','#efb76d','#78d4c1','#f090b5','#c8d2dd'];
  const params = new URLSearchParams(location.search);
  const viewMode = params.get('view');
  const rawRaceCode = (params.get('race') || '').trim().toUpperCase().replace(/^PEAK-/, '');
  let raceCode = /^[A-HJ-NP-Z2-9]{8}$/.test(rawRaceCode) ? rawRaceCode : '';
  const hashKey = /^#key=([a-f0-9]{64})$/i.exec(location.hash)?.[1]?.toLowerCase();
  const tokenSlot = (code) => `peak_organizer_${code}`;
  let manageKey = raceCode ? (hashKey || sessionStorage.getItem(tokenSlot(raceCode)) || '') : '';
  if (!/^[a-f0-9]{64}$/.test(manageKey)) manageKey = '';
  if (raceCode && manageKey) sessionStorage.setItem(tokenSlot(raceCode), manageKey);
  let revision = 0;
  let conflict = false;
  const localKey = () => `peak_cloud_race_${raceCode}`;
  const vaultKey = () => `${VAULT_PREFIX}${raceCode}`;
  const publicLink = () => `${location.origin}${location.pathname}?race=PEAK-${raceCode}&view=spectator`;
  const manageLink = () => `${location.origin}${location.pathname}?race=PEAK-${raceCode}#key=${manageKey}`;
  const apiForRace = () => `${API_BASE}/${raceCode}`;

  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const id = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const hash = (x) => JSON.stringify(x);

  const fresh = () => ({
    version: 5,
    players: [],
    teams: [],
    rounds: [],
    scoring: [4,3,2,1],
    appMode: 'individual',
    raceName: 'The Great Climb',
    updatedAt: null
  });

  let state = fresh();
  let page = raceCode ? (viewMode === 'podium' ? 'podium' : 'overview') : 'welcome';
  let navigationHistory = [];
  let spectator = !manageKey || viewMode === 'spectator' || viewMode === 'podium';
  let podiumPresentation = viewMode === 'podium';
  let dirty = false;
  let edit = 0;
  let saving = false;
  let syncTimer = null;
  let refreshing = false;
  let cloudReady = false;
  let undo = [];
  let redo = [];
  let toastTimer = null;
  let dragState = null;
  // PeakMap integration is read-only until a user explicitly creates campfires.
  const PEAKMAP_DATA = 'https://qwojtpl.github.io/PeakMap/WebApp/data/info.json';
  const PEAKMAP_APP = 'https://qwojtpl.github.io/PeakMap/WebApp/';
  let mapIndex = null;
  let mapError = '';
  let mapLoading = false;
  let mapDate = null;
  let mapFetched = null;
  function rotationKey(date = new Date()) {
    const d = new Date(date.getTime());
    if (d.getUTCHours() < 17) d.setUTCDate(d.getUTCDate() - 1);
    return `${d.getUTCDate()}-${d.getUTCMonth() + 1}-${d.getUTCFullYear()}`;
  }
  function mapDateText(key) {
    const parts = String(key).split('-').map(Number);
    if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return key;
    return new Date(Date.UTC(parts[2], parts[1]-1, parts[0])).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
  }
  function mapDateSort(key) {const p=key.split('-').map(Number);return Date.UTC(p[2],p[1]-1,p[0]);}
  async function getPeakMap(force = false) {
    if (mapLoading || (mapIndex && !force)) return;
    mapLoading = true; mapError = '';
    if (page === 'map') render();
    try {
      const res = await fetch(`${PEAKMAP_DATA}?t=${Date.now()}`, {cache:'no-store'});
      if (!res.ok) throw new Error(`Map source HTTP ${res.status}`);
      const json = await res.json();
      if (!json?.DayLevels || typeof json.DayLevels !== 'object') throw new Error('Unexpected map schedule format');
      const parsed = Object.fromEntries(Object.entries(json.DayLevels).filter(([k,v])=>/^\d{1,2}-\d{1,2}-\d{4}$/.test(k)&&Array.isArray(v?.Biomes)&&v.Biomes.every(b=>typeof b==='string')).map(([k,v])=>[k,{level:String(v.Level||''),biomes:v.Biomes.slice(0,12).map(b=>b.slice(0,40))}]));
      if (!Object.keys(parsed).length) throw new Error('No supported map rotations in response');
      mapIndex = parsed; mapFetched = new Date();
      if (!mapDate) mapDate = rotationKey();
      if (!mapIndex[mapDate] && mapIndex[rotationKey()]) mapDate = rotationKey();
      if (!mapIndex[mapDate]) { mapDate = Object.keys(mapIndex).sort((a,b)=>mapDateSort(b)-mapDateSort(a))[0]; mapError = 'No schedule for the current rotation. Showing the most recent published date instead.'; }
    } catch (err) {
      mapError = `Unable to load PeakMap schedule: ${err.message}. You can still score campfires manually.`;
    } finally {mapLoading = false; if(page === 'map') render();}
  }


  const people = () => state.players;
  const teams = () => state.teams;
  const completed = () => state.rounds.filter((r) => r.finalized);
  const orderedRounds = () => [...state.rounds].reverse();
  const player = (pid) => state.players.find((p) => p.id === pid);
  const team = (tid) => state.teams.find((t) => t.id === tid);
  const color = (x, i = 0) => x?.color || COLORS[i % COLORS.length];
  const raceComplete = () => state.rounds.length > 0 && state.rounds.every((r) => r.finalized);
  function biomeEmoji(label) {
    const names = { shore:'🏖️', tropics:'🌴', alpine:'🏔️', swamp:'🐸', mesa:'🏜️', caldera:'🌋', roots:'🌳', kiln:'🔥', citadel:'🏰', volcano:'🔥' };
    const raw = String(label || '').trim().replace(/^[^\p{L}\p{N}]+/u, '').trim();
    const match = Object.keys(names).find((b) => raw.toLowerCase() === b || raw.toLowerCase().startsWith(`${b} campfire`));
    return `${names[match] || '⛰️'} ${raw}`;
  }

  function normalize(src) {
    if (src?.record && typeof src.record === 'object') src = src.record;
    if (!src || typeof src !== 'object' || !Array.isArray(src.players) || !Array.isArray(src.rounds)) {
      throw new Error('Unexpected cloud response: no PEAK race data found');
    }

    const x = { ...fresh(), ...src };
    x.players = x.players.map((p) => ({
      id: String(p.id || id()),
      name: String(p.name || 'Racer').slice(0, 60),
      teamId: p.teamId || null
    }));

    x.teams = Array.isArray(x.teams)
      ? x.teams.map((t, i) => ({
          id: String(t.id || id()),
          name: String(t.name || 'Team').slice(0, 60),
          color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : COLORS[i % COLORS.length]
        }))
      : [];

    x.scoring = Array.isArray(x.scoring) && x.scoring.length >= 1 && x.scoring.length <= 100 && x.scoring.every((n) => Number.isInteger(n) && n >= 0 && n <= 100)
      ? x.scoring
      : [4,3,2,1];

    x.rounds = x.rounds.map((r, i) => ({
      id: String(r.id || id()),
      name: String(r.name || `Campfire ${i + 1}`).slice(0, 90),
      finalized: r.finalized === undefined ? true : !!r.finalized,
      note: String(r.note || ''),
      teamAtFinish: r.teamAtFinish && typeof r.teamAtFinish === 'object' ? r.teamAtFinish : {},
      order: Array.isArray(r.order)
        ? r.order
            .filter((o) => x.players.some((p) => p.id === o.id))
            .map((o) => ({ id: String(o.id), ghost: !!o.ghost }))
        : []
    }));

    x.appMode = x.appMode === 'teams' ? 'teams' : 'individual';
    x.raceName = String(x.raceName || 'The Great Climb').slice(0, 80);
    return x;
  }

  function localLoad() {
    if (!raceCode) return false;
    try {
      const text = localStorage.getItem(localKey());
      if (!text) return false;
      const cache = JSON.parse(text);
      state = normalize(cache.state);
      revision = Number.isInteger(cache.revision) ? cache.revision : 0;
      dirty = !!cache.dirty && !spectator;
      conflict = !!cache.conflict && dirty;
      return true;
    } catch (e) {
      console.warn('Invalid race cache', e);
      return false;
    }
  }

  function persist() {
    if (!raceCode) return;
    try {
      localStorage.setItem(localKey(), JSON.stringify({ revision, state, dirty, conflict }));
    } catch (e) {
      console.error(e);
      toast('Browser storage unavailable. Download a JSON backup.');
    }
  }

  function status(mode, msg) {
    const e = $('#connection');
    if (!e) return;
    e.className = `connection ${mode || ''}`;
    $('#syncLabel').textContent = msg;
  }

  function toast(msg) {
    const e = $('#toast');
    e.textContent = msg;
    e.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => e.classList.remove('show'), 3700);
  }

  function mark() {
    dirty = true;
    edit++;
    state.updatedAt = new Date().toISOString();
    persist();
    render();
    status('pending', 'Unsynced changes');
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => saveCloud(), 1200);
  }

  function commit(fn) {
    if (spectator || !raceCode) return;
    undo.push(hash(state));
    if (undo.length > 40) undo.shift();
    redo = [];
    fn();
    mark();
  }

  function undoAction() {
    if (!undo.length) return toast('Nothing to undo');
    redo.push(hash(state));
    state = normalize(JSON.parse(undo.pop()));
    mark();
    toast('Change undone');
  }

  function redoAction() {
    if (!redo.length) return toast('Nothing to redo');
    undo.push(hash(state));
    state = normalize(JSON.parse(redo.pop()));
    mark();
    toast('Change restored');
  }

  async function responseData(res) {
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error(`HTTP ${res.status}: Server returned non-JSON; check the Worker deployment.`); }
    if (!res.ok) {
      const error = new Error(data?.error || `HTTP ${res.status}`);
      error.status = res.status;
      error.serverRevision = data?.revision;
      throw error;
    }
    return data;
  }

  async function loadCloud({ silent = false, force = false } = {}) {
    if (!raceCode || refreshing || saving) return;
    if (dirty && !force) {
      if (!silent) toast('Unsaved edits on this device. Sync or export them before refreshing.');
      return;
    }
    if (dirty && force) {
      if (!confirm('Discard unsynced edits and load the latest cloud race? A local recovery copy will be kept.')) return;
      try { localStorage.setItem(`peak_conflict_backup_${raceCode}`, hash(state)); }
      catch { toast('Browser backup unavailable; export JSON first if needed.'); return; }
    }
    refreshing = true;
    const version = edit;
    status('', 'Reading race…');
    try {
      const r = await fetch(`${apiForRace()}?t=${Date.now()}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const raw = await responseData(r);
      const incoming = normalize(raw.state);
      if (version !== edit && !force) return;
      if (!dirty || force) {
        state = incoming;
        revision = raw.revision;
        dirty = false;
        conflict = false;
        cloudReady = true;
        persist();
        render();
        status('ok', `Cloud connected · v${revision}`);
        if (!silent) toast('Race refreshed');
      }
    } catch (e) {
      console.error('PEAK cloud GET', e);
      status('error', `Load failed: ${e.message}`);
      if (!silent) toast(e.message);
    } finally {
      refreshing = false;
    }
  }

  async function saveCloud({ manual = false } = {}) {
    if (spectator || !raceCode) return;
    if (saving) { if (manual) toast('Save already in progress'); return; }
    if (conflict) return toast('Save paused: this race changed on another device. Export JSON and choose “Reload cloud” to resolve it.');
    if (!dirty) { status('ok', cloudReady ? `Cloud synced · v${revision}` : 'No local changes'); if (manual) toast('No unsaved changes'); return; }
    if (!revision) return toast('Cannot save until the current race revision has been loaded.');
    saving = true;
    clearTimeout(syncTimer);
    const version = edit;
    const out = clone(state);
    status('', 'Uploading race…');
    try {
      const res = await fetch(`${apiForRace()}/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Bearer ${manageKey}` },
        body: JSON.stringify({ revision, state: out })
      });
      const result = await responseData(res);
      revision = result.revision;
      cloudReady = true;
      if (version === edit) {
        dirty = false;
        status('ok', `Cloud synced · v${revision}`);
        if (manual) toast('Race saved to cloud');
      } else {
        status('pending', 'More changes to sync');
      }
      persist();
    } catch (e) {
      console.error('PEAK cloud PUT', e);
      if (e.status === 409) {
        conflict = true;
        persist();
        status('error', 'Save conflict — reload needed');
        toast('Newer results exist on another device. Your local edits are preserved; export them before reloading.');
      } else {
        status('error', `Cloud save failed: ${e.message}`);
        toast(`Cloud save failed: ${e.message}`);
      }
    } finally {
      saving = false;
      if (dirty && !conflict) syncTimer = setTimeout(() => saveCloud(), 5000);
    }
  }

  async function copyText(value) {
    try { await navigator.clipboard.writeText(value); toast('Copied to clipboard'); }
    catch {
      openModal('Copy this link', `<div class="field"><label>Select and copy</label><textarea rows="4" readonly>${esc(value)}</textarea></div>`);
      $('#modalBody textarea')?.select();
    }
  }

  function welcome() {
    return `<section class="hero landing-hero"><div class="hero-content">
      <div class="eyebrow">PEAK / COMMUNITY EXPEDITIONS</div>
      <h2>Your climb.<br><em>Your crew.</em></h2>
      <p>Start a race for your friends or join an expedition with a code. No accounts, no server, and no sign-up.</p>
      </div></section>
      <div class="people-grid landing-grid">
        <section class="panel">
          <div class="panel-head"><div><h3>⚑ Create an expedition</h3><p>Your race, your campfires, your scoring rules</p></div></div>
          <form id="createRaceForm"><div class="field"><label>Race name</label><input name="raceName" maxlength="80" required placeholder="Saturday Summit Showdown"></div>
          <p class="subline">You will receive a spectator code, a private organizer link, and a recovery key. Save the recovery key somewhere safe.</p>
          <button class="button primary" type="submit">Create race →</button></form>
        </section>
        <section class="panel"><div class="panel-head"><div><h3>◈ Join an expedition</h3><p>No account required</p></div></div>
          <form id="joinRaceForm"><div class="field"><label>Race code</label><input name="code" maxlength="20" required autocapitalize="characters" placeholder="PEAK-ABCDEFGH"></div>
          <button class="button primary" type="submit">View race →</button></form>
          <div class="landing-extra"><button class="button tiny quiet" data-action="recover-access">Lost organizer access? Recover with your key</button></div>
        </section>
      </div>
      <!-- <section class="panel landing-tip"><h3>Bringing a race from your old PEAK site?</h3><p>First create a new expedition, then open Race Vault → Import JSON to upload your existing race export. Your familiar scoring and podium features will be retained.</p></section> -->`;
  }

  function sharePanel() {
    const code = `PEAK-${raceCode}`;
    return `<div class="race-share-bar">
      <div><strong>⚑ ${esc(code)}</strong><span>${spectator ? 'Spectator access' : 'Organizer access'} · ${esc(state.raceName)}</span></div>
      <div class="actions">
        <button class="button tiny quiet" data-action="copy-code">Copy code</button>
        <button class="button tiny quiet" data-action="copy-spectator">Share spectator link</button>
        ${!spectator ? '<button class="button tiny quiet" data-action="organizer-info">Organizer keys</button>' : ''}
        <button class="button tiny quiet" data-action="reload-race">Reload cloud</button>
        <button class="button tiny quiet" data-action="switch-race">Change race</button>
      </div>
    </div>`;
  }

  function showCredentials(recoveryKey = null) {
    openModal('Save your organizer access', `<div class="credential-warning">Keep these details private. Anyone with the organizer link can edit this race.</div>
      <div class="field"><label>Race code (share this with friends)</label><input readonly value="PEAK-${raceCode}"></div>
      <div class="field"><label>Organizer link (private)</label><textarea rows="3" readonly>${esc(manageLink())}</textarea></div>
      ${recoveryKey ? `<div class="field"><label>Recovery key (shown only now — save it)</label><textarea rows="3" readonly>${esc(recoveryKey)}</textarea></div>` : '<p class="subline">Your recovery key was shown when you created or recovered the race. It cannot be retrieved later.</p>'}
      <div class="actions"><button class="button tiny primary" data-action="copy-organizer">Copy organizer link</button><button class="button tiny quiet" data-action="copy-spectator">Copy spectator link</button>${recoveryKey ? '<button class="button tiny quiet" data-action="copy-recovery" data-recovery="'+esc(recoveryKey)+'">Copy recovery key</button>' : '<button class="button tiny danger" data-action="rotate-keys">Rotate keys</button>'}</div>
      <p class="subline">Recovery keys allow you to generate a new organizer link, which deactivates the old one.</p>`);
  }

  async function rotateKeys() {
    if (spectator || !manageKey) return;
    if (dirty) return toast('Save or export unsynced results before rotating access keys.');
    if (!confirm('Rotate organizer and recovery keys? All previously saved organizer links and recovery keys will stop working.')) return;
    try {
      const res = await fetch(`${apiForRace()}/rotate`, { method:'POST', headers:{'Authorization':`Bearer ${manageKey}`} });
      const data = await responseData(res);
      manageKey = data.manageKey;
      sessionStorage.setItem(tokenSlot(raceCode), manageKey);
      history.replaceState(null, '', `?race=PEAK-${raceCode}#key=${manageKey}`);
      showCredentials(data.recoveryKey);
      toast('Organizer credentials rotated. Save the new recovery key.');
    } catch (e) { toast(`Unable to rotate keys: ${e.message}`); }
  }

  async function createRace(name) {
    status('', 'Creating expedition…');
    try {
      const r = await fetch(API_BASE, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name}) });
      const data = await responseData(r);
      raceCode = data.code.replace(/^PEAK-/, '');
      manageKey = data.manageKey;
      sessionStorage.setItem(tokenSlot(raceCode), manageKey);
      revision = data.revision;
      state = normalize(data.state);
      dirty = false; conflict = false; cloudReady = true;
      undo = []; redo = []; navigationHistory = [];
      spectator = false; podiumPresentation = false; page = 'overview';
      history.replaceState(null, '', `?race=PEAK-${raceCode}#key=${manageKey}`);
      persist(); render(); status('ok', `Cloud connected · v${revision}`);
      showCredentials(data.recoveryKey);
    } catch (e) { status('error', 'Could not create race'); toast(e.message); }
  }

  async function recoverAccess(code, key) {
    status('', 'Recovering organizer access…');
    try {
      const res = await fetch(`${API_BASE}/${code}/recover`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({recoveryKey:key}) });
      const data = await responseData(res);
      raceCode = code; manageKey = data.manageKey; revision = 0;
      sessionStorage.setItem(tokenSlot(raceCode), manageKey);
      spectator = false; page = 'overview'; podiumPresentation = false;
      history.replaceState(null, '', `?race=PEAK-${raceCode}#key=${manageKey}`);
      closeModal(); await loadCloud({silent:true}); showCredentials(data.recoveryKey);
    } catch (e) { status('error', 'Recovery failed'); toast(e.message); }
  }

  function calc(mode = state.appMode, upto = null) {
    const items = mode === 'teams' ? state.teams : state.players;
    const sc = Object.fromEntries(items.map((p) => [p.id, 0]));
    let rounds = completed();
    if (upto !== null) rounds = rounds.slice(0, upto);

    for (const r of rounds) {
      r.order.forEach((o, i) => {
        if (o.ghost) return;
        const pid = mode === 'teams' ? (r.teamAtFinish?.[o.id] ?? player(o.id)?.teamId) : o.id;
        if (pid && sc[pid] !== undefined) sc[pid] += state.scoring[i] || 0;
      });
    }
    return sc;
  }

  function leaders(mode = state.appMode, upto = null) {
    const scores = calc(mode, upto);
    const items = mode === 'teams' ? teams() : people();
    return items
      .map((p, i) => ({ ...p, score: scores[p.id] || 0, c: mode === 'teams' ? color(p, i) : COLORS[i % COLORS.length] }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  function wins() {
    const w = {};
    people().forEach((p) => { w[p.id] = 0; });
    completed().forEach((r) => {
      const p = r.order[0];
      if (p && !p.ghost && w[p.id] !== undefined) w[p.id]++;
    });
    return w;
  }

  function racerRows() {
    const scores = calc('individual');
    const w = wins();
    return people().map((p) => {
      const places = [];
      let ghost = 0;
      let podiums = 0;
      let streak = 0;
      let bestStreak = 0;
      completed().forEach((r) => {
        const idx = r.order.findIndex((o) => o.id === p.id);
        if (idx < 0) return;
        if (r.order[idx].ghost) {
          ghost++;
          streak = 0;
        } else {
          const place = idx + 1;
          places.push(place);
          if (place <= 3) {
            podiums++;
            streak++;
            if (streak > bestStreak) bestStreak = streak;
          } else {
            streak = 0;
          }
        }
      });
      return {
        ...p,
        score: scores[p.id] || 0,
        win: w[p.id] || 0,
        ghost,
        podiums,
        streak: bestStreak,
        avg: places.length ? (places.reduce((a, b) => a + b, 0) / places.length).toFixed(1) : '—',
        avgNumber: places.length ? (places.reduce((a, b) => a + b, 0) / places.length) : Infinity,
        played: places.length + ghost,
        places
      };
    }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  function rankAtRound(roundCount) {
    const standing = leaders('individual', roundCount);
    const out = {};
    standing.forEach((p, i) => { out[p.id] = i + 1; });
    return out;
  }

  function biggestComeback() {
    const total = completed().length;
    if (total < 2) return null;
    const mid = Math.max(1, Math.floor(total / 2));
    const midRanks = rankAtRound(mid);
    const finalRanks = rankAtRound(total);
    let best = null;
    people().forEach((p) => {
      if (!midRanks[p.id] || !finalRanks[p.id]) return;
      const climb = midRanks[p.id] - finalRanks[p.id];
      if (climb <= 0) return;
      if (!best || climb > best.climb || (climb === best.climb && finalRanks[p.id] < best.finalRank)) {
        best = { player: p, climb, midRank: midRanks[p.id], finalRank: finalRanks[p.id] };
      }
    });
    return best;
  }

  function closestBattle(mode = state.appMode) {
    const list = leaders(mode);
    if (list.length < 2) return null;
    let best = null;
    for (let i = 0; i < list.length - 1; i++) {
      const gap = Math.abs(list[i].score - list[i + 1].score);
      const item = { a: list[i], b: list[i + 1], gap };
      if (!best || gap < best.gap) best = item;
    }
    return best;
  }

  function stat(name, value, hint, symbol = '↗') {
    return `<div class="stat"><div class="eyebrow">${esc(name)}</div><div class="corner">${symbol}</div><div class="number">${esc(value)}</div><div class="hint">${esc(hint)}</div></div>`;
  }

  function modes() {
    return `<div class="actions"><button class="button tiny ${state.appMode === 'individual' ? 'primary' : 'quiet'}" data-action="mode" data-value="individual">Solo</button><button class="button tiny ${state.appMode === 'teams' ? 'primary' : 'quiet'}" data-action="mode" data-value="teams">Teams</button></div>`;
  }

  function leaderboard(limit) {
    const x = leaders();
    const max = Math.max(1, x[0]?.score || 0);
    if (!x.length) return '<div class="empty">No standings yet — score a campfire to see the race unfold.</div>';
    return `<div class="list">${x.slice(0, limit ?? 999).map((p, i) => `
      <div class="leader-row">
        <span class="rank ${i === 0 ? 'first' : ''}">${String(i + 1).padStart(2, '0')}</span>
        <div class="avatar" style="background:${p.c}">${esc(p.name.slice(0, 1).toUpperCase())}</div>
        <div>
          <div class="person-name">${esc(p.name)}</div>
          <div class="person-sub">${i === 0 ? 'Current leader' : `${Math.max(0, (x[0]?.score || 0) - p.score)} back of first`}</div>
        </div>
        <div class="bar"><i style="width:${(p.score / max) * 100}%"></i></div>
        <div class="points">${p.score}<small>PTS</small></div>
      </div>`).join('')}</div>`;
  }

  function roundSummary(r) {
    const top = r.order.find((x) => !x.ghost);
    const p = player(top?.id);
    return `<div class="activity-row"><div class="activity-dot">${r.finalized ? '✓' : '○'}</div><div><strong>${esc(r.name)} · ${r.finalized ? 'Finalized' : 'Draft'}</strong><small>${p ? `${esc(p.name)} leads the checkpoint` : 'No finishing order recorded'} · ${r.order.filter((o) => o.ghost).length} ghosts</small></div></div>`;
  }

  function chart() {
    const mode = state.appMode;
    const entities = leaders(mode).slice(0, 5);
    const rounds = completed();
    const width = 900;
    const height = 245;
    const pad = 35;
    const max = Math.max(4, ...entities.map((e) => e.score));
    let lines = '';

    for (let i = 0; i <= 4; i++) {
      const y = height - pad - ((height - pad * 2) * i / 4);
      lines += `<line x1="${pad}" x2="${width - pad}" y1="${y}" y2="${y}" stroke="#32404a" stroke-dasharray="3 5"/><text x="2" y="${y + 4}" fill="#8498a7" font-size="13">${Math.round(max * i / 4)}</text>`;
    }

    const paths = entities.map((e) => {
      const a = Array.from({ length: rounds.length + 1 }, (_, i) => calc(mode, i)[e.id] || 0);
      const pts = a.map((v, i) => [
        pad + ((width - pad * 2) * i / Math.max(1, rounds.length)),
        height - pad - ((height - pad * 2) * v / max)
      ]);
      return `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" stroke="${e.c}" stroke-width="3" fill="none" stroke-linejoin="round" stroke-linecap="round"/>${pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${e.c}"/>`).join('')}`;
    }).join('');

    return `<div class="chart-wrap"><svg role="img" aria-label="Cumulative points by checkpoint" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${lines}${paths}</svg></div><div class="legend">${entities.map((e) => `<span><i style="background:${e.c}"></i>${esc(e.name)}</span>`).join('') || '<span>No results to plot yet</span>'}</div>`;
  }

  function pageHead(title, copy, actions = '') {
    return `<header class="page-head"><div><div class="eyebrow">PEAK / ${esc(title).toUpperCase()}</div><h1>${esc(title)}</h1><p>${esc(copy)}</p></div><div class="actions">${actions}</div></header>`;
  }

  function overview() {
    const l = leaders();
    const r = completed();
    const nextDraft = state.rounds.find((r) => !r.finalized);
    const finalCallout = raceComplete()
      ? `<div class="hero-callout complete"><strong>Race complete.</strong><span>The summit has been conquered — open the podium screen for the celebration.</span><button class="button primary" data-page="podium">🏆 View podium</button></div>`
      : '';

    return `
      <section class="hero">
        <div class="hero-content">
          <div class="eyebrow">● ${esc(state.raceName.toUpperCase())} / RACE DAY</div>
          <h2>Chase the summit.<br><em>Own the story.</em></h2>
          <p>Every campfire is a turning point. Track rivals, comebacks, podium pushes and the final fight for the summit.</p>
          <div class="actions">
            ${spectator ? '' : `<button class="button primary" data-page="race">⚑ Score a campfire →</button>`}
            <button class="button quiet" data-page="analytics">Explore insights ↗</button>
            <!-- <button class="button quiet" data-page="podium">🏆 Podium</button> -->
          </div>
          ${finalCallout}
        </div>
      </section>
      <div class="stats">
        ${stat('Current leader', l[0]?.name || '—', l[0] ? `${l[0].score} points` : 'Awaiting results', '★')}
        ${stat('Campfires scored', r.length, `${state.rounds.length - r.length} awaiting finish`, '⚑')}
        ${stat('Active racers', people().length, `${teams().length} teams in the race`, '♧')}
        ${stat('Points awarded', Object.values(calc('individual')).reduce((a,b) => a + b, 0), 'Across finalized campfires', '↗')}
      </div>
      <div class="layout">
        <section class="panel">
          <div class="panel-head"><div><h3>Race standings</h3><p>The current battle for the summit</p></div>${modes()}</div>
          ${leaderboard(10)}
        </section>
        <section class="panel">
          <div class="panel-head"><div><h3>From the trail</h3><p>Most recent checkpoint activity</p></div><button class="button tiny quiet" data-page="race">All campfires ↗</button></div>
          <div class="activity">${state.rounds.length ? state.rounds.slice().reverse().slice(0, 6).map(roundSummary).join('') : '<div class="empty">Create your first campfire to start the race.</div>'}</div>
          <div class="highlight-box">
            <div class="eyebrow">NEXT CHECKPOINT</div>
            <h3>${esc(nextDraft ? nextDraft.name : `Campfire ${state.rounds.length + 1}`)}</h3>
            <p class="subline">${nextDraft ? 'Next unfinished checkpoint in race order.' : 'Ready to create another campfire.'}</p>
            ${spectator ? '' : `<button class="button primary tiny" ${nextDraft ? 'data-page="race"' : 'data-action="new-round"'}>${nextDraft ? 'Open campfires →' : 'Add campfire +'}</button>`}
          </div>
        </section>
      </div>
      <section class="panel">
        <div class="panel-head"><div><h3>Race momentum</h3><p>How the leaders are accumulating points</p></div><button class="button tiny quiet" data-page="analytics">Detailed analytics ↗</button></div>
        ${chart()}
      </section>`;
  }

  function roundHTML(r) {
    return `
      <article class="round">
        <div class="round-head">
          <div>
            <div class="eyebrow">CHECKPOINT ${state.rounds.indexOf(r) + 1} <span class="pill ${r.finalized ? '' : 'draft'}" style="margin-left:7px">${r.finalized ? 'FINAL' : 'DRAFT'}</span></div>
            <h3>${esc(r.name)}</h3>
            <div class="subline">${r.order.length} racers · ${r.order.filter((o) => o.ghost).length} ghosts${r.note ? ` · ${esc(r.note)}` : ''}</div>
          </div>
          <div class="actions">
            ${!spectator ? `<button class="button tiny quiet" data-action="edit-round" data-id="${r.id}">Edit</button><button class="button tiny ${r.finalized ? 'quiet' : 'primary'}" data-action="toggle-final" data-id="${r.id}">${r.finalized ? 'Reopen' : '✓ Finalize'}</button>` : ''}
          </div>
        </div>
        <div class="round-body" data-round-body="${r.id}">
          ${!r.finalized && !spectator ? `<div class="drop-help">Drag racers into finishing order. Winner on top, last place on bottom.</div>` : ''}
          ${r.order.length ? r.order.map((o, i) => {
            const p = player(o.id);
            const locked = r.finalized || spectator;
            const avatarColor = COLORS[Math.max(0, people().findIndex((x) => x.id === o.id)) % COLORS.length];
            return `
              <div class="round-entry ${o.ghost ? 'ghost' : ''} ${locked ? '' : 'draggable'}" ${locked ? '' : 'draggable="true"'} data-round-id="${r.id}" data-entry-id="${o.id}">
                <span class="place">${i + 1}</span>
                ${locked ? '' : '<span class="drag-handle" title="Drag to reorder">⋮⋮</span>'}
                <div class="avatar" style="background:${avatarColor};width:30px;height:30px;font-size:12px">${esc((p?.name || '?')[0])}</div>
                <div>
                  <b>${esc(p?.name || 'Unknown')}</b>${o.ghost ? ' <span class="pill draft">GHOST</span>' : ''}
                  <div class="subline">${esc(team(p?.teamId)?.name || 'Solo')}</div>
                </div>
                <span class="entry-score">${o.ghost ? '0 PTS' : `+${state.scoring[i] || 0} PTS`}</span>
                ${locked ? '' : `<div class="mini-actions"><button title="Move up" data-action="up" data-id="${r.id}" data-index="${i}" ${i === 0 ? 'disabled' : ''}>↑</button><button title="Move down" data-action="down" data-id="${r.id}" data-index="${i}" ${i === r.order.length - 1 ? 'disabled' : ''}>↓</button><button title="Toggle ghost" data-action="ghost" data-id="${r.id}" data-pid="${o.id}">☠</button><button title="Remove from checkpoint" data-action="remove-entry" data-id="${r.id}" data-pid="${o.id}">×</button></div>`}
              </div>`;
          }).join('') : '<div class="empty">No racers in this checkpoint.</div>'}
          ${!spectator && !r.finalized ? `<div class="actions" style="margin-top:14px"><button class="button tiny quiet" data-action="add-entry" data-id="${r.id}">+ Add racer</button><span class="subline" style="align-self:center">Drag, mark ghosts, then finalize when official.</span></div>` : ''}
        </div>
      </article>`;
  }

  function race() {
    return pageHead('Campfire control', 'Manage placements, ghosts, checkpoint notes and official results.', spectator ? '' : `<button class="button quiet" data-action="undo">↶ Undo</button><button class="button primary" data-action="new-round">+ New campfire</button>`) + `
      <div class="stats">
        ${stat('Total campfires', state.rounds.length, 'Across this race', '⚑')}
        ${stat('Finalized', completed().length, 'Counting toward standings', '✓')}
        ${stat('Draft', state.rounds.length - completed().length, 'Not scored yet', '○')}
        ${stat('Ghost appearances', completed().reduce((a, r) => a + r.order.filter((o) => o.ghost).length, 0), 'Across finalized checkpoints', '☠')}
      </div>
      <div class="rounds">${state.rounds.length ? orderedRounds().map(roundHTML).join('') : '<div class="empty">No campfires yet. Add one to begin logging the climb.</div>'}</div>`;
  }


  function routeMap() {
    const today = rotationKey();
    const dates = Object.keys(mapIndex || {}).sort((a,b)=>mapDateSort(b)-mapDateSort(a));
    const selected = mapDate || today;
    const record = mapIndex?.[selected];
    const current = selected === today;
    const sequence = record?.biomes || [];
    return pageHead('Expedition map', 'Map rotation and biome sequence from the community PeakMap project.', `<button class="button quiet" data-action="refresh-map">↻ Refresh rotation</button><a class="button primary" href="${PEAKMAP_APP}" target="_blank" rel="noopener noreferrer">↗ Open interactive PeakMap</a>`) + `
      <section class="map-hero"><div class="eyebrow">TRAIL NOTES / COMMUNITY INTELLIGENCE</div><h2>Know the route.<br><em>Race the mountain.</em></h2><p>Today's biome order, straight from the published PeakMap schedule. Your competition scores remain separate.</p><span class="source-tag">Unofficial community source · Refresh at 17:00 UTC</span></section>
      <div class="map-grid">
        <section class="panel">
          <div class="panel-head"><div><h3>Route rotation</h3><p>Biome order — not verified individual campfire locations</p></div><span class="pill ${record?'':'draft'}">${record ? current?'CURRENT ROTATION':'ARCHIVE / SCHEDULE' : 'NO DATA'}</span></div>
          <div class="field map-picker"><label for="mapDate">Select published day</label><select id="mapDate" ${dates.length?'':'disabled'}>${dates.length?dates.map(d=>`<option value="${esc(d)}" ${d===selected?'selected':''}>${esc(mapDateText(d))}${d===today?' · Current':''}</option>`).join(''):'<option>No published rotations loaded</option>'}</select></div>
          ${mapLoading?'<div class="empty">Checking the trail map…</div>':''}
          ${mapError?`<div class="map-notice">${esc(mapError)}</div>`:''}
          ${record?`<div class="trail-route">${sequence.map((name,i)=>`<div class="trail-step biome-${esc(name.toLowerCase().replace(/[^a-z]/g,''))}"><span class="trail-node">${i+1}</span><div class="trail-step-detail"><span class="eyebrow">STAGE ${String(i+1).padStart(2,'0')}</span><strong>${esc(name)}</strong></div><span class="trail-symbol">${({'Shore':'◉','Tropics':'✿','Roots':'♣','Alpine':'▲','Mesa':'◆','Caldera':'♨','Volcano':'♨','Swamp':'≈','Gloom':'☾'})[name]||'✦'}</span></div>`).join('')}<div class="trail-finish">⚑ &nbsp; THE SUMMIT</div></div>`:'<div class="empty">No biome rotation available for the selected date. The existing race and manual campfires still work.</div>'}
          ${record&&!spectator?`<div class="map-sync-panel"><div><strong>Create campfires from this route</strong><p>Creates one draft campfire per biome, in order. Existing campfires and scores are never modified.</p></div><button class="button primary" data-action="import-map-rounds">+ Create draft campfires</button></div>`:''}
        </section>
        <section class="panel map-side"><div class="panel-head"><div><h3>Field guide</h3><p>Live source and handoff to scoring</p></div></div>
          <div class="map-detail"><span class="eyebrow">MAP ROTATION</span><strong>${esc(mapDateText(selected))}</strong><small>${esc(record?.level||'Awaiting published map')} · ${sequence.length} recorded biomes</small></div>
          <div class="map-detail"><span class="eyebrow">YOUR RACE</span><strong>${state.rounds.length} campfires</strong><small>${completed().length} finalized · ${state.rounds.length-completed().length} drafts</small></div>
          <div class="map-detail"><span class="eyebrow">DATA FRESHNESS</span><strong>${mapFetched ? esc(mapFetched.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})) : 'Not loaded'}</strong><small>Community publication can lag or omit days. Reload to check updates.</small></div>
          <div class="map-advice">✦ <b>Scout's note</b><p>PeakMap identifies the sequence of biomes on a daily map. It does not provide individual campfire names or the race's finishing order. Adjust draft names to match your actual checkpoints.</p></div>
          <button class="button quiet" data-page="race">⚑ Go to race scoring →</button>
          <p class="map-credit">Source: qWojtpl / PeakMap, an independent fan project, not affiliated with PEAK's creators.</p>
        </section>
      </div>`;
  }

  function peoplePage() {
    return pageHead('Racers & teams', 'Manage your competitors, team colours and assignments.', spectator ? '' : `<button class="button quiet" data-action="new-team">+ New team</button><button class="button primary" data-action="new-player">+ Add racer</button>`) + `
      <div class="people-grid">
        <section class="panel">
          <div class="panel-head"><div><h3>Competitors</h3><p>${people().length} registered racers</p></div></div>
          ${people().length ? people().map((p, i) => `
            <div class="person-row">
              <div class="avatar" style="background:${COLORS[i % COLORS.length]}">${esc(p.name[0])}</div>
              <div class="grow"><b>${esc(p.name)}</b><div class="subline">${calc('individual')[p.id] || 0} points</div></div>
              ${spectator ? `<small>${esc(team(p.teamId)?.name || 'Solo')}</small>` : `<select aria-label="Team for ${esc(p.name)}" data-team-select="${p.id}"><option value="">No team</option>${teams().map((t) => `<option value="${t.id}" ${p.teamId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select><button class="button tiny quiet" data-action="rename-player" data-id="${p.id}">✎</button><button class="button tiny danger" data-action="del-player" data-id="${p.id}">×</button>`}
            </div>`).join('') : '<div class="empty">No racers registered.</div>'}
        </section>
        <section class="panel">
          <div class="panel-head"><div><h3>Teams</h3><p>${teams().length} teams created</p></div></div>
          ${teams().length ? teams().map((t) => `
            <div class="person-row">
              <div class="avatar" style="background:${t.color}">▲</div>
              <div class="grow"><b>${esc(t.name)}</b><div class="subline">${people().filter((p) => p.teamId === t.id).length} racers · ${calc('teams')[t.id] || 0} pts</div></div>
              ${spectator ? '' : `<button class="button tiny quiet" data-action="rename-team" data-id="${t.id}">✎</button><button class="button tiny danger" data-action="del-team" data-id="${t.id}">×</button>`}
            </div>`).join('') : '<div class="empty">Create teams for the team competition.</div>'}
        </section>
      </div>`;
  }

  function analytics() {
    const rows = racerRows();
    const best = rows.slice().sort((a, b) => b.win - a.win || b.score - a.score)[0];
    const ghost = rows.slice().sort((a, b) => b.ghost - a.ghost || b.played - a.played)[0];
    const close = leaders();
    const comeback = biggestComeback();

    return pageHead('Race intelligence', 'Performance, progression and rivalries at every checkpoint.', `<button class="button quiet" data-action="export-csv">↓ Download CSV</button>`) + `
      <div class="insight-grid">
        <div class="insight"><h4>Checkpoint champion</h4><strong>${esc(best?.win ? best.name : '—')}</strong><small>${best?.win || 0} first-place finishes</small></div>
        <div class="insight"><h4>Haunted by the mountain</h4><strong>${esc(ghost?.ghost ? ghost.name : '—')}</strong><small>${ghost?.ghost || 0} ghost appearances</small></div>
        <div class="insight"><h4>Points separating the top two</h4><strong>${close.length > 1 ? close[0].score - close[1].score : '—'}</strong><small>Current ${state.appMode === 'teams' ? 'team' : 'solo'} race gap</small></div>
        <div class="insight"><h4>Biggest comeback</h4><strong>${esc(comeback?.player?.name || '—')}</strong><small>${comeback ? `Climbed ${comeback.climb} positions from mid-race` : 'Need at least 2 finalized campfires'}</small></div>
        <div class="insight"><h4>Consistency king</h4><strong>${esc(rows.filter((r) => r.played).sort((a, b) => a.avgNumber - b.avgNumber)[0]?.name || '—')}</strong><small>${rows.filter((r) => r.played).sort((a, b) => a.avgNumber - b.avgNumber)[0]?.avg || '—'} average finish</small></div>
        <div class="insight"><h4>Longest podium streak</h4><strong>${esc(rows.slice().sort((a, b) => b.streak - a.streak || b.score - a.score)[0]?.name || '—')}</strong><small>${rows.slice().sort((a, b) => b.streak - a.streak || b.score - a.score)[0]?.streak || 0} straight podiums</small></div>
      </div>
      <section class="panel" style="margin-bottom:18px"><div class="panel-head"><div><h3>The climb in motion</h3><p>Points accumulated after each finalized campfire</p></div>${modes()}</div>${chart()}</section>
      <section class="panel"><div class="panel-head"><div><h3>Competitor scorecards</h3><p>Calculated across finalized campfires only</p></div></div>
        <div class="table-wrap"><table><thead><tr><th>Racer</th><th>Points</th><th>Wins</th><th>Podiums</th><th>Completed</th><th>Ghosts</th><th>Avg. finish</th></tr></thead><tbody>${rows.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td>${p.score}</td><td>${p.win}</td><td>${p.podiums}</td><td>${p.played}</td><td>${p.ghost}</td><td>${p.avg}</td></tr>`).join('') || '<tr><td colspan="7">No racers yet</td></tr>'}</tbody></table></div>
      </section>`;
  }

  function podiumPage() {
    const solo = leaders('individual');
    const teamStandings = leaders('teams');
    const champ = solo[0];
    const second = solo[1];
    const third = solo[2];
    const rows = racerRows();
    const comeback = biggestComeback();
    const consistency = rows.filter((r) => r.played).sort((a, b) => a.avgNumber - b.avgNumber)[0];
    const streak = rows.slice().sort((a, b) => b.streak - a.streak || b.score - a.score)[0];
    const battle = closestBattle('individual');
    const teamChamp = teamStandings[0];
    const totalPoints = Object.values(calc('individual')).reduce((a, b) => a + b, 0);

    if (!solo.length) {
      return pageHead('Victory podium', 'Celebrate the finish once the race has results.', '') + '<div class="empty">Score at least one finalized campfire to unlock the podium.</div>';
    }

    const subtitle = raceComplete()
      ? 'The race is complete. Crown the summit champion.'
      : 'Live podium — standings update as campfires are finalized.';

    return pageHead('Victory podium', subtitle, `<button class="button quiet" data-action="open-podium-screen">◉ Present full screen</button><button class="button primary" data-action="export-csv">↓ Results CSV</button>`) + `
      <section class="podium-hero ${raceComplete() ? 'complete' : ''}">
        <div class="podium-spark"></div>
        <div class="eyebrow">${raceComplete() ? 'RACE COMPLETE' : 'LIVE PODIUM'}</div>
        <h2>${esc(champ?.name || 'Champion')}</h2>
        <p>${champ ? `${champ.score} points · ${rows.find((r) => r.id === champ.id)?.win || 0} campfire wins · ${rows.find((r) => r.id === champ.id)?.avg || '—'} avg finish` : 'Awaiting the champion.'}</p>
        <div class="actions">
          <span class="pill">${esc(state.raceName)}</span>
          <span class="pill muted">${completed().length} finalized campfires</span>
          <span class="pill muted">${people().length} racers</span>
        </div>
      </section>

      <section class="podium-stage-wrap panel">
        <div class="panel-head"><div><h3>Final podium</h3><p>Top three climbers in the race</p></div></div>
        <div class="podium-stage">
          <div class="podium-card place-2 ${second ? '' : 'ghosted'}">
            <div class="podium-medal">2</div>
            <div class="avatar xl" style="background:${second?.c || '#546270'}">${esc(second?.name?.[0] || '—')}</div>
            <strong>${esc(second?.name || 'Open')}</strong>
            <small>${second ? `${second.score} pts` : 'No racer yet'}</small>
            <div class="podium-block">2nd</div>
          </div>
          <div class="podium-card place-1 ${champ ? '' : 'ghosted'}">
            <div class="podium-crown">👑</div>
            <div class="podium-medal gold">1</div>
            <div class="avatar xl" style="background:${champ?.c || '#546270'}">${esc(champ?.name?.[0] || '—')}</div>
            <strong>${esc(champ?.name || 'Champion')}</strong>
            <small>${champ ? `${champ.score} pts` : 'Awaiting results'}</small>
            <div class="podium-block champion">1st</div>
          </div>
          <div class="podium-card place-3 ${third ? '' : 'ghosted'}">
            <div class="podium-medal bronze">3</div>
            <div class="avatar xl" style="background:${third?.c || '#546270'}">${esc(third?.name?.[0] || '—')}</div>
            <strong>${esc(third?.name || 'Open')}</strong>
            <small>${third ? `${third.score} pts` : 'No racer yet'}</small>
            <div class="podium-block">3rd</div>
          </div>
        </div>
      </section>

      <div class="insight-grid podium-metrics">
        <div class="insight"><h4>Race MVP</h4><strong>${esc(champ?.name || '—')}</strong><small>${champ?.score || 0} total points</small></div>
        <div class="insight"><h4>Biggest comeback</h4><strong>${esc(comeback?.player?.name || '—')}</strong><small>${comeback ? `Up ${comeback.climb} positions from mid-race` : 'Not enough finalized campfires yet'}</small></div>
        <div class="insight"><h4>Consistency king</h4><strong>${esc(consistency?.name || '—')}</strong><small>${consistency?.avg || '—'} average finish</small></div>
        <div class="insight"><h4>Longest podium streak</h4><strong>${esc(streak?.name || '—')}</strong><small>${streak?.streak || 0} consecutive podiums</small></div>
        <div class="insight"><h4>Closest rivalry</h4><strong>${battle ? `${esc(battle.a.name)} vs ${esc(battle.b.name)}` : '—'}</strong><small>${battle ? `${battle.gap} point gap` : 'Need at least two racers'}</small></div>
        <div class="insight"><h4>Team champion</h4><strong>${esc(teamChamp?.name || '—')}</strong><small>${teamChamp ? `${teamChamp.score} team points` : 'No team scoring yet'}</small></div>
      </div>

      <section class="panel fanfare-panel">
        <div class="panel-head"><div><h3>Race story</h3><p>A quick summary for the post-race celebration</p></div></div>
        <div class="fanfare-grid">
          <div class="fanfare-card"><span>🏁</span><strong>${completed().length}</strong><small>campfires completed</small></div>
          <div class="fanfare-card"><span>⭐</span><strong>${totalPoints}</strong><small>points awarded</small></div>
          <div class="fanfare-card"><span>🔥</span><strong>${rows.reduce((m, r) => Math.max(m, r.win), 0)}</strong><small>best campfire win count</small></div>
          <div class="fanfare-card"><span>🎭</span><strong>${rows.reduce((m, r) => Math.max(m, r.ghost), 0)}</strong><small>most ghost appearances</small></div>
        </div>
      </section>`;
  }

  function readVault() {
    try { return JSON.parse(localStorage.getItem(vaultKey()) || '[]'); } catch { return []; }
  }

  function saveVault(x) {
    try {
      localStorage.setItem(vaultKey(), JSON.stringify(x.slice(0, 35)));
    } catch {
      toast('Vault storage full. Export older races.');
    }
  }

  function archive() {
    const x = readVault();
    x.unshift({ id: id(), name: state.raceName || 'Race', at: new Date().toISOString(), data: clone(state) });
    saveVault(x);
    render();
    toast('Race archived locally');
  }

  function vault() {
    const x = readVault();
    return pageHead('The race vault', 'Preserve your legendary climbs and restore previous race snapshots.', spectator ? '' : `<button class="button primary" data-action="archive">+ Archive current race</button>`) + `
      <div class="layout">
        <section class="panel">
          <div class="panel-head"><div><h3>Saved races</h3><p>Stored on this browser. Export to keep a durable copy.</p></div></div>
          ${x.length ? x.map((a) => `<div class="history-card"><div><strong>${esc(a.name)}</strong><small>${new Date(a.at).toLocaleString()} · ${a.data.players.length} racers · ${a.data.rounds.length} campfires</small></div><div class="actions"><button class="button tiny quiet" data-action="download-archive" data-id="${a.id}">↓</button>${spectator ? '' : `<button class="button tiny quiet" data-action="restore-archive" data-id="${a.id}">Restore</button><button class="button tiny danger" data-action="del-archive" data-id="${a.id}">×</button>`}</div></div>`).join('') : '<div class="empty">No archived races yet. Save a snapshot after your next summit battle.</div>'}
        </section>
        <section class="panel">
          <div class="panel-head"><div><h3>Race toolkit</h3><p>Backups, exports and race settings</p></div></div>
          <div class="activity">
            <div class="activity-row"><div class="activity-dot">↓</div><div><strong>Export race backup</strong><small>Full JSON including racers and checkpoints</small><div style="margin-top:10px"><button class="button tiny quiet" data-action="export-json">Download JSON</button></div></div></div>
            <div class="activity-row"><div class="activity-dot">▤</div><div><strong>Leaderboard spreadsheet</strong><small>CSV with individual results and statistics</small><div style="margin-top:10px"><button class="button tiny quiet" data-action="export-csv">Download CSV</button></div></div></div>
            <div class="activity-row"><div class="activity-dot">🏆</div><div><strong>Victory podium</strong><small>Open the end-of-race podium and celebration screen</small><div style="margin-top:10px"><button class="button tiny quiet" data-page="podium">Open podium</button></div></div></div>
            ${spectator ? '' : `
              <div class="activity-row"><div class="activity-dot">↑</div><div><strong>Import an existing PEAK race</strong><small>Compatible with existing PEAK JSON backups</small><div style="margin-top:10px"><button class="button tiny quiet" data-action="import">Import JSON</button></div></div></div>
              <div class="activity-row"><div class="activity-dot">⚙</div><div><strong>Competition rules</strong><small>Race title and placement points</small><div style="margin-top:10px"><button class="button tiny quiet" data-action="settings">Edit settings</button></div></div></div>
              <div class="activity-row"><div class="activity-dot">↶</div><div><strong>Undo / Redo</strong><small>Reverse recent changes on this device</small><div class="actions" style="margin-top:10px"><button class="button tiny quiet" data-action="undo">Undo</button><button class="button tiny quiet" data-action="redo">Redo</button></div></div></div>
              <div class="activity-row"><div class="activity-dot">+</div><div><strong>Start another expedition</strong><small>Create a separate race code without changing this race</small><div style="margin-top:10px"><button class="button tiny danger" data-action="switch-race">Create / join race</button></div></div></div>`}
          </div>
        </section>
      </div>`;
  }

  function openModal(title, body) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = body;
    $('#modal').classList.remove('hidden');
    $('#modal').setAttribute('aria-hidden', 'false');
    setTimeout(() => $('#modalBody input, #modalBody select, #modalBody textarea')?.focus(), 30);
  }

  function closeModal() {
    $('#modal').classList.add('hidden');
    $('#modal').setAttribute('aria-hidden', 'true');
  }

  function form(label, value = '', placeholder = '') {
    return `<div class="field"><label>${esc(label)}</label><input name="name" maxlength="80" required value="${esc(value)}" placeholder="${esc(placeholder)}"></div>`;
  }

  function modalActions(text = 'Save') {
    return `<div class="actions" style="justify-content:flex-end;margin-top:22px"><button class="button quiet" type="button" data-action="close">Cancel</button><button class="button primary" type="submit">${esc(text)}</button></div>`;
  }

  function newRound() {
    if (spectator) return;
    const next = state.rounds.length + 1;
    commit(() => state.rounds.push({
      id: id(),
      name: biomeEmoji(`Campfire ${next}`),
      note: '',
      finalized: false,
      teamAtFinish: {},
      order: people().map((p) => ({ id: p.id, ghost: false }))
    }));
    page = 'race';
    render();
    toast('Draft checkpoint created');
  }

  function editRound(r) {
    openModal('Edit checkpoint', `<form id="roundForm" data-id="${r.id}">${form('Campfire name', r.name)}<div class="field"><label>Checkpoint notes</label><textarea name="note" rows="3" maxlength="500">${esc(r.note)}</textarea></div>${modalActions('Update checkpoint')}</form><button class="button tiny danger" data-action="del-round" data-id="${r.id}" style="margin-top:14px">Delete this checkpoint</button>`);
  }

  function setupPlayer(p) {
    openModal(p ? 'Rename racer' : 'Add a racer', `<form id="playerForm" data-id="${p?.id || ''}">${form('Racer name', p?.name || '', 'e.g. Summit Steve')}${modalActions(p ? 'Save racer' : 'Add racer')}</form>`);
  }

  function setupTeam(t) {
    openModal(t ? 'Edit team' : 'Create team', `<form id="teamForm" data-id="${t?.id || ''}">${form('Team name', t?.name || '', 'e.g. Mountain Goats')}<div class="field"><label>Team colour</label><input type="color" name="color" value="${t?.color || COLORS[teams().length % COLORS.length]}"></div>${modalActions(t ? 'Save team' : 'Create team')}</form>`);
  }

  function scoreField(value, index) {
    return `<div class="field score-position"><label for="score-position-${index}">Position ${index + 1}</label><input id="score-position-${index}" type="number" class="score-value" min="0" max="100" step="1" value="${value}" required></div>`;
  }

  function refreshScorePositions() {
    const inputs = [...document.querySelectorAll('#scorePositions .score-value')];
    inputs.forEach((input, i) => {
      input.id = `score-position-${i}`;
      input.closest('.score-position').querySelector('label').htmlFor = input.id;
      input.closest('.score-position').querySelector('label').textContent = `Position ${i + 1}`;
    });
    const remove = document.querySelector('[data-action="remove-score-position"]');
    const add = document.querySelector('[data-action="add-score-position"]');
    if (remove) remove.disabled = inputs.length <= 1;
    if (add) add.disabled = inputs.length >= 100;
    const count = document.querySelector('#scoreCount');
    if (count) count.textContent = `${inputs.length} scoring positions · ${inputs.length + 1}${inputs.length === 100 ? '+' : ' onward'}: 0 points`;
  }

  function settings() {
    openModal('Race settings', `<form id="settingsForm">${form('Race name', state.raceName)}<div class="field"><label>Points by finishing position</label><div class="form-grid" id="scorePositions">${state.scoring.map(scoreField).join('')}</div><div class="score-edit-actions"><button class="button tiny quiet" type="button" data-action="add-score-position">+ Add position</button><button class="button tiny quiet" type="button" data-action="remove-score-position">− Remove last</button></div><p class="subline" id="scoreCount"></p></div><p class="subline">Any finishing places beyond the configured positions earn zero points. Updating these rules recalculates all finalized checkpoints, including previous results.</p>${modalActions('Save rules')}</form>`);
    refreshScorePositions();
  }

  function download(filename, content, type) {
    const a = document.createElement('a');
    const blob = new Blob([content], { type });
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function exportJson(data = state) {
    download(`peak-race-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
  }

  function csvCell(v) {
    return '"' + String(v ?? '').replace(/"/g, '""') + '"';
  }

  function exportCsv() {
    const rows = racerRows();
    const lines = [['Racer','Team','Points','Wins','Podiums','Completed','Ghosts','Average Finish']].concat(rows.map((p) => [p.name, team(p.teamId)?.name || '', p.score, p.win, p.podiums, p.played, p.ghost, p.avg]));
    download('peak-results.csv', lines.map((a) => a.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  }

  function reorderRound(roundId, entryId, targetId, after) {
    const round = state.rounds.find((x) => x.id === roundId);
    if (!round || round.finalized) return;
    const fromIndex = round.order.findIndex((o) => o.id === entryId);
    const targetIndex = round.order.findIndex((o) => o.id === targetId);
    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return;

    let insertIndex = targetIndex + (after ? 1 : 0);
    if (fromIndex < insertIndex) insertIndex--;
    if (insertIndex === fromIndex) return;

    commit(() => {
      const r = state.rounds.find((x) => x.id === roundId);
      const currentFrom = r.order.findIndex((o) => o.id === entryId);
      const currentTarget = r.order.findIndex((o) => o.id === targetId);
      let to = currentTarget + (after ? 1 : 0);
      const [entry] = r.order.splice(currentFrom, 1);
      if (currentFrom < to) to--;
      r.order.splice(Math.max(0, to), 0, entry);
    });
  }

  function cleanupDragHints() {
    document.querySelectorAll('.round-entry.drop-before, .round-entry.drop-after, .round-entry.dragging').forEach((el) => {
      el.classList.remove('drop-before', 'drop-after', 'dragging');
    });
  }

  function navigate(next) {
    if (!raceCode || !['overview','race','map','people','analytics','podium','history'].includes(next)) return;
    if (page !== next) navigationHistory.push(page);
    page = next;
    if (page === 'map' && !mapIndex) getPeakMap();
    render();
    window.scrollTo(0, 0);
  }

  function goBack() {
    const previous = navigationHistory.pop() || 'overview';
    page = previous;
    if (page === 'map' && !mapIndex) getPeakMap();
    render();
    window.scrollTo(0, 0);
  }

  function spectatorNavigation() {
    if (!spectator) return '';
    const items = [['overview','⌂ Overview'],['race','⚑ Campfires'],['map','◈ Map'],['analytics','▥ Analytics'],['podium','🏆 Podium']];
    return `<div class="spectator-toolbar" aria-label="Spectator navigation">
      <div class="spectator-toolbar-start">
        <button class="button tiny quiet spectator-back" data-nav-back ${page === 'overview' ? 'disabled' : ''} aria-label="Go back to previous screen">← Back</button>
        <strong class="spectator-view-label">VIEW ONLY</strong>
      </div>
      <nav class="spectator-links" aria-label="Spectator screens">${items.map(([key, label]) => `<button class="spectator-link ${page === key ? 'active' : ''}" data-page="${key}" ${page === key ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</nav>
    </div>`;
  }

  function render() {
    document.body.classList.toggle('spectator', spectator && !!raceCode);
    document.body.classList.toggle('landing', !raceCode);
    document.body.classList.toggle('podium-screen', podiumPresentation);

    const labels = { welcome: 'Join an expedition', overview: 'Overview', race: 'Campfires', map: 'Expedition map', people: 'Racers & teams', analytics: 'Analytics', podium: 'Podium', history: 'Race vault' };
    $('#crumb').textContent = labels[page] || 'Overview';
    document.querySelectorAll('[data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === page));

    const views = { welcome, overview, race, map: routeMap, people: peoplePage, analytics, podium: podiumPage, history: vault };
    $('#view').innerHTML = !raceCode ? welcome() : sharePanel() + spectatorNavigation() + (!spectator && page !== 'overview' ? '<div class="admin-return"><button class="button tiny quiet" data-nav-back>← Back</button></div>' : '') + views[page]();
    $('#saveNow').style.display = spectator || !raceCode ? 'none' : '';
    $('#refresh').style.display = !raceCode ? 'none' : '';
    $('#spectate').style.display = !raceCode ? 'none' : '';
    $('#spectate').textContent = spectator ? '↩ Exit view' : '◉ Spectator';
    $('#spectate').style.display = podiumPresentation ? 'none' : '';
  }

  async function action(a, el) {
    const rid = el.dataset.id;
    const r = state.rounds.find((x) => x.id === rid);
    const idx = Number(el.dataset.index);

    if (spectator && !['mode','export-csv','export-json','download-archive','open-podium-screen','switch-race','copy-code','copy-spectator','reload-race','recover-access'].includes(a)) return;

    switch (a) {
      case 'copy-code': copyText(`PEAK-${raceCode}`); return;
      case 'copy-spectator': copyText(publicLink()); return;
      case 'copy-organizer': copyText(manageLink()); return;
      case 'copy-recovery': copyText(el.dataset.recovery || ''); return;
      case 'organizer-info': showCredentials(); return;
      case 'rotate-keys': rotateKeys(); return;
      case 'switch-race':
        if (dirty && !confirm('Unsynced changes will remain in the local cache. Export a backup before switching?')) return;
        location.href = location.pathname;
        return;
      case 'reload-race':
        loadCloud({ force: dirty, silent: false }); return;
      case 'recover-access':
        openModal('Recover organizer access', `<form id="recoverForm"><div class="field"><label>Race code</label><input name="code" required maxlength="20" placeholder="PEAK-ABCDEFGH"></div><div class="field"><label>Recovery key</label><textarea name="recoveryKey" required rows="3" maxlength="64" placeholder="64-character recovery key"></textarea></div><p class="subline">Recovering will invalidate the old organizer and recovery keys.</p>${modalActions('Recover access')}</form>`);
        return;
      case 'mode':
        state.appMode = el.dataset.value;
        persist();
        render();
        return;
      case 'new-round': newRound(); return;
      case 'refresh-map': getPeakMap(true); return;
      case 'import-map-rounds': {
        if (spectator) return;
        const route = mapIndex?.[mapDate];
        if (!route?.biomes?.length) return toast('No route loaded to create campfires');
        if (!confirm(`Create ${route.biomes.length} new draft campfires for ${mapDateText(mapDate)}? Existing campfires and results will be kept.`)) return;
        commit(() => {
          for (const biome of route.biomes) state.rounds.push({
            id:id(), name:biomeEmoji(`${biome} Campfire`), note:`PeakMap ${mapDateText(mapDate)} · ${route.level}`,
            finalized:false, teamAtFinish:{}, order:people().map(p=>({id:p.id,ghost:false}))
          });
        });
        page='race';render();toast(`${route.biomes.length} draft campfires created from published biome order`);
        return;
      }
      case 'new-player': setupPlayer(); return;
      case 'new-team': setupTeam(); return;
      case 'rename-player': setupPlayer(player(rid)); return;
      case 'rename-team': setupTeam(team(rid)); return;
      case 'edit-round': editRound(r); return;
      case 'settings': settings(); return;
      case 'add-score-position': {
        const container = document.querySelector('#scorePositions');
        if (!container || container.children.length >= 100) return;
        const lastValue = Number(container.lastElementChild?.querySelector('input')?.value || 0);
        container.insertAdjacentHTML('beforeend', scoreField(Math.max(0, lastValue - 1), container.children.length));
        refreshScorePositions();
        return;
      }
      case 'remove-score-position': {
        const container = document.querySelector('#scorePositions');
        if (!container || container.children.length <= 1) return;
        container.lastElementChild.remove();
        refreshScorePositions();
        return;
      }
      case 'close': closeModal(); return;
      case 'undo': undoAction(); return;
      case 'redo': redoAction(); return;
      case 'up':
      case 'down':
        if (!r || r.finalized) return;
        {
          const to = idx + (a === 'up' ? -1 : 1);
          if (to < 0 || to >= r.order.length) return;
          commit(() => {
            const [entry] = r.order.splice(idx, 1);
            r.order.splice(to, 0, entry);
          });
        }
        return;
      case 'ghost':
        if (r && !r.finalized) commit(() => {
          const found = r.order.find((o) => o.id === el.dataset.pid);
          if (found) found.ghost = !found.ghost;
        });
        return;
      case 'remove-entry':
        if (r && !r.finalized) commit(() => {
          r.order = r.order.filter((o) => o.id !== el.dataset.pid);
        });
        return;
      case 'add-entry': {
        if (!r || r.finalized) return;
        const options = people().filter((p) => !r.order.some((o) => o.id === p.id));
        if (!options.length) return toast('Everyone is already included');
        openModal('Add racer to campfire', `<form id="entryForm" data-id="${rid}"><div class="field"><label>Racer</label><select name="playerId">${options.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>${modalActions('Add to campfire')}</form>`);
        return;
      }
      case 'toggle-final':
        if (!r) return;
        if (r.finalized && !confirm('Reopen this checkpoint? Its points will temporarily leave official standings.')) return;
        commit(() => {
          r.finalized = !r.finalized;
          if (r.finalized) r.teamAtFinish = Object.fromEntries(r.order.map((o) => [o.id, player(o.id)?.teamId || null]));
        });
        toast(r.finalized ? 'Campfire finalized' : 'Campfire reopened');
        return;
      case 'del-round':
        if (r && confirm(`Delete ${r.name}?`)) {
          commit(() => { state.rounds = state.rounds.filter((x) => x.id !== rid); });
          closeModal();
        }
        return;
      case 'del-player': {
        const p = player(rid);
        if (p && confirm(`Remove ${p.name} and their checkpoint entries?`)) {
          commit(() => {
            state.players = people().filter((x) => x.id !== rid);
            state.rounds.forEach((round) => { round.order = round.order.filter((o) => o.id !== rid); });
          });
        }
        return;
      }
      case 'del-team': {
        const t = team(rid);
        if (t && confirm(`Delete ${t.name}? Its historical team scores may disappear.`)) {
          commit(() => {
            state.teams = teams().filter((x) => x.id !== rid);
            people().forEach((p) => { if (p.teamId === rid) p.teamId = null; });
          });
        }
        return;
      }
      case 'archive': archive(); return;
      case 'export-json': exportJson(); return;
      case 'export-csv': exportCsv(); return;
      case 'import': $('#importFile').click(); return;
      case 'restore-archive': {
        const item = readVault().find((x) => x.id === rid);
        if (item && confirm('Restore archived race and replace active race? Export current race first if needed.')) {
          commit(() => { state = normalize(item.data); });
          toast('Race restored');
        }
        return;
      }
      case 'download-archive': {
        const item = readVault().find((x) => x.id === rid);
        if (item) exportJson(item.data);
        return;
      }
      case 'del-archive':
        if (confirm('Permanently remove this local archive?')) {
          saveVault(readVault().filter((x) => x.id !== rid));
          render();
        }
        return;
      case 'reset':
        toast('Start a new expedition using Change race. Your current race will stay intact.');
        return;
      case 'open-podium-screen':
        window.open(`${location.pathname}?race=PEAK-${raceCode}&view=podium`, '_blank', 'noopener');
        return;
    }
  }

  function submitted(e) {
    const f = e.target;
    if (f.id === 'createRaceForm') {
      e.preventDefault();
      createRace(String(new FormData(f).get('raceName') || '').trim());
      return;
    }
    if (f.id === 'joinRaceForm') {
      e.preventDefault();
      const code = String(new FormData(f).get('code') || '').trim().toUpperCase().replace(/^PEAK-/, '');
      if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) return toast('Enter a valid PEAK race code.');
      location.href = `${location.pathname}?race=PEAK-${code}&view=spectator`;
      return;
    }
    if (f.id === 'recoverForm') {
      e.preventDefault();
      const data = new FormData(f);
      const code = String(data.get('code') || '').trim().toUpperCase().replace(/^PEAK-/, '');
      const key = String(data.get('recoveryKey') || '').trim().toLowerCase();
      if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code) || !/^[a-f0-9]{64}$/.test(key)) return toast('Check your race code and recovery key.');
      recoverAccess(code, key);
      return;
    }
    if (!['playerForm','teamForm','roundForm','entryForm','settingsForm'].includes(f.id)) return;
    e.preventDefault();
    const fd = new FormData(f);
    const name = String(fd.get('name') || '').trim();

    if (f.id === 'playerForm') {
      if (!name) return;
      commit(() => {
        const p = player(f.dataset.id);
        if (p) p.name = name;
        else state.players.push({ id: id(), name, teamId: null });
      });
    }

    if (f.id === 'teamForm') {
      if (!name) return;
      commit(() => {
        const t = team(f.dataset.id);
        if (t) {
          t.name = name;
          t.color = fd.get('color');
        } else {
          state.teams.push({ id: id(), name, color: fd.get('color') });
        }
      });
    }

    if (f.id === 'roundForm') {
      commit(() => {
        const round = state.rounds.find((x) => x.id === f.dataset.id);
        if (round) {
          round.name = biomeEmoji(name || round.name);
          round.note = String(fd.get('note') || '').slice(0, 500);
        }
      });
    }

    if (f.id === 'entryForm') {
      commit(() => {
        const round = state.rounds.find((x) => x.id === f.dataset.id);
        const pid = fd.get('playerId');
        if (round && !round.finalized && !round.order.some((o) => o.id === pid)) {
          round.order.push({ id: pid, ghost: false });
        }
      });
    }

    if (f.id === 'settingsForm') {
      const inputs = [...f.querySelectorAll('#scorePositions .score-value')];
      const v = inputs.map((input) => Number(input.value));
      if (!v.length || v.length > 100 || inputs.some((input) => input.value.trim() === '') || v.some((n) => !Number.isInteger(n) || n < 0 || n > 100)) return toast('Use 1–100 positions with whole scores from 0 to 100');
      commit(() => {
        state.raceName = name || 'The Great Climb';
        state.scoring = v;
      });
    }

    closeModal();
  }

  function setupDragAndDrop() {
    document.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.round-entry.draggable');
      if (!item || spectator) return;
      dragState = { roundId: item.dataset.roundId, entryId: item.dataset.entryId };
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragState.entryId);
    });

    document.addEventListener('dragover', (e) => {
      const item = e.target.closest('.round-entry.draggable');
      if (!item || !dragState || item.dataset.roundId !== dragState.roundId || item.dataset.entryId === dragState.entryId) return;
      e.preventDefault();
      cleanupDragHints();
      const rect = item.getBoundingClientRect();
      const after = (e.clientY - rect.top) > rect.height / 2;
      item.classList.add(after ? 'drop-after' : 'drop-before');
    });

    document.addEventListener('drop', (e) => {
      const item = e.target.closest('.round-entry.draggable');
      if (!item || !dragState || item.dataset.roundId !== dragState.roundId || item.dataset.entryId === dragState.entryId) return;
      e.preventDefault();
      const rect = item.getBoundingClientRect();
      const after = (e.clientY - rect.top) > rect.height / 2;
      const { roundId, entryId } = dragState;
      cleanupDragHints();
      dragState = null;
      reorderRound(roundId, entryId, item.dataset.entryId, after);
    });

    document.addEventListener('dragend', () => {
      dragState = null;
      cleanupDragHints();
    });
  }

  function init() {
    localLoad();
    render();
    status('', raceCode ? (dirty ? 'Unsynced edits from previous visit' : 'Connecting to race…') : 'Create or join a race');

    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-nav-back]')) {
        goBack();
        return;
      }
      const nav = e.target.closest('[data-page]');
      if (nav) {
        navigate(nav.dataset.page);
        return;
      }
      const b = e.target.closest('[data-action]');
      if (b) action(b.dataset.action, b);
    });

    document.addEventListener('submit', submitted);

    document.addEventListener('change', (e) => {
      const pid = e.target.dataset.teamSelect;
      if (pid) {
        commit(() => {
          const p = player(pid);
          if (p) p.teamId = e.target.value || null;
        });
      }
    });

    setupDragAndDrop();
    document.addEventListener('change', (e) => {
      if (e.target.id === 'mapDate' && mapIndex?.[e.target.value]) {
        mapDate = e.target.value; mapError = ''; render();
      }
    });

    $('#refresh').addEventListener('click', () => loadCloud({force:dirty}));
    $('#saveNow').addEventListener('click', () => saveCloud({ manual: true }));
    $('#spectate').addEventListener('click', () => {
      if (spectator) {
        location.href = location.pathname;
      } else {
        window.open(publicLink(), '_blank', 'noopener');
      }
    });
    $('#modalClose').addEventListener('click', closeModal);
    $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) {
        e.preventDefault();
        undoAction();
      }
    });

    $('#importFile').addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const raw = JSON.parse(await f.text());
        const s = normalize(raw);
        if (!confirm('Replace the current race with this imported file?')) return;
        commit(() => { state = s; });
        toast('Race imported successfully');
      } catch (ex) {
        toast(`Import error: ${ex.message}`);
      } finally {
        e.target.value = '';
      }
    });

    // Important: read remote before writing; never upload default empty state on page load.
    if (raceCode) {
      if (dirty && !spectator && !conflict) saveCloud();
      else if (!dirty) loadCloud({ silent: true });
      else status('error', 'Save conflict — reload needed');
    }
    // PeakMap fetch is optional; it never blocks the race API and never mutates race state.
    getPeakMap();
    setInterval(() => { if (raceCode && !document.hidden && !dirty) loadCloud({ silent: true }); }, 30000);
    window.addEventListener('online', () => { if (dirty) saveCloud(); else loadCloud({ silent: true }); });
    window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  }

  init();
})();
