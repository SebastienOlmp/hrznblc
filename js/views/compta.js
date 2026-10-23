// Onglet COMPTA : résultat net, dépenses, éléments détectés dans les mails à valider, assistant Claude.
import { esc, money, money0, pct, fmtDate, MONTHS_SHORT, plural, today, num } from '../utils.js';
import { db, upsert, yearStats, yearsWithData, EXPENSE_ACCOUNTS, accountLabel, isActive, resNet, saveChatMessage } from '../store.js';
import { expenseForm } from './forms.js';
import { empty, saveFile, toast, attachmentLinks } from '../ui.js';
import { archiveFile, downloadWorkbook } from '../vault.js';
import { journalCSV } from '../compta.js';
import { ledgerStatus, fire } from '../ledger.js';

const state = { year: new Date().getFullYear(), tab: 'synthese', account: null, month: null };

export const pendingInbox = () => db().inbox.filter((x) => x.status === 'a_valider' && x.proposal);

/** Chiffres du classeur maître pour l'exercice affiché, ou null si le classeur ne couvre pas cette année. */
function ledgerFor(year) {
  const L = db().ledgerSummary || {};
  return L.lines?.length && Number(String(L.exerciseEnd || '').slice(0, 4)) === year ? L : null;
}

/** Opérations saisies dans l'appli et pas encore reportées au classeur (évite le double comptage). */
function pendingFor(year) {
  const y = String(year);
  const exp = db().expenses.filter((e) => !e.ledgerEntry && e.date?.startsWith(y) && !String(e.account).startsWith('2'));
  const res = db().reservations.filter((r) => !r.ledgerEntry && isActive(r) && r.start?.startsWith(y));
  return {
    expenses: exp.reduce((s, e) => s + (Number(e.amount) || 0), 0), nExp: exp.length,
    revenue: res.reduce((s, r) => s + resNet(r), 0), nRes: res.length,
  };
}

export function renderCompta(root) {
  const { year } = state;
  const L = ledgerFor(year);
  if (state.tab === 'journal' && !L) state.tab = 'synthese';
  const { tab } = state;
  const { months, totals } = yearStats(year);
  const years = yearsWithData();
  if (L && !years.includes(year)) years.unshift(year);
  if (!years.includes(year)) years.unshift(year);
  const expenses = db().expenses.filter((e) => e.date?.startsWith(String(year))).sort((a, b) => b.date.localeCompare(a.date));
  const pending = pendingInbox();
  const p = pendingFor(year);

  let band = '';
  if (!L) {
    band = `<div class="result-band ${totals.result < 0 ? 'neg' : 'pos'}">
      <small>Résultat ${year} selon l’appli · avant amortissements</small>
      <strong>${money0(totals.result)}</strong>
      <span>${money0(totals.net)} de recettes nettes − ${money0(totals.expenses)} de charges</span>
    </div>`;
  }

  const tabs = [['synthese', 'Synthèse'], ...(L ? [['journal', 'Journal']] : []), ['valider', `À valider${pending.length ? ` (${pending.length})` : ''}`], ['depenses', 'Dépenses'], ['pieces', 'Justificatifs'], ['claude', 'Chat Claude']];
  root.innerHTML = `
    <header class="top">
      <div><p class="eyebrow">Compta</p><h1>Exercice ${year}</h1></div>
      <select class="year-select" id="compta-year" aria-label="Exercice">${years.map((y) => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select>
    </header>
    ${band}
    ${statusLine()}
    ${scanTile()}
    <div class="segmented">
      ${tabs.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}
    </div>
    <div id="compta-body"></div>
  `;
  const body = root.querySelector('#compta-body');
  if (tab === 'synthese') body.innerHTML = L ? syntheseLedger(year, L, totals, p) : synthese(year, months, totals, expenses);
  else if (tab === 'journal') body.innerHTML = journalView(L);
  else if (tab === 'valider') body.innerHTML = valider(pending);
  else if (tab === 'depenses') body.innerHTML = depenses(year, expenses);
  else if (tab === 'pieces') body.innerHTML = justificatifs(year);
  else renderChat(body);
  root.querySelectorAll('[data-scan]').forEach((inp) => inp.addEventListener('change', (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) scanInvoice(f); }));

  root.querySelector('#compta-year').onchange = (e) => { state.year = Number(e.target.value); renderCompta(root); };
  root.onclick = async (e) => {
    const el = e.target.closest('[data-tab],[data-month],[data-exp],[data-act],[data-inbox],[data-ignore],[data-acc]');
    if (!el) return;
    if (el.dataset.tab) { state.tab = el.dataset.tab; state.account = null; renderCompta(root); }
    else if (el.dataset.month) {
      const [y, m] = state.month.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 + Number(el.dataset.month), 1));
      state.month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      if (d.getUTCFullYear() !== state.year) state.year = d.getUTCFullYear();
      renderCompta(root);
    }
    else if (el.dataset.acc !== undefined) { state.tab = 'journal'; state.account = el.dataset.acc || null; renderCompta(root); window.scrollTo(0, 0); }
    else if (el.dataset.exp) expenseForm(db().expenses.find((x) => x.id === el.dataset.exp));
    else if (el.dataset.inbox) validateInbox(el.dataset.inbox);
    else if (el.dataset.ignore) {
      const item = db().inbox.find((x) => x.id === el.dataset.ignore);
      if (item) { upsert('inbox', { ...item, status: 'ignore' }); toast('Ignoré'); }
    } else if (el.dataset.act === 'new-exp') expenseForm(null);
    else if (el.dataset.act === 'ledger-now') fire();
    else if (el.dataset.act === 'xlsx') downloadWorkbook();
    else if (el.dataset.act === 'csv') {
      const { csv, rows } = journalCSV(year);
      if (!rows.length) { toast(`Aucune opération de l’appli à exporter pour ${year}.`); return; }
      await saveFile(`ecritures_horizon-blanc-403_${year}.csv`, csv);
    }
  };
}

