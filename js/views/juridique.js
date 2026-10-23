// Onglet JURIDIQUE : fiche du bien, documents à suivre, échéances administratives.
import { esc, today, fmtDate, nightsBetween } from '../utils.js';
import { db, upsert, remove, byId, setProperty } from '../store.js';
import { openSheet, field, row, toast, ask, empty } from '../ui.js';
import { sendDocButton, bindSendDoc } from '../vault.js';
import { renderChat } from './compta.js';

const state = { tab: 'fiche' };

export const DOC_STATUS = { ok: 'À jour', a_verifier: 'À vérifier', a_obtenir: 'À obtenir', expire: 'Expiré' };

export const dueDeadlines = (days = 30) => {
  const d = today();
  return db().deadlines.filter((x) => !x.done && x.date && nightsBetween(d, x.date) <= days);
};

function when(date) {
  const n = nightsBetween(today(), date);
  if (n < 0) return `<b class="neg">dépassée de ${-n} j</b>`;
  if (n === 0) return '<b class="neg">aujourd’hui</b>';
  if (n <= 30) return `<b class="warn-text">dans ${n} j</b>`;
  return `dans ${n < 365 ? `${n} j` : `${Math.round(n / 30)} mois`}`;
}

export function renderJuridique(root) {
  const { tab } = state;
  const sections = db().property.sections || [];
  const docs = [...db().documents].sort((a, b) => (a.status === 'ok') - (b.status === 'ok') || a.name.localeCompare(b.name, 'fr'));
  const deadlines = [...db().deadlines].sort((a, b) => (a.done - b.done) || (a.date || '').localeCompare(b.date || ''));

  let body;
  if (tab === 'fiche') {
    body = sections.length ? sections.map((s, i) => `
      <div class="card fiche">
        <div class="card-head"><h3 class="card-title">${esc(s.title)}</h3><button class="link" data-sec="${i}">Modifier</button></div>
        <div class="fiche-body">${esc(s.body).replace(/\n/g, '<br>')}</div>
      </div>`).join('') + '<button class="btn block" data-sec="new">+ Ajouter une rubrique</button>'
      : empty('La fiche du bien est vide.', '<button class="btn primary" data-sec="new">+ Ajouter une rubrique</button>');
  } else if (tab === 'docs') {
    body = `<button class="btn block primary" data-doc="new">+ Ajouter un document</button>
      ${docs.length ? `<div class="list">${docs.map((x) => `
        <button class="item" data-doc="${x.id}">
          <span class="item-main"><strong>${esc(x.name)}</strong><small>${[x.ref, x.date && `du ${fmtDate(x.date, { day: 'numeric', month: 'short', year: 'numeric' })}`, x.expiry && `valable jusqu’au ${fmtDate(x.expiry, { day: 'numeric', month: 'short', year: 'numeric' })}`].filter(Boolean).map(esc).join(' · ')}</small></span>
          <span class="badge ${x.status === 'ok' ? '' : x.status === 'a_obtenir' || x.status === 'expire' ? 'annulee' : 'option'}">${DOC_STATUS[x.status] || ''}</span>
        </button>`).join('')}</div>` : empty('Aucun document suivi.')}`;
  } else {
    body = `<button class="btn block primary" data-dl="new">+ Ajouter une échéance</button>
      ${deadlines.length ? `<div class="list">${deadlines.map((x) => `
        <div class="item task ${x.done ? 'is-done' : ''}">
          <button class="tick" data-dl-tick="${x.id}" aria-label="${x.done ? 'Rouvrir' : 'Marquer fait'}">${x.done ? '✓' : ''}</button>
          <button class="item-main as-btn" data-dl="${x.id}"><strong>${esc(x.title)}</strong><small>${fmtDate(x.date, { day: 'numeric', month: 'long', year: 'numeric' })}${x.done ? '' : ` · ${when(x.date)}`}</small></button>
        </div>`).join('')}</div>` : empty('Aucune échéance.')}`;
  }

  root.innerHTML = `
    <header class="top"><div><p class="eyebrow">Juridique et administratif</p><h1>Le bien et ses obligations</h1></div></header>
    ${sendDocButton('Juridique', 'À classer', 'Envoyer un courrier ou un contrat (photo, PDF)')}
    <div class="segmented">
      ${[['fiche', 'Fiche du bien'], ['docs', `Documents (${docs.length})`], ['dates', 'Échéances'], ['chat', 'Chat Claude']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}
    </div>
    <div id="jur-body">${tab === 'chat' ? '' : body}</div>
  `;
  bindSendDoc(root);
  if (tab === 'chat') renderChat(root.querySelector('#jur-body'), 'juridique');
  root.onclick = (e) => {
    const el = e.target.closest('[data-tab],[data-sec],[data-doc],[data-dl],[data-dl-tick]');
    if (!el) return;
    if (el.dataset.tab) { state.tab = el.dataset.tab; renderJuridique(root); }
    else if (el.dataset.sec) sectionForm(el.dataset.sec === 'new' ? null : Number(el.dataset.sec));
    else if (el.dataset.doc) docForm(el.dataset.doc === 'new' ? null : byId('documents', el.dataset.doc));
    else if (el.dataset.dlTick) { const x = byId('deadlines', el.dataset.dlTick); upsert('deadlines', { ...x, done: !x.done }); }
    else if (el.dataset.dl) deadlineForm(el.dataset.dl === 'new' ? null : byId('deadlines', el.dataset.dl));
  };
}

