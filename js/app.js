// Point d'entrée : navigation par onglets, rendu, synchronisation.
import { $, esc } from './utils.js';
import { connect, onChange, isReady, setErrorHandler, db, setAccountingHook } from './store.js';
import { requestLedgerUpdate, requestTaskFollowUp, setLedgerNotifier } from './ledger.js';
import { setTaskHook } from './views/forms.js';
import { initSheet, toast } from './ui.js';
import { renderCalendar } from './views/calendar.js';
import { renderCompta, pendingInbox } from './views/compta.js';
import { renderTodo, openTasks } from './views/todo.js';
import { renderDiscussions } from './views/discussions.js';
import { renderJuridique, dueDeadlines } from './views/juridique.js';
import { renderConciergerie } from './views/conciergerie.js';
import { renderTaxe } from './views/taxe.js';
import { renderBanque } from './views/banque.js';
import { renderTarification } from './views/tarification.js';
import { renderReglages } from './views/reglages.js';
import { renderDocuments } from './vault.js';
import { renderFamille } from './views/famille.js';

const VIEWS = {
  planning: renderCalendar,
  compta: renderCompta,
  todo: renderTodo,
  discussions: renderDiscussions,
  plus: renderPlus,
  juridique: renderJuridique,
  conciergerie: renderConciergerie,
  taxe: renderTaxe,
  banque: renderBanque,
  tarification: renderTarification,
  reglages: renderReglages,
  documents: renderDocuments,
  famille: renderFamille,
};
const MAIN_TABS = ['planning', 'compta', 'todo', 'discussions'];
const MORE = [
  ['documents', 'Documents', 'Coffre : toutes les pièces, classeur Excel, export'],
  ['juridique', 'Juridique', 'Fiche du bien, documents, échéances'],
  ['conciergerie', 'Conciergerie', 'Prestations, minimum hiver, cautions'],
  ['taxe', 'Taxe de séjour', 'Nuitées, déclarations, reversements'],
  ['banque', 'Banque', 'Relevé, rapprochement, emprunt'],
  ['tarification', 'Tarification', 'Grille, historique, veille'],
  ['famille', 'Dette Régine', 'Hors compta : prêts et remboursements'],
  ['reglages', 'Réglages', 'Boîtes mail, taux, tarifs, sauvegarde'],
];

let current = 'planning';
let renderPending = false;

function renderPlus(root) {
  const due = dueDeadlines(30);
  root.innerHTML = `
    <header class="top"><div><p class="eyebrow">${esc(db().settings.name)}</p><h1>Plus</h1></div></header>
    ${due.length ? `<button class="banner" data-go="juridique">⚠︎ ${due.length} échéance${due.length > 1 ? 's' : ''} dans les 30 jours ou dépassée${due.length > 1 ? 's' : ''}</button>` : ''}
    <div class="plus-grid">${MORE.map(([k, l, d]) => `<button class="tile" data-go="${k}"><strong>${l}</strong><small>${d}</small></button>`).join('')}</div>
  `;
  root.onclick = (e) => { const el = e.target.closest('[data-go]'); if (el) go(el.dataset.go); };
}

function badges() {
  const set = (tab, n) => {
    const a = document.querySelector(`.tabbar [data-tab="${tab}"]`);
    let b = a.querySelector('.count');
    if (!n) { b?.remove(); return; }
    if (!b) { b = document.createElement('span'); b.className = 'count'; a.appendChild(b); }
    b.textContent = n > 99 ? '99+' : String(n);
  };
  set('compta', pendingInbox().length);
  const today = new Date().toISOString().slice(0, 10);
  set('todo', openTasks().filter((t) => t.kind === 'decision' || (t.date && t.date < today)).length);
  set('plus', dueDeadlines(30).length);
}

function render() {
  const root = $('#view');
  if (!isReady()) {
    root.innerHTML = '<div class="loading"><p>Chargement des données…</p></div>';
    return;
  }
  // Ne pas effacer une saisie en cours : on attend que le champ perde le focus.
  const a = document.activeElement;
  if (a && root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'file') {
    renderPending = true;
    return;
  }
  renderPending = false;
  (VIEWS[current] || renderCalendar)(root);
  const tab = MAIN_TABS.includes(current) ? current : 'plus';
  document.querySelectorAll('.tabbar [data-tab]').forEach((el) => el.setAttribute('aria-current', el.dataset.tab === tab ? 'page' : 'false'));
  badges();
}

function go(view) {
  if (!VIEWS[view]) return;
  current = view;
  try { history.replaceState(null, '', `#${view}`); } catch { /* adresse non modifiable dans ce cadre */ }
  renderPending = false;
  const root = $('#view');
  root.onclick = null; root.onchange = null; root.onsubmit = null;
  render();
  window.scrollTo(0, 0);
}

document.addEventListener('focusout', () => setTimeout(() => { if (renderPending) render(); }, 0));
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (VIEWS[h] && h !== current) go(h); });
document.querySelector('.tabbar').addEventListener('click', (e) => {
  const el = e.target.closest('[data-tab]');
  if (el) { e.preventDefault(); go(el.dataset.tab); }
});

initSheet();
setErrorHandler((msg) => toast(msg));
onChange(render);
setAccountingHook(requestLedgerUpdate);
setTaskHook(requestTaskFollowUp);
setLedgerNotifier(render);
const start = location.hash.slice(1);
if (VIEWS[start]) current = start;
render();
connect(render);