function statusLine() {
  const st = ledgerStatus();
  if (st === 'attente') return '<button class="banner info" data-act="ledger-now">Saisies en attente de report au classeur · envoyer maintenant</button>';
  if (st === 'envoye') return '<p class="banner info">Mise à jour du classeur en cours (quelques minutes)…</p>';
  return '';
}

/** Saisies de l'appli non reportées, pour un mois "AAAA-MM". */
function pendingMonth(ym) {
  const exp = db().expenses.filter((e) => !e.ledgerEntry && e.date?.startsWith(ym) && !String(e.account).startsWith('2'))
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const rev = db().reservations.filter((r) => !r.ledgerEntry && isActive(r) && r.start?.startsWith(ym))
    .reduce((s, r) => s + resNet(r), 0);
  return { exp, rev };
}

function monthFigures(L, ym) {
  let produits = 0, charges = 0;
  for (const l of L.lines || []) {
    if (!l.date.startsWith(ym)) continue;
    if (l.account.startsWith('7')) produits += l.credit - l.debit;
    else if (l.account.startsWith('6')) charges += l.debit - l.credit;
  }
  const p = pendingMonth(ym);
  return { produits: produits + p.rev, charges: charges + p.exp, pending: p.rev || p.exp };
}

const fig = (label, value, cls = '') => `<div class="fig ${cls}"><small>${label}</small><strong>${money(value)}</strong></div>`;

function monthCard(L, year) {
  const cur = today().slice(0, 7);
  if (!state.month || !state.month.startsWith(String(year))) state.month = cur.startsWith(String(year)) ? cur : `${year}-12`;
  const ym = state.month;
  const m = monthFigures(L, ym);
  const r = m.produits - m.charges;
  const label = new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return `<div class="card period">
    <div class="period-head">
      <button class="icon-btn" data-month="-1" aria-label="Mois précédent"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>
      <h3 class="card-title">${label.charAt(0).toUpperCase() + label.slice(1)}</h3>
      <button class="icon-btn" data-month="1" aria-label="Mois suivant"><svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button>
    </div>
    <div class="figs">${fig('Produits', m.produits)}${fig('Charges', m.charges)}${fig('Résultat du mois', r, r < 0 ? 'neg' : 'pos')}</div>
    ${m.pending ? '<small class="hint">Inclut des saisies de l’appli en cours de report au classeur.</small>' : ''}
  </div>`;
}

function yearCard(L, year, p) {
  const produits = L.produits + p.revenue;
  const charges = L.charges + p.expenses;
  const before = produits - charges;
  const dot = Number(L.depreciation?.[String(year)]) || 0;
  const net = before - dot;
  return `<div class="card period">
    <h3 class="card-title">Année ${year}</h3>
    <div class="figs">${fig('Produits', produits)}${fig('Charges', charges)}${fig('Résultat net', net, net < 0 ? 'neg' : 'pos')}</div>
    <ul class="kv">
      <li><span>Résultat avant amortissements</span><span>${money(before)}</span></li>
      <li><span>Amortissements de l’année (prévus au classeur)</span><span>−${money(dot)}</span></li>
    </ul>
    <small class="hint">Les amortissements sont passés au 31/12. Fiscalement, la part qui créerait ou aggraverait un déficit est reportée sans limite de durée.</small>
  </div>`;
}

function bars(series) {
  const max = Math.max(1, ...series.map((x) => Math.max(x.inn, x.out)));
  return series.map((x, i) => `
    <div class="bar-col" title="${MONTHS_SHORT[i]} : ${money0(x.inn)} / ${money0(x.out)}">
      <div class="bars"><i class="b-in" style="height:${(x.inn / max) * 100}%"></i><i class="b-out" style="height:${(x.out / max) * 100}%"></i></div>
      <small>${MONTHS_SHORT[i].charAt(0).toUpperCase()}</small>
    </div>`).join('');
}

