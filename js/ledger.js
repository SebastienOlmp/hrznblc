// Déclenchement des tâches Claude depuis l'appli :
// - report au classeur comptable maître après chaque saisie comptable ;
// - suivi des tâches quand Sébastien répond à une tâche.
// Les demandes sont regroupées quelques secondes, puis envoyées (ou à la fermeture de l'appli).
import { db } from './store.js';

const QUEUES = {
  ledger: { trigger: 'trig_0132fvLHYPUEWAh5pcMvpHEa', delay: 45000, prefix: 'Changements dans l’appli', reasons: new Set(), timer: null },
  tasks: { trigger: 'trig_017YY4BSkbbfYv8vTrGHCput', delay: 20000, prefix: 'Réponses aux tâches', reasons: new Set(), timer: null },
  docs: { trigger: 'trig_01L8icahbpXr8JK3AbWYF4G4', delay: 15000, prefix: 'Documents envoyés', reasons: new Set(), timer: null },
};
let notify = () => {};
export const setLedgerNotifier = (fn) => { notify = fn; };

/** État du report au classeur : 'attente' (saisies à envoyer), 'envoye' (mise à jour demandée), null. */
export function ledgerStatus() {
  if (QUEUES.ledger.reasons.size) return 'attente';
  const req = db().ledgerRequest?.requestedAt;
  const meta = db().ledger || {};
  // Une date seule (AAAA-MM-JJ) vaut pour toute la journée.
  const full = (d) => (d && d.length === 10 ? `${d}T23:59:59Z` : d);
  const last = [full(meta.lastCheck), ...(meta.versions || []).map((v) => v.updatedAt)].filter(Boolean).sort().pop() || '';
  return req && req > last ? 'envoye' : null;
}

function enqueue(kind, reason) {
  const q = QUEUES[kind];
  if (q.reasons.size < 30) q.reasons.add(reason);
  clearTimeout(q.timer);
  q.timer = setTimeout(() => send(kind), q.delay);
  notify();
}

export const requestLedgerUpdate = (reason) => enqueue('ledger', reason);
export const requestTaskFollowUp = (reason) => enqueue('tasks', reason);
export const requestDocFiling = (reason) => enqueue('docs', reason);

let mcpPromise = null;
const getMcp = () => (mcpPromise ||= Promise.resolve(window.claude?.use?.('mcp')).catch(() => null));

async function send(kind) {
  const q = QUEUES[kind];
  clearTimeout(q.timer);
  if (!q.reasons.size) return;
  const text = `${q.prefix} : ${[...q.reasons].join(' ; ')}.`;
  const mcp = await getMcp();
  if (!mcp) return; // hors claude.ai : les tâches planifiées prendront le relais
  try {
    await mcp.callTool('Claude Code Remote', 'fire_trigger', { trigger_id: q.trigger, text }, { cache: false });
    q.reasons.clear();
    if (kind === 'ledger') {
      try {
        const ns = await window.claude.use('db');
        await ns?.doc('ledger/request').set({ requestedAt: new Date().toISOString(), text });
      } catch { /* l'indicateur d'état est facultatif */ }
    }
  } catch (e) {
    // Accès refusé ou indisponible : la demande reste en file et repartira au prochain essai.
    console.warn('Tâche Claude non déclenchée', kind, e?.code);
  }
  notify();
}

export const fire = () => send('ledger');

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') Object.keys(QUEUES).forEach(send);
});
