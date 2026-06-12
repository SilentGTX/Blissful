'use strict';

const deck = document.getElementById('deck');
const fleetSummary = document.getElementById('fleetSummary');
const cardTemplate = document.getElementById('cardTemplate');
const modalVeil = document.getElementById('modalVeil');
const modalCancel = document.getElementById('modalCancel');
const modalConfirm = document.getElementById('modalConfirm');

const ICONS = {
  web: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.7 2.6 4.1 5.6 4.1 9s-1.4 6.4-4.1 9c-2.7-2.6-4.1-5.6-4.1-9s1.4-6.4 4.1-9z"/></svg>',
  desktop:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="12.5" rx="2"/><path d="M12 17v3.5"/><path d="M8.5 20.5h7"/></svg>',
  android:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6.5" width="19" height="12" rx="2.5"/><path d="M8 6.5 5 3.5"/><path d="m16 6.5 3-3"/></svg>',
};

const PHASE_LABEL = {
  stopped: 'Stopped',
  waiting: 'Waiting',
  starting: 'Starting',
  running: 'Running',
  external: 'Running',
  stopping: 'Stopping',
  crashed: 'Crashed',
};

const LOG_MAX = 200;
const LOG_HARD_MAX = 600;
const cards = new Map();
const logs = new Map();
let envs = [];

function envById(id) {
  return envs.find((e) => e.id === id) ?? null;
}

function buildCard(env) {
  const root = cardTemplate.content.firstElementChild.cloneNode(true);
  root.dataset.env = env.id;
  root.dataset.accent = env.accent;
  root.querySelector('.sigil').innerHTML = ICONS[env.id] ?? '';
  root.querySelector('.card-title').textContent = env.title;
  root.querySelector('.card-tagline').textContent = env.tagline;

  const refs = {
    root,
    phase: root.querySelector('.phase'),
    detail: root.querySelector('.detail'),
    chip: root.querySelector('.chip-port'),
    start: root.querySelector('.btn-start'),
    stop: root.querySelector('.btn-stop'),
    logwell: root.querySelector('.logwell'),
    log: root.querySelector('.log'),
  };

  refs.start.addEventListener('click', () => void window.launcher.start(env.id));
  refs.stop.addEventListener('click', () => requestStop(env.id));
  // Returning to the bottom re-pins and trims the scrollback we let grow.
  refs.log.addEventListener('scroll', () => {
    const el = refs.log;
    const buf = logs.get(env.id);
    if (!buf || buf.length <= LOG_MAX) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 24) {
      buf.splice(0, buf.length - LOG_MAX);
      renderLog(refs, buf);
      el.scrollTop = el.scrollHeight;
    }
  });
  refs.chip.addEventListener('click', () => {
    const current = envById(env.id);
    if (refs.chip.classList.contains('linked') && current?.url) {
      void window.launcher.open(current.url);
    }
  });

  deck.appendChild(root);
  cards.set(env.id, refs);
}

let modalReturnFocus = null;

function openModal() {
  modalReturnFocus = document.activeElement;
  deck.inert = true; // keep Tab/Enter away from the cards behind the veil
  modalVeil.hidden = false;
  modalConfirm.focus();
}

function closeModal() {
  modalVeil.hidden = true;
  deck.inert = false;
  if (modalReturnFocus && modalReturnFocus.isConnected) modalReturnFocus.focus();
  modalReturnFocus = null;
}

function requestStop(id) {
  if (id === 'web') {
    const desktop = envById('desktop');
    // Warn whenever a shell is alive on top of :5173 — ours or external.
    if (desktop && (desktop.managed || desktop.phase === 'external')) {
      openModal();
      return;
    }
  }
  void window.launcher.stop(id);
}

modalCancel.addEventListener('click', closeModal);
modalConfirm.addEventListener('click', () => {
  closeModal();
  void window.launcher.stop('web');
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modalVeil.hidden) closeModal();
});

function updateCard(env) {
  const refs = cards.get(env.id);
  if (!refs) return;
  const { phase } = env;
  refs.root.dataset.phase = phase;

  refs.phase.textContent = PHASE_LABEL[phase] ?? phase;
  refs.detail.textContent =
    phase === 'external' ? 'external — started outside the launcher' : (env.detail ?? '');

  refs.chip.textContent = env.livePort ? `:${env.livePort}` : env.portLabel;
  const linkable = Boolean(env.url) && (phase === 'running' || phase === 'external');
  refs.chip.classList.toggle('linked', linkable);
  refs.chip.title = linkable ? `open ${env.url}` : '';

  refs.start.disabled = !(phase === 'stopped' || phase === 'crashed');
  refs.stop.disabled = !(
    phase === 'running' ||
    phase === 'starting' ||
    phase === 'waiting'
  );
  refs.stop.textContent = phase === 'stopping' ? 'Stopping…' : 'Stop';
  refs.stop.title =
    phase === 'external' ? 'Started outside the launcher — stop it where you started it.' : '';
}

function updateFleet() {
  const live = envs.filter((e) => e.phase === 'running' || e.phase === 'external').length;
  fleetSummary.innerHTML = '';
  const strong = document.createElement('strong');
  strong.textContent = String(live);
  fleetSummary.append(strong, ` of ${envs.length} environments live`);
}

function applyState(snapshot) {
  envs = snapshot;
  for (const env of envs) {
    if (!cards.has(env.id)) buildCard(env);
    updateCard(env);
  }
  updateFleet();
}

function renderLog(refs, buf) {
  refs.log.textContent = buf.join('\n');
  refs.logwell.classList.toggle('has-output', buf.length > 0);
}

function appendLog(id, lines) {
  const buf = logs.get(id) ?? [];
  buf.push(...lines);
  logs.set(id, buf);

  const refs = cards.get(id);
  if (!refs) {
    if (buf.length > LOG_HARD_MAX) buf.splice(0, buf.length - LOG_MAX);
    return;
  }
  const el = refs.log;
  const pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  if (pinned) {
    if (buf.length > LOG_MAX) buf.splice(0, buf.length - LOG_MAX);
    renderLog(refs, buf);
    el.scrollTop = el.scrollHeight;
    return;
  }
  // Reading scrollback: append without trimming the head so the content
  // under the reader's eyes stays put (growth happens below the fold).
  // The hard cap bounds memory if they walk away mid-scroll.
  if (buf.length > LOG_HARD_MAX) buf.splice(0, buf.length - LOG_MAX);
  renderLog(refs, buf);
}

async function init() {
  const { envs: snapshot, logs: allLogs } = await window.launcher.getState();
  applyState(snapshot);
  for (const [id, lines] of Object.entries(allLogs)) {
    if (lines.length) appendLog(id, lines);
  }
  window.launcher.onState(applyState);
  window.launcher.onLog(({ id, lines }) => appendLog(id, lines));
}

void init();
