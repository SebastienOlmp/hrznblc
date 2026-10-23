// Suivi de la dette personnelle envers Régine — HORS COMPTABILITÉ.
// Rien de cet écran n'est reporté au classeur : c'est un suivi privé entre Sébastien et sa mère.
import { esc, money, num, today, fmtDate } from '../utils.js';
import { db, upsert } from '../store.js';
import { openSheet, field, row, toast, ask, empty } from '../ui.js';

const KINDS = { pret: 'Elle m’a prêté / avancé', remboursement: 'Je l’ai remboursée', abandon: 'Elle renonce (don)' };
const sign = (e) => (e.kind === 'pret' ? 1 : -1) * (Number(e.amount) || 0);

function entryForm(existing) {
  const e = existing || { date: today(), kind: 'pret' };
  openSheet({
    title: existing ? 'Mouvement' : 'Nouveau mouvement',
    body: `
      ${field({ name: 'label', label: 'Objet', value: e.label, required: true, placeholder: 'Ex. Apport pour l’acquisition' })}
      ${row(field({ name: 'amount', label: 'Montant', type: 'money', value: e.amount, required: true }), field({ name: 'date', label: 'Date', type: 'date', value: e.date, required: true }))}
      ${field({ name: 'kind', label: 'Sens', type: 'select', options: Object.entries(KINDS).map(([value, label]) => ({ value, label })), value: e.kind })}
      ${field({ name: 'notes', label: 'Notes (mode de versement, preuve, accord)', type: 'textarea', value: e.notes })}
    `,
    onSubmit(v) {
      if (num(v.amount) <= 0) { toast('Indiquez un montant.'); return false; }
      upsert('famille', { ...(existing || {}), label: v.label.trim(), amount: num(v.amount), date: v.date, kind: v.kind, notes: v.notes, archived: false });
      toast('Mouvement enregistré');
    },
    deleteLabel: 'Archiver ce mouvement',
    onDelete: existing ? async () => {
      if (!(await ask('Archiver ce mouvement ? Il ne compte plus dans le total mais reste visible en bas de page.', { ok: 'Archiver' }))) return false;
      upsert('famille', { ...existing, archived: true });
    } : null,
  });
}

export function renderFamille(root) {
  const all = [...db().famille].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const live = all.filter((e) => !e.archived);
  const balance = live.reduce((s, e) => s + sign(e), 0);
  const lent = live.filter((e) => e.kind === 'pret').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const back = live.filter((e) => e.kind !== 'pret').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const inLedger = -(Number(db().ledgerSummary?.owedToRegine) || 0);

  root.innerHTML = `
    <header class="top"><div><p class="eyebrow">Hors comptabilité</p><h1>Ce que je dois à Régine</h1></div>
      <button class="btn primary" data-act="new">+ Mouvement</button></header>
    <div class="result-band ${balance > 0 ? 'neg' : 'pos'}">
      <small>Reste dû à Régine</small>
      <strong>${money(balance)}</strong>
      <span>${money(lent)} prêtés ou avancés − ${money(back)} remboursés ou abandonnés</span>
    </div>
    <p class="hint">Suivi personnel : rien ici n’entre dans le classeur comptable. Dans la comptabilité, ces sommes apparaissent comme vos apports (compte 108000).${inLedger ? ` Les avances d’achats que l’activité doit à Régine (467600) sont suivies à part dans Compta : ${money(-inLedger)}.` : ''}</p>
    ${live.length ? `<div class="list">${live.map((e) => `
      <button class="item" data-e="${e.id}">
        <span class="item-main"><strong>${esc(e.label)}</strong><small>${fmtDate(e.date, { day: 'numeric', month: 'short', year: 'numeric' })} · ${KINDS[e.kind]}${e.notes ? ` · ${esc(e.notes.slice(0, 60))}` : ''}</small></span>
        <span class="item-side"><span class="${e.kind === 'pret' ? 'neg' : 'pos'}">${e.kind === 'pret' ? '+' : '−'}${money(e.amount)}</span></span>
      </button>`).join('')}</div>` : empty('Aucun mouvement.')}
    <div class="card">
      <h3 class="card-title">À savoir</h3>
      <p class="hint">Une somme importante prêtée sans écrit entre parent et enfant peut être requalifiée en donation par l’administration (droits de donation, rapport à la succession). Une reconnaissance de dette datée et signée, avec un échéancier même souple, protège les deux parties. À faire valider par un notaire ou votre CGP.</p>
    </div>
    ${all.length > live.length ? `<details class="howto"><summary>Mouvements archivés (${all.length - live.length})</summary><div class="list">${all.filter((e) => e.archived).map((e) => `<button class="item" data-e="${e.id}"><span class="item-main"><strong>${esc(e.label)}</strong><small>${fmtDate(e.date, { day: 'numeric', month: 'short', year: 'numeric' })}</small></span><span class="item-side"><span>${money(e.amount)}</span></span></button>`).join('')}</div></details>` : ''}
  `;
  root.onclick = (ev) => {
    const el = ev.target.closest('[data-act],[data-e]');
    if (!el) return;
    if (el.dataset.act === 'new') entryForm(null);
    else entryForm(db().famille.find((x) => x.id === el.dataset.e));
  };
}