function syntheseLedger(year, L, totals, p) {
  const top3 = monthCard(L, year) + yearCard(L, year, p);
  const series = MONTHS_SHORT.map((_, i) => {
    const m = L.months?.[`${year}-${String(i + 1).padStart(2, '0')}`] || {};
    return { inn: m.produits || 0, out: m.charges || 0 };
  });
  const charges = (L.accounts || []).filter((a) => a.code.startsWith('6') && a.balance).sort((a, b) => b.balance - a.balance);
  const top = charges[0]?.balance || 1;
  const meta = db().ledger || {};
  const v = (meta.versions || []).find((x) => x.version === meta.currentVersion);
  const ok = L.journalGap === 0 && L.bankGap === 0;
  return `
    ${top3}
    <div class="kpis">
      <div class="kpi"><small>Trésorerie (512100)</small><strong>${money(L.bank)}</strong></div>
      <div class="kpi"><small>Capital restant dû</small><strong>${money0(L.loanOutstanding)}</strong></div>
      <div class="kpi"><small>Apports nets de l’exploitant (108000)</small><strong>${money0(L.ownerAccount)}</strong></div>
      <div class="kpi"><small>Dû à Régine (467600)</small><strong>${money(L.owedToRegine)}</strong></div>
      <div class="kpi"><small>Immobilisations brutes</small><strong>${money0(L.fixedAssets)}</strong></div>
      <div class="kpi"><small>Occupation ${year}</small><strong>${pct(totals.occupancy)}</strong><em>${plural(totals.nights, 'nuit', 'nuits')}</em></div>
    </div>
    <div class="card">
      <h3 class="card-title">Par mois (classeur)</h3>
      <div class="chart">${bars(series)}</div>
      <div class="legend"><span><i class="dot b-in"></i>Produits</span><span><i class="dot b-out"></i>Charges</span></div>
    </div>
    <div class="card">
      <h3 class="card-title">Charges par compte (classeur)</h3>
      ${charges.length ? `<ul class="cats">${charges.map((a) => `<li class="clickable" data-acc="${a.code}"><span><code>${a.code}</code> ${esc(a.label)}</span><span>${money(a.balance)}</span><i style="width:${(a.balance / top) * 100}%"></i></li>`).join('')}</ul>` : '<p class="hint">Aucune charge.</p>'}
      <small class="hint">Touchez un compte pour voir ses écritures.</small>
    </div>
    ${p.nExp || p.nRes ? `<div class="card warn-card">
      <h3 class="card-title">Saisies de l’appli pas encore au classeur</h3>
      <ul class="kv">
        ${p.nRes ? `<li><span>${plural(p.nRes, 'séjour', 'séjours')} (net)</span><span>+${money(p.revenue)}</span></li>` : ''}
        ${p.nExp ? `<li><span>${plural(p.nExp, 'dépense', 'dépenses')}</span><span>−${money(p.expenses)}</span></li>` : ''}
      </ul>
      <small class="hint">Reportées automatiquement le dimanche, une fois validées.</small>
    </div>` : ''}
    <div class="card">
      <h3 class="card-title">Classeur maître</h3>
      <ul class="kv">
        <li><span>Version</span><span>${meta.currentVersion || '—'}${v ? ` · ${fmtDate(v.updatedAt.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}</span></li>
        <li><span>Dernière écriture</span><span>n° ${meta.lastEntryNo ?? '—'} · pièce ${esc(meta.lastPiece || '—')}</span></li>
        <li><span>Dernier relevé rapproché</span><span>${meta.lastBankStatement ? fmtDate(meta.lastBankStatement, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</span></li>
        <li><span>Contrôles (journal équilibré, banque rapprochée)</span><span class="${ok ? 'pos' : 'neg'}">${ok ? 'OK' : 'Écart à corriger'}</span></li>
      </ul>
      <button class="btn primary" data-act="xlsx">Télécharger le classeur Excel</button>
      <small class="hint">Chiffres repris du fichier Excel, mis à jour à chaque nouvelle version. Le fichier est aussi dans Plus › Documents.</small>
    </div>
  `;
}

function journalView(L) {
  const acc = state.account;
  const lines = (L.lines || []).filter((l) => !acc || l.account === acc);
  if (acc) {
    let run = 0;
    const label = lines[0]?.accountLabel || accountLabel(acc);
    return `
      <div class="card-head"><h2 class="section-title">Compte ${esc(acc)} · ${esc(label)}</h2><button class="link" data-acc="">Tout le journal</button></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Date</th><th>N°</th><th>Libellé</th><th>Débit</th><th>Crédit</th><th>Solde</th></tr></thead>
        <tbody>${lines.map((l) => { run += l.debit - l.credit; return `<tr><td>${fmtDate(l.date, { day: '2-digit', month: '2-digit', year: '2-digit' })}</td><td>${l.no}</td><td>${esc(l.label)}</td><td>${l.debit ? money(l.debit) : ''}</td><td>${l.credit ? money(l.credit) : ''}</td><td>${money(run)}</td></tr>`; }).join('')}</tbody>
      </table></div>`;
  }
  const groups = [];
  for (const l of lines) {
    const g = groups[groups.length - 1];
    if (g && g.no === l.no) g.lines.push(l); else groups.push({ no: l.no, date: l.date, journal: l.journal, piece: l.piece, ref: l.ref, lines: [l] });
  }
  return `<div class="list">${groups.slice().reverse().map((g) => `
    <div class="item static entry">
      <span class="item-main">
        <strong>${g.no} · ${esc(g.ref || g.lines[0].label)}</strong>
        <small>${fmtDate(g.date, { day: 'numeric', month: 'short', year: 'numeric' })} · journal ${esc(g.journal)} · pièce ${esc(g.piece)}</small>
        <table class="mini">${g.lines.map((l) => `<tr data-acc="${l.account}" class="clickable"><td><code>${l.account}</code></td><td>${esc(l.label)}</td><td>${l.debit ? money(l.debit) : ''}</td><td>${l.credit ? money(l.credit) : ''}</td></tr>`).join('')}</table>
      </span>
    </div>`).join('')}</div>
    <p class="hint">Lecture seule : le journal du classeur maître. Touchez un compte pour voir son grand livre.</p>`;
}

function synthese(year, months, totals, expenses) {
  
  const byAcc = {};
  expenses.filter((e) => !String(e.account).startsWith('2')).forEach((e) => { byAcc[e.account] = (byAcc[e.account] || 0) + (Number(e.amount) || 0); });
  const accs = Object.entries(byAcc).sort((a, b) => b[1] - a[1]);
  const immo = expenses.filter((e) => String(e.account).startsWith('2'));
  const regine = db().expenses.filter((e) => e.paidBy === 'regine' && !e.reimbursed);
  return `
    <div class="kpis">
      <div class="kpi"><small>Recettes (prix hôte)</small><strong>${money0(totals.host)}</strong></div>
      <div class="kpi"><small>Commissions</small><strong>${money0(totals.commission)}</strong></div>
      <div class="kpi"><small>Charges</small><strong>${money0(totals.expenses)}</strong></div>
      <div class="kpi"><small>Occupation</small><strong>${pct(totals.occupancy)}</strong><em>${plural(totals.nights, 'nuit', 'nuits')}</em></div>
    </div>
    <div class="card">
      <h3 class="card-title">Par mois</h3>
      <div class="chart">${bars(months.map((x) => ({ inn: x.net, out: x.expenses })))}</div>
      <div class="legend"><span><i class="dot b-in"></i>Recettes nettes</span><span><i class="dot b-out"></i>Charges</span></div>
    </div>
    <div class="card">
      <h3 class="card-title">Charges par compte</h3>
      ${accs.length ? `<ul class="cats">${accs.map(([c, v]) => `<li><span><code>${c}</code> ${esc(accountLabel(c))}</span><span>${money(v)}</span><i style="width:${(v / accs[0][1]) * 100}%"></i></li>`).join('')}</ul>` : '<p class="hint">Aucune charge saisie pour cet exercice.</p>'}
      ${immo.length ? `<p class="hint">Acquisitions immobilisées (hors résultat, à amortir dans le classeur) : ${money(immo.reduce((s, e) => s + (Number(e.amount) || 0), 0))}</p>` : ''}
    </div>
    ${regine.length ? `<div class="card warn-card"><h3 class="card-title">Avances de Régine à rembourser (467600)</h3><p class="big">${money(regine.reduce((s, e) => s + (Number(e.amount) || 0), 0))}</p><small class="hint">${plural(regine.length, 'dépense', 'dépenses')} non remboursée${regine.length > 1 ? 's' : ''}.</small></div>` : ''}
    <button class="btn block" data-act="csv">Exporter les écritures ${year} (CSV pour le classeur)</button>
    <p class="hint">Résultat calculé avant amortissements et intérêts d’emprunt non saisis : la liasse se fait depuis le classeur Excel. Recettes réparties au prorata des nuits ; séjours à cheval sur deux exercices traités en PCA (487000) dans l’export.</p>
  `;
}

function valider(pending) {
  if (!pending.length) {
    return empty('Rien à valider. Les factures et mails détectés chaque jour dans votre boîte apparaîtront ici avec une écriture pré-remplie.');
  }
  return `<div class="list">${pending.map((x) => `
    <div class="item static">
      <span class="item-main">
        <strong>${esc(x.proposal.label || x.subject)}</strong>
        <small>${fmtDate(x.proposal.date || x.date, { day: 'numeric', month: 'short', year: 'numeric' })} · ${esc(x.from || '')} · <code>${esc(x.proposal.account || '?')}</code> ${esc(accountLabel(x.proposal.account || ''))}</small>
        ${x.proposal.why ? `<small class="warn-text">${esc(x.proposal.why)}</small>` : ''}
        ${x.gmailUrl ? `<a class="small-link" href="${esc(x.gmailUrl)}" target="_blank" rel="noopener">Voir le mail</a>` : ''}
      </span>
      <span class="item-side">
        <span>${money(x.proposal.amount)}</span>
        <span class="btn-row"><button class="btn small" data-ignore="${x.id}">Ignorer</button><button class="btn small primary" data-inbox="${x.id}">Valider</button></span>
      </span>
    </div>`).join('')}</div>`;
}

function validateInbox(id) {
  const item = db().inbox.find((x) => x.id === id);
  if (!item) return;
  const p = item.proposal;
  expenseForm(null, {
    label: p.label || item.subject, amount: p.amount, date: p.date || item.date, account: p.account || '614000',
    supplier: p.supplier || item.from, piece: p.piece, notes: p.notes, why: p.why, source: 'mail', sourceLink: item.gmailUrl,
  }, (exp) => upsert('inbox', { ...item, status: 'valide', expenseId: exp.id }));
}

function depenses(year, expenses) {
  return `
    <button class="btn block primary" data-act="new-exp">+ Ajouter une dépense</button>
    ${expenses.length ? `<div class="list">${expenses.map((e) => `
      <button class="item" data-exp="${e.id}">
        <span class="item-main"><strong>${esc(e.label)}</strong><small>${fmtDate(e.date, { day: 'numeric', month: 'short', year: 'numeric' })} · <code>${esc(e.account)}</code> ${esc(accountLabel(e.account))}${e.paidBy === 'regine' ? ` · avance Régine${e.reimbursed ? ' (remboursée)' : ''}` : ''}${e.ledgerEntry ? ` · classeur n° ${e.ledgerEntry}` : ''}</small></span>
        <span class="item-side"><span>${money(e.amount)}</span></span>
      </button>`).join('')}</div>` : empty(`Aucune dépense en ${year}.`)}
  `;
}

// ---------- Scanner une facture ----------

const ACCOUNTS_TXT = EXPENSE_ACCOUNTS.map(([c, l]) => `${c} ${l}`).join('; ');

let samplePromise = null;
const getSample = () => (samplePromise ||= Promise.resolve(window.claude?.use?.('sample')).catch(() => null));

const INVOICE_PROMPT = `Voici la photo d'une facture ou d'un ticket pour un meublé de tourisme (LMNP, TVA non récupérable : on comptabilise le TTC).
Comptes possibles : ${ACCOUNTS_TXT}.
Réponds uniquement par un objet JSON :
{"label": "libellé court (fournisseur + objet + période)", "amount": montant TTC en nombre, "date": "AAAA-MM-JJ (date de la facture)", "account": "numéro de compte", "supplier": "fournisseur", "piece": "numéro de facture ou chaîne vide", "why": "ce qui est illisible ou douteux, ou chaîne vide", "readable": true}
Si ce n'est pas une facture lisible, mets "readable": false et explique dans "why".`;

const validAccount = (a) => (EXPENSE_ACCOUNTS.some(([c]) => c === String(a)) ? String(a) : '615000');
const isoOr = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : today());

/** Photo ou PDF de facture : archivage, lecture par Claude si c'est une image, puis formulaire pré-rempli. */
export async function scanInvoice(file) {
  toast('Archivage de la pièce…');
  const att = await archiveFile(file, { folder: 'Compta/Factures', origin: 'Compta › Scanner' });
  if (!att) return;
  const base = { attachments: [att], source: 'scan' };
  const sample = await getSample();
  const lim = sample ? await sample.limits().catch(() => null) : null;
  if (!file.type.startsWith('image/') || !lim?.images) {
    expenseForm(null, { ...base, label: file.name.replace(/\.[a-z0-9]+$/i, ''), why: 'Pièce archivée. Saisissez le montant : Claude contrôlera la pièce lors du report au classeur.' });
    return;
  }
  toast('Lecture de la facture par Claude…');
  try {
    const p = await sample.json(INVOICE_PROMPT, { images: [file], cache: false });
    if (!p || p.readable === false) {
      expenseForm(null, { ...base, why: `Facture illisible pour Claude. ${p?.why || ''} Complétez à la main.` });
      return;
    }
    expenseForm(null, {
      ...base, label: String(p.label || ''), amount: num(p.amount), date: isoOr(p.date), account: validAccount(p.account),
      supplier: String(p.supplier || ''), piece: String(p.piece || ''), why: p.why ? String(p.why) : 'Lue par Claude : vérifiez avant d’enregistrer.',
    });
  } catch (e) {
    expenseForm(null, { ...base, why: `Lecture impossible (${ERRORS[e?.code] || 'réessayez plus tard'}). Complétez à la main, la pièce est archivée.` });
  }
}

function scanTile() {
  return `<div class="scan-tile">
    <label class="scan-main">
      <svg viewBox="0 0 24 24"><path d="M4 7h3l2-3h6l2 3h3v13H4z"/><circle cx="12" cy="13" r="4"/></svg>
      <span><strong>Scanner une facture</strong><small>Photo : Claude la lit et prépare l’écriture</small></span>
      <input type="file" accept="image/*" capture="environment" data-scan hidden>
    </label>
    <label class="scan-alt">Importer une photo ou un PDF<input type="file" accept="image/*,application/pdf" data-scan hidden></label>
  </div>`;
}

// ---------- Justificatifs ----------

const pieceName = (e) => {
  const d = e.date || '';
  const ext = (e.attachments?.[0]?.type || '').includes('pdf') ? 'pdf' : 'jpg';
  return `${e.piece || '—'} - ${d.slice(5, 7)}.${d.slice(2, 4)} ${String(e.label || '').toUpperCase()}.${ext}`;
};

function justificatifs(year) {
  const y = String(year);
  const withDocs = db().expenses.filter((e) => e.attachments?.length && e.date?.startsWith(y))
    .sort((a, b) => (Number(a.ledgerEntry) || 1e9) - (Number(b.ledgerEntry) || 1e9) || a.date.localeCompare(b.date));
  const missing = db().expenses.filter((e) => !e.attachments?.length && e.date?.startsWith(y));
  const chatDocs = (db().chat || []).filter((m) => m.role === 'user' && m.attachments?.length && (m.at || '').startsWith(y));
  return `
    ${withDocs.length ? `<div class="list">${withDocs.map((e) => `
      <div class="item static">
        <span class="item-main"><strong>${esc(pieceName(e))}</strong>
          <small>${e.ledgerEntry ? `Écriture n° ${e.ledgerEntry}` : 'Pas encore au classeur (numéro attribué au report)'} · ${money(e.amount)}</small>
          <span class="attach-list">${attachmentLinks(e.attachments)}</span></span>
        <button class="btn small" data-exp="${e.id}">Voir</button>
      </div>`).join('')}</div>` : empty(`Aucun justificatif archivé pour ${year}.`)}
    ${missing.length ? `<div class="card warn-card"><h3 class="card-title">Dépenses sans justificatif (${missing.length})</h3>
      <div class="list">${missing.map((e) => `<button class="item" data-exp="${e.id}"><span class="item-main"><strong>${esc(e.label)}</strong><small>${fmtDate(e.date, { day: 'numeric', month: 'short' })} · ${money(e.amount)}</small></span></button>`).join('')}</div></div>` : ''}
    ${chatDocs.length ? `<div class="card"><h3 class="card-title">Pièces envoyées dans le chat</h3>${chatDocs.map((m) => `<div class="attach-list"><small class="muted">${fmtDate(m.at.slice(0, 10), { day: 'numeric', month: 'short' })}</small> ${attachmentLinks(m.attachments)}</div>`).join('')}</div>` : ''}
    <p class="hint">Les pièces sont numérotées comme dans l’onglet Factures du classeur (NNN - MM.AA OBJET) une fois l’écriture passée.</p>
  `;
}

// ---------- Discussion avec Claude ----------

function context() {
  const L = db().ledgerSummary || {};
  const y = new Date().getFullYear();
  const recent = [...db().expenses].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 20)
    .map((e) => `${e.date} | ${e.label} | ${e.amount} € | ${e.account}${e.ledgerEntry ? ` | écr. ${e.ledgerEntry}` : ' | pas encore au classeur'}`).join('\n');
  const lines = (L.lines || []).slice(-40).map((l) => `${l.no} ${l.journal} ${l.date} ${l.account} ${l.label} D${l.debit} C${l.credit}`).join('\n');
  return `Classeur maître (exercice ${y}) : produits ${L.produits ?? '?'} €, charges ${L.charges ?? '?'} €, résultat avant amortissements ${L.result ?? '?'} €, amortissements prévus ${L.depreciation?.[String(y)] ?? '?'} €, trésorerie ${L.bank ?? '?'} €, capital restant dû ${L.loanOutstanding ?? '?'} €, compte exploitant ${L.ownerAccount ?? '?'} €, dû à Régine ${L.owedToRegine ?? '?'} €.
Dernières lignes du journal :
${lines || '(aucune)'}
Dernières dépenses saisies dans l'appli :
${recent || '(aucune)'}`;
}

const RULES = `Tu es l'assistant comptable de l'appli de gestion du meublé de tourisme Horizon Blanc 403 (LMNP au réel simplifié, BIC, TVA non applicable, comptabilité d'engagement : la date de pièce rattache à l'exercice). Le classeur Excel maître fait foi ; l'appli y reporte automatiquement les écritures validées. Réponds en français, court et factuel, sans formules de politesse. Contredis l'utilisateur s'il se trompe. Si tu n'es pas sûr d'une règle fiscale, dis-le.
Comptes de charges et d'immobilisations : ${ACCOUNTS_TXT}. Un bien durable de plus de 500 € HT va en immobilisation (213400 ou 21841x). Une dépense avancée par Régine (sa mère) : paidBy "regine" (467600). Payée par lui sur ses fonds personnels : paidBy "exploitant" (108000). Payée par le compte dédié : paidBy "banque".
Quand une dépense doit être enregistrée (décrite, ou visible sur une photo de facture), termine ta réponse par :
\`\`\`depense
{"label": "...", "amount": 0.00, "date": "AAAA-MM-JJ", "account": "606100", "supplier": "...", "piece": "", "paidBy": "banque", "why": "point à vérifier, ou chaîne vide"}
\`\`\`
Quand l'utilisateur envoie une capture de relevé bancaire, termine par la liste des opérations lisibles :
\`\`\`banque
[{"date": "AAAA-MM-JJ", "label": "...", "amount": -12.34}]
\`\`\`
(montant négatif pour un débit). N'invente aucun chiffre illisible.`;

function parseBlocks(text) {
  const out = { text, proposal: null, bankLines: null, task: null };
  const grab = (tag) => {
    const m = out.text.match(new RegExp('```' + tag + '\\s*([\\s\\S]*?)```'));
    if (!m) return null;
    out.text = out.text.replace(m[0], '').trim();
    try { return JSON.parse(m[1]); } catch { return null; }
  };
  out.proposal = grab('depense');
  const t = grab('tache');
  out.task = t && t.title ? t : null;
  const bank = grab('banque');
  out.bankLines = Array.isArray(bank) ? bank.filter((l) => /^\d{4}-\d{2}-\d{2}$/.test(l?.date || '') && Number(l?.amount)) : null;
  return out;
}

const chat = { busy: false, ctl: null, draft: '', files: [], live: '', thread: 'compta' };

const ERRORS = {
  not_granted: 'Accès à Claude refusé pour cette appli. Autorisez-le dans le menu Permissions de l’artifact.',
  rate_limited: 'Trop de demandes ou limite d’usage atteinte. Réessayez plus tard.',
  refused: 'Claude a refusé cette demande. Reformulez-la.',
  image_rejected: 'Image refusée (format ou taille). Essayez une autre photo.',
  images_unavailable: 'L’envoi d’images n’est pas disponible dans cette vue.',
  session_expired: 'Session expirée : reconnectez-vous à claude.ai.',
  invalid_json: 'Réponse illisible. Réessayez avec une photo plus nette.',
};

function messageHtml(m) {
  if (m.role === 'user') {
    return `<div class="bubble me">${esc(m.text || '')}${m.attachments?.length ? `<div class="attach-list">${attachmentLinks(m.attachments)}</div>` : ''}</div>`;
  }
  const p = m.proposal;
  const bank = m.bankLines;
  return `<div class="bubble">${esc(m.text || '')}
    ${p ? `<div class="proposal ${m.proposalDone ? 'done' : ''}">
      <div><strong>${esc(p.label)}</strong><small>${fmtDate(p.date, { day: 'numeric', month: 'short', year: 'numeric' })} · <code>${esc(p.account)}</code> ${esc(accountLabel(p.account))}</small>${p.why ? `<small class="warn-text">${esc(p.why)}</small>` : ''}</div>
      <div class="item-side"><span>${money(p.amount)}</span>${m.proposalDone ? '<span class="badge">Enregistrée</span>' : `<button class="btn small primary" data-prop="${m.id}">Vérifier et enregistrer</button>`}</div>
    </div>` : ''}
    ${m.task ? `<div class="proposal ${m.taskDone ? 'done' : ''}"><div><strong>${esc(m.task.title)}</strong><small>${m.task.date ? `Échéance ${fmtDate(m.task.date, { day: 'numeric', month: 'long', year: 'numeric' })}` : 'Sans échéance'}</small></div>
      <div class="item-side">${m.taskDone ? '<span class="badge">Dans la To do</span>' : `<button class="btn small primary" data-task="${m.id}">Ajouter à la To do</button>`}</div></div>` : ''}
    ${bank?.length ? `<div class="proposal ${m.bankDone ? 'done' : ''}"><div><strong>${bank.length} opération${bank.length > 1 ? 's' : ''} lue${bank.length > 1 ? 's' : ''} sur le relevé</strong><small>${bank.slice(0, 4).map((l) => `${fmtDate(l.date, { day: '2-digit', month: '2-digit' })} ${esc(l.label)} ${money(l.amount)}`).join(' · ')}${bank.length > 4 ? '…' : ''}</small></div>
      <div class="item-side">${m.bankDone ? '<span class="badge">Ajoutées</span>' : `<button class="btn small primary" data-bank="${m.id}">Ajouter au relevé</button>`}</div></div>` : ''}
  </div>`;
}

const threadMsgs = (thread) => (db().chat || []).filter((m) => (m.thread || 'compta') === thread);

export function renderChat(body, thread = 'compta') {
  if (chat.thread !== thread) { chat.thread = thread; chat.draft = ''; chat.files = []; }
  const msgs = threadMsgs(thread).slice(-80);
  body.innerHTML = `
    <div class="chat" id="chat-log">
      ${msgs.length ? '' : `<div class="chat-hello">
        ${thread === 'compta' ? `<p><strong>Votre espace compta avec Claude.</strong></p>
        <p class="hint">Posez une question, envoyez une facture, une capture de relevé bancaire ou tout justificatif. Exemples : « Où passe l’assurance emprunteur ? », « J’ai payé 89 € de linge chez Ikea le 3 novembre, avancé par Régine ». La conversation et les pièces sont conservées.</p>` : `<p><strong>Juridique, administratif, conciergerie : parlez-en à Claude.</strong></p>
        <p class="hint">Envoyez la photo d’un courrier, d’une mise en demeure, d’un contrat ou d’un avenant, et posez vos questions. Claude explique la démarche et peut l’ajouter à votre To do. Tout est conservé dans le coffre.</p>`}
      </div>`}
      ${msgs.map(messageHtml).join('')}
      ${chat.busy ? `<div class="bubble ${chat.live ? '' : 'thinking'}" id="chat-live">${esc(chat.live || 'Réflexion…')}</div>` : ''}
    </div>
    ${chat.files.length ? `<div class="chips">${chat.files.map((f, i) => `<span class="chip">${f.type.startsWith('image/') ? '🖼' : '📄'} ${esc(f.name)} <button class="link" data-unfile="${i}" aria-label="Retirer">✕</button></span>`).join('')}</div>` : ''}
    <form class="chat-form" id="chat-form">
      <label class="btn icon-only" title="Joindre une photo, une capture ou un PDF">
        <svg viewBox="0 0 24 24"><path d="M21 12.5 12.5 21a5 5 0 0 1-7-7L14 5.5a3.5 3.5 0 0 1 5 5L10.5 19a2 2 0 0 1-3-3L15 8.5"/></svg>
        <input type="file" accept="image/*,application/pdf" multiple id="chat-files" hidden>
      </label>
      <textarea id="chat-input" rows="1" placeholder="Écrire à Claude… (dictée possible avec le micro du clavier)" ${chat.busy ? 'disabled' : ''}>${esc(chat.draft)}</textarea>
      ${chat.busy ? '<button type="button" class="btn" id="chat-stop">Stop</button>' : '<button class="btn primary" type="submit">Envoyer</button>'}
    </form>
    <p class="hint" id="chat-note">Claude utilise votre compte claude.ai. Il lit les photos et captures ; les PDF sont archivés mais pas lus ici (Claude les lit lors du report au classeur).</p>
  `;
  const log = body.querySelector('#chat-log');
  log.scrollTop = log.scrollHeight;
  const form = body.querySelector('#chat-form');
  const input = body.querySelector('#chat-input');
  input.addEventListener('input', () => { chat.draft = input.value; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  body.querySelector('#chat-stop')?.addEventListener('click', () => chat.ctl?.abort());
  body.querySelector('#chat-files').addEventListener('change', (e) => { chat.files.push(...e.target.files); renderChat(body, thread); });
  form.addEventListener('submit', (e) => { e.preventDefault(); if (input.value.trim() || chat.files.length) send(body, input.value.trim(), thread); });
  body.onclick = (e) => {
    const el = e.target.closest('[data-unfile],[data-prop],[data-bank],[data-task]');
    if (!el) return;
    e.stopPropagation();
    if (el.dataset.unfile) { chat.files.splice(Number(el.dataset.unfile), 1); renderChat(body, thread); }
    else if (el.dataset.task) acceptTask(el.dataset.task);
    else if (el.dataset.prop) acceptProposal(el.dataset.prop);
    else if (el.dataset.bank) acceptBank(el.dataset.bank);
  };
  getSample().then((s) => {
    if (!s) { body.querySelector('#chat-note').textContent = 'Claude n’est pas disponible dans cette vue (ouvrez l’appli dans claude.ai).'; form.hidden = true; }
  });
}

function acceptProposal(id) {
  const m = (db().chat || []).find((x) => x.id === id);
  if (!m?.proposal) return;
  const p = m.proposal;
  const src = (db().chat || []).filter((x) => x.role === 'user' && x.at <= m.at).pop();
  expenseForm(null, {
    label: String(p.label || ''), amount: num(p.amount), date: isoOr(p.date), account: validAccount(p.account),
    supplier: String(p.supplier || ''), piece: String(p.piece || ''), paidBy: ['banque', 'regine', 'exploitant'].includes(p.paidBy) ? p.paidBy : 'banque',
    why: p.why ? String(p.why) : '', source: 'claude', attachments: src?.attachments || [],
  }, () => saveChatMessage({ ...m, proposalDone: true }));
}

function acceptTask(id) {
  const m = (db().chat || []).find((x) => x.id === id);
  if (!m?.task) return;
  const now = new Date().toISOString();
  upsert('tasks', {
    title: String(m.task.title), kind: ['decision', 'action', 'admin', 'entretien'].includes(m.task.kind) ? m.task.kind : 'admin',
    priority: ['haute', 'normale', 'basse'].includes(m.task.priority) ? m.task.priority : 'normale',
    date: /^\d{4}-\d{2}-\d{2}$/.test(m.task.date || '') ? m.task.date : '', status: 'todo', notes: String(m.task.notes || ''),
    source: 'claude', createdAt: now, history: [{ at: now, by: 'claude', text: 'Tâche proposée dans le chat Juridique' }], decision: '', contactId: null, cost: 0,
  });
  saveChatMessage({ ...m, taskDone: true });
  toast('Ajoutée à la To do');
}

const RULES_JURIDIQUE = `Tu es l'assistant juridique et administratif de Sébastien pour son meublé de tourisme Horizon Blanc 403 (La Joue du Loup, Le Dévoluy ; LMNP au réel simplifié ; meublé de tourisme non classé déclaré en mairie ; conciergerie Concierge Services En Dévoluy ; syndic LOGEVAC ; assurance Pacifica). Réponds en français, court et factuel, sans formules de politesse. Explique la démarche concrète, étape par étape, avec les délais et les coordonnées utiles tirées du contexte. Dis clairement quand un point mérite l'avis d'un professionnel (notaire, avocat, CGP) et quand tu n'es pas sûr. Contredis-le s'il se trompe. N'invente pas de texte de loi ni de délai : si tu n'es pas certain, dis-le.
Pour un courrier ou un contrat en photo : résume-le, dis ce qu'il implique, ce qu'il faut faire et avant quand.
Quand une démarche doit être ajoutée à sa To do, termine ta réponse par :
\`\`\`tache
{"title": "verbe + objet", "kind": "admin", "priority": "normale", "date": "AAAA-MM-JJ ou chaîne vide", "notes": "démarche en 3 à 6 lignes"}
\`\`\`
(kind : "decision" si un choix est à faire ; priority "haute" si une échéance tombe sous 15 jours).`;

function contextJuridique() {
  const sections = (db().property?.sections || []).map((s) => `## ${s.title}\n${s.body}`).join('\n\n').slice(0, 12000);
  const docs = db().documents.map((d) => `${d.name} | ${d.status} | ${d.ref || ''} | ${d.date || ''} | ${d.expiry || ''}`).join('\n');
  const dl = db().deadlines.filter((d) => !d.done).map((d) => `${d.date} ${d.title}`).join('\n');
  return `Date du jour : ${today()}.\nFiche du bien :\n${sections}\n\nDocuments suivis :\n${docs}\n\nÉchéances :\n${dl}`;
}

function acceptBank(id) {
  const m = (db().chat || []).find((x) => x.id === id);
  if (!m?.bankLines?.length) return;
  const known = new Set(db().bank.map((b) => b.hash));
  let n = 0;
  for (const l of m.bankLines) {
    const line = { date: l.date, label: String(l.label || '').trim(), amount: Math.round(Number(l.amount) * 100) / 100 };
    line.hash = `${line.date}|${line.amount.toFixed(2)}|${line.label.slice(0, 40)}`.replace(/[^\w|.-]/g, '');
    if (known.has(line.hash)) continue;
    known.add(line.hash);
    upsert('bank', { ...line, id: `b${line.hash.replace(/[^A-Za-z0-9]/g, '').slice(0, 60)}`, match: null, source: 'capture' });
    n++;
  }
  saveChatMessage({ ...m, bankDone: true });
  toast(n ? `${n} ligne${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''} dans Banque (à rapprocher)` : 'Ces lignes étaient déjà dans Banque.');
}

async function send(body, text, thread = 'compta') {
  const sample = await getSample();
  if (!sample) return;
  const files = chat.files.splice(0);
  chat.busy = true;
  chat.draft = '';
  chat.live = '';
  chat.ctl = new AbortController();
  renderChat(body, thread);
  const attachments = [];
  for (const f of files) {
    const a = await archiveFile(f, { folder: 'À classer', origin: `Chat ${chat.thread}` });
    if (a) attachments.push(a);
  }
  const images = files.filter((f) => f.type.startsWith('image/'));
  const pdfs = files.filter((f) => !f.type.startsWith('image/')).map((f) => f.name);
  const userText = text || (images.length ? 'Pièce jointe.' : 'Document joint.');
  saveChatMessage({ role: 'user', text: userText, at: new Date().toISOString(), attachments, thread });
  const history = threadMsgs(thread).slice(-16).map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: (m.text || '…') + (m.attachments?.length ? ` [${m.attachments.length} pièce(s) jointe(s)]` : ''),
  }));
  if (pdfs.length) history[history.length - 1].content += ` (PDF joint, non lisible ici : ${pdfs.join(', ')})`;
  const input = [{ role: 'user', content: thread === 'compta' ? `${RULES}\n\nContexte :\n${context()}` : `${RULES_JURIDIQUE}\n\nContexte :\n${contextJuridique()}` }, ...history];
  if (input[1]?.role === 'assistant') input.splice(1, 0, { role: 'user', content: '(suite de la conversation)' });
  const lim = images.length ? await sample.limits().catch(() => null) : null;
  try {
    const opts = { cache: false, signal: chat.ctl.signal, onText: ({ text: t }) => { chat.live = t; const live = body.querySelector('#chat-live'); if (live) { live.textContent = t; live.classList.remove('thinking'); } } };
    if (images.length && lim?.images) opts.images = images.slice(0, lim.images.maxCount);
    const { text: answer } = await sample(input, opts);
    const { text: shown, proposal, bankLines, task } = parseBlocks(answer);
    saveChatMessage({ role: 'assistant', text: shown, at: new Date().toISOString(), proposal, bankLines, task, thread });
  } catch (e) {
    if (e.code !== 'cancelled') saveChatMessage({ role: 'assistant', text: `${e.text ? `${e.text}\n\n` : ''}⚠︎ ${ERRORS[e.code] || 'Réponse interrompue. Réessayez.'}`, at: new Date().toISOString(), thread });
  } finally {
    chat.busy = false;
    chat.live = '';
    renderChat(body, thread);
  }
}