function sectionForm(index) {
  const sections = [...(db().property.sections || [])];
  const s = index === null ? { title: '', body: '' } : sections[index];
  openSheet({
    title: index === null ? 'Nouvelle rubrique' : 'Modifier la rubrique',
    body: `${field({ name: 'title', label: 'Titre', value: s.title, required: true })}
      ${field({ name: 'body', label: 'Contenu', type: 'textarea', rows: 14, value: s.body })}`,
    onSubmit(v) {
      const next = { title: v.title.trim(), body: v.body };
      if (index === null) sections.push(next); else sections[index] = next;
      setProperty(sections);
      toast('Fiche enregistrée');
    },
    onDelete: index === null ? null : async () => {
      if (!(await ask('Supprimer cette rubrique ?', { ok: 'Supprimer', danger: true }))) return false;
      sections.splice(index, 1);
      setProperty(sections);
    },
  });
}

function docForm(existing) {
  const x = existing || { status: 'a_obtenir' };
  openSheet({
    title: existing ? 'Document' : 'Nouveau document',
    body: `
      ${field({ name: 'name', label: 'Document', value: x.name, required: true, placeholder: 'Ex. Règlement de copropriété' })}
      ${row(field({ name: 'status', label: 'Statut', type: 'select', options: Object.entries(DOC_STATUS).map(([value, label]) => ({ value, label })), value: x.status }),
        field({ name: 'ref', label: 'Référence', value: x.ref }))}
      ${row(field({ name: 'date', label: 'Date', type: 'date', value: x.date }), field({ name: 'expiry', label: 'Valable jusqu’au', type: 'date', value: x.expiry }))}
      ${field({ name: 'location', label: 'Où il est rangé', value: x.location, placeholder: 'Drive, mail du…, classeur papier' })}
      ${field({ name: 'notes', label: 'Notes', type: 'textarea', value: x.notes })}
    `,
    onSubmit(v) {
      upsert('documents', { ...(existing || {}), name: v.name.trim(), status: v.status, ref: v.ref, date: v.date, expiry: v.expiry, location: v.location, notes: v.notes });
      toast('Document enregistré');
    },
    onDelete: existing ? async () => {
      if (!(await ask('Supprimer ce document de la liste ?', { ok: 'Supprimer', danger: true }))) return false;
      remove('documents', existing.id);
    } : null,
  });
}

function deadlineForm(existing) {
  const x = existing || { date: today(), done: false };
  openSheet({
    title: existing ? 'Échéance' : 'Nouvelle échéance',
    body: `
      ${field({ name: 'title', label: 'Quoi', value: x.title, required: true })}
      ${field({ name: 'date', label: 'Date limite', type: 'date', value: x.date, required: true })}
      ${field({ name: 'notes', label: 'Notes', type: 'textarea', value: x.notes })}
      ${field({ name: 'done', label: 'Fait', type: 'checkbox', value: x.done })}
    `,
    onSubmit(v) {
      upsert('deadlines', { ...(existing || {}), title: v.title.trim(), date: v.date, notes: v.notes, done: v.done });
      toast('Échéance enregistrée');
    },
    onDelete: existing ? async () => {
      if (!(await ask('Supprimer cette échéance ?', { ok: 'Supprimer', danger: true }))) return false;
      remove('deadlines', existing.id);
    } : null,
  });
}
