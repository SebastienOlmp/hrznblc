// Report au classeur comptable maître : après chaque saisie comptable dans l'appli, on déclenche
// (une fois les saisies terminées) la tâche Claude qui met le fichier Excel à jour.
import { db } from './store.js';

const TRIGGER_ID = 'trig_0132fvLHYPUEWAh5pcMvpHEa';
const DELAY = 45000; // regroupe les saisies faites à la suite
const reasons = new Set();
let timer = null;
let notify = () => {};

export const setLedgerNotifier = (fn) => { notify = fn; };

/** État affiché dans l'appli : 'attente' (saisies à envoyer), 'envoye' (mise à jour demandée), null. */
export function ledgerStatus() {
  if (reasons.size) return 'attente';
  const req = db().ledgerRequest?.requestedAt;
  const meta = db().ledger || {};
  const last = [meta.lastCheck, ...(meta.versions || []).map((v) => v.updatedAt)].filter(Boolean).sort().pop() || '';
  return req && req > last ? 'envoye' : null;
}

export function requestLedgerUpdate(reason) {
  reasons.add(reason);
  clearTimeout(timer);
  timer = setTimeout(fire, DELAY);
  notify();
}

let mcpPromise = null;
const getMcp = () => (mcpPromise ||= Promise.resolve(window.claude?.use?.('mcp')).catch(() => null));

export async function fire() {
  clearTimeout(timer);
  if (!reasons.size) return;
  const text = `Changements dans l’appli : ${[...reasons].join(' ; ')}.`;
  const mcp = await getMcp();
  if (!mcp) return; // hors claude.ai : le report hebdomadaire du dimanche prendra le relais
  try {
    await mcp.callTool('Claude Code Remote', 'fire_trigger', { trigger_id: TRIGGER_ID, text }, { cache: false });
    reasons.clear();
    try {
      const ns = await window.claude.use('db');
      await ns?.doc('ledger/request').set({ requestedAt: new Date().toISOString(), text });
    } catch { /* l'indicateur d'état est facultatif */ }
  } catch (e) {
    // Accès refusé ou indisponible : on garde les changements, ils partiront au prochain essai ou le dimanche.
    console.warn('Report au classeur non déclenché', e?.code);
  }
  notify();
}

// Ne pas perdre une demande si l'appli est fermée avant la fin du délai.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') fire(); });
