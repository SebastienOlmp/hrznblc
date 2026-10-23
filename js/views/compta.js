// Onglet COMPTA : résultat net, dépenses, éléments détectés dans les mails à valider, assistant Claude.
import { esc, money, money0, pct, fmtDate, MONTHS_SHORT, plural, today, num } from '../utils.js';
import { db, upsert, yearStats, yearsWithData, EXPENSE_ACCOUNTS, accountLabel, isActive, resNet } from '../store.js';
import { expenseForm } from './forms.js';
import { empty, saveFile, toast } from '../ui.js';
import { journalCSV } from '../compta.js';
import { ledgerStatus, fire } from '../ledger.js';

const state = { year: new Date().getFullYear(), tab: 'synthese', account: null, month: null };
const chat = { turns: [], busy: false, ctl: null, proposals: {}, draft: '' };

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

  const tabs = [['synthese', 'Synthèse'], ...(L ? [['journal', 'Journal']] : []), ['valider', `À valider${pending.length ? ` (${pending.length})` : ''}`], ['depenses', 'Dépenses'], ['claude', 'Claude']];
  root.innerHTML = `
    <header class="top">
      <div><p class="eyebrow">Compta</p><h1>Exercice ${year}</h1></div>
      <select class="year-select" id="compta-year" aria-label="Exercice">${years.map((y) => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select>
    </header>
    ${band}
    ${statusLine()}
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
  else renderChat(body);

  root.querySelector('#compta-year').onchange = (e) => { state.year = Number(e.target.value); renderCompta(root); };
  root.onclick = async (e) => {
    const el = e.target.closest('[data-tab],[data-month],[data-exp],[data-act],[data-inbox],[data-ignore],[data-prop],[data-acc]');
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
    } else if (el.dataset.prop) {
      const pr = chat.proposals[el.dataset.prop];
      if (pr) expenseForm(null, { ...pr, source: 'claude' }, () => { pr.done = true; renderCompta(root); });
    } else if (el.dataset.act === 'new-exp') expenseForm(null);
    else if (el.dataset.act === 'ledger-now') fire();
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
      <small class="hint">Chiffres repris du fichier Excel, mis à jour à chaque nouvelle version. Pour recevoir le fichier : « envoie-moi le classeur comptable maître à jour » dans une conversation Claude Code.</small>
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

// ---------- Assistant Claude ----------

const ACCOUNTS_TXT = EXPENSE_ACCOUNTS.map(([c, l]) => `${c} ${l}`).join('; ');

function context() {
  const y = new Date().getFullYear();
  const { totals } = yearStats(y);
  const recent = [...db().expenses].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 25)
    .map((e) => `${e.date} | ${e.label} | ${e.amount} € | ${e.account}${e.paidBy === 'regine' ? ' | avance Régine' : ''}`).join('\n');
  return `Exercice ${y} : recettes nettes ${totals.net.toFixed(2)} €, charges ${totals.expenses.toFixed(2)} €, résultat avant amortissements ${totals.result.toFixed(2)} €, ${totals.nights} nuits louées.\nDernières dépenses :\n${recent || '(aucune)'}`;
}

const RULES = `Tu es l'assistant comptable de l'appli de gestion d'un meublé de tourisme (LMNP au réel simplifié, BIC, TVA non applicable, comptabilité d'engagement : la date de pièce rattache à l'exercice). Le propriétaire tient sa comptabilité lui-même. Réponds en français, de façon courte et factuelle, sans formules de politesse. Contredis-le s'il se trompe. Si tu n'es pas sûr d'une règle fiscale, dis-le.
Comptes de charges et d'immobilisations disponibles : ${ACCOUNTS_TXT}. Un achat de bien durable de plus de 500 € HT va en immobilisation (2134 ou 2184), pas en charge. Une dépense avancée par Régine (la mère du propriétaire) se crédite en 467600.
Quand l'utilisateur décrit une dépense à enregistrer, termine ta réponse par un bloc :
\`\`\`depense
{"label": "...", "amount": 0.00, "date": "AAAA-MM-JJ", "account": "606100", "supplier": "...", "piece": "", "why": "point à vérifier, ou chaîne vide"}
\`\`\`
Ne mets ce bloc que si une dépense doit être enregistrée.`;

const INVOICE_PROMPT = `Voici la photo d'une facture ou d'un ticket pour un meublé de tourisme (LMNP, TVA non récupérable : on comptabilise le TTC).
Comptes possibles : ${ACCOUNTS_TXT}.
Réponds uniquement par un objet JSON :
{"label": "libellé court (fournisseur + objet + période)", "amount": montant TTC en nombre, "date": "AAAA-MM-JJ (date de la facture)", "account": "numéro de compte", "supplier": "fournisseur", "piece": "numéro de facture ou chaîne vide", "why": "ce qui est illisible ou douteux, ou chaîne vide", "readable": true}
Si ce n'est pas une facture lisible, mets "readable": false et explique dans "why".`;

function parseProposal(text) {
  const m = text.match(/```depense\s*([\s\S]*?)```/);
  if (!m) return { text, proposal: null };
  try {
    return { text: text.replace(m[0], '').trim(), proposal: JSON.parse(m[1]) };
  } catch {
    return { text, proposal: null };
  }
}

function proposalCard(id, p) {
  return `<div class="proposal ${p.done ? 'done' : ''}">
    <div><strong>${esc(p.label)}</strong><small>${fmtDate(p.date, { day: 'numeric', month: 'short', year: 'numeric' })} · <code>${esc(p.account)}</code> ${esc(accountLabel(p.account))}</small>
    ${p.why ? `<small class="warn-text">${esc(p.why)}</small>` : ''}</div>
    <div class="item-side"><span>${money(p.amount)}</span>${p.done ? '<span class="badge">Enregistrée</span>' : `<button class="btn small primary" data-prop="${id}">Vérifier et enregistrer</button>`}</div>
  </div>`;
}

function renderChat(body) {
  body.innerHTML = `
    <div class="chat" id="chat-log">
      ${chat.turns.length ? '' : `<div class="chat-hello">
        <p><strong>Posez une question ou envoyez une facture.</strong></p>
        <p class="hint">Exemples : « Où passe l’assurance emprunteur ? », « J’ai payé 89 € de linge chez Ikea le 3 novembre, avancé par Régine ». Une photo de facture donne une écriture pré-remplie à vérifier.</p>
      </div>`}
      ${chat.turns.map((t, i) => t.role === 'user'
        ? `<div class="bubble me">${esc(t.display || t.content)}</div>`
        : `<div class="bubble">${esc(t.display ?? t.content)}${t.proposalId ? proposalCard(t.proposalId, chat.proposals[t.proposalId]) : ''}</div>`).join('')}
      ${chat.busy ? '<div class="bubble thinking" id="chat-live">Réflexion…</div>' : ''}
    </div>
    <form class="chat-form" id="chat-form">
      <label class="btn icon-only" title="Envoyer une photo de facture" id="photo-label">
        <svg viewBox="0 0 24 24"><path d="M4 7h3l2-3h6l2 3h3v13H4z"/><circle cx="12" cy="13" r="4"/></svg>
        <input type="file" accept="image/jpeg,image/png,image/webp" id="chat-photo" hidden>
      </label>
      <textarea id="chat-input" rows="1" placeholder="Écrire à Claude…" ${chat.busy ? 'disabled' : ''}>${esc(chat.draft || '')}</textarea>
      ${chat.busy ? '<button type="button" class="btn" id="chat-stop">Stop</button>' : '<button class="btn primary" type="submit">Envoyer</button>'}
    </form>
    <p class="hint" id="chat-note">Claude utilise votre compte claude.ai ; la première utilisation demande votre accord.</p>
  `;
  const log = body.querySelector('#chat-log');
  log.scrollTop = log.scrollHeight;
  const form = body.querySelector('#chat-form');
  const input = body.querySelector('#chat-input');
  input.addEventListener('input', () => { chat.draft = input.value; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  body.querySelector('#chat-stop')?.addEventListener('click', () => chat.ctl?.abort());
  form.addEventListener('submit', (e) => { e.preventDefault(); const v = input.value.trim(); if (v) send(body, v); });
  body.querySelector('#chat-photo').addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) sendPhoto(body, f); });
  getSample().then(async (s) => {
    if (!s) { body.querySelector('#chat-note').textContent = 'Claude n’est pas disponible dans cette vue (ouvrez l’appli dans claude.ai).'; form.hidden = true; return; }
    const lim = await s.limits().catch(() => null);
    body.querySelector('#photo-label').hidden = !lim?.images;
  });
}

let samplePromise = null;
const getSample = () => (samplePromise ||= Promise.resolve(window.claude?.use?.('sample')).catch(() => null));

const ERRORS = {
  not_granted: 'Accès à Claude refusé pour cette appli. Autorisez-le dans le menu Permissions de l’artifact.',
  rate_limited: 'Trop de demandes ou limite d’usage atteinte. Réessayez plus tard.',
  refused: 'Claude a refusé cette demande. Reformulez-la.',
  image_rejected: 'Image refusée (format ou taille). Essayez une autre photo.',
  images_unavailable: 'L’envoi d’images n’est pas disponible dans cette vue.',
  session_expired: 'Session expirée : reconnectez-vous à claude.ai.',
  invalid_json: 'Réponse illisible. Réessayez avec une photo plus nette.',
};

async function send(body, text) {
  const sample = await getSample();
  if (!sample) return;
  chat.turns.push({ role: 'user', content: text });
  chat.draft = '';
  chat.busy = true;
  chat.ctl = new AbortController();
  renderChat(body);
  const input = [{ role: 'user', content: `${RULES}\n\nContexte :\n${context()}` },
    ...chat.turns.slice(-16).map((t) => ({ role: t.role, content: t.content }))];
  try {
    const { text: answer } = await sample(input, {
      cache: false, signal: chat.ctl.signal,
      onText: ({ text: t }) => { const live = body.querySelector('#chat-live'); if (live) { live.textContent = t; live.classList.remove('thinking'); } },
    });
    const { text: shown, proposal } = parseProposal(answer);
    const turn = { role: 'assistant', content: answer, display: shown };
    if (proposal) { const id = `p${Date.now()}`; chat.proposals[id] = proposal; turn.proposalId = id; }
    chat.turns.push(turn);
  } catch (e) {
    if (e.code !== 'cancelled') chat.turns.push({ role: 'assistant', content: e.text || '…', display: `${e.text ? `${e.text}\n\n` : ''}⚠︎ ${ERRORS[e.code] || 'Réponse interrompue. Réessayez.'}` });
    else if (e.text) chat.turns.push({ role: 'assistant', content: e.text });
  } finally {
    chat.busy = false;
    renderChat(body);
  }
}

async function sendPhoto(body, file) {
  const sample = await getSample();
  if (!sample) return;
  chat.turns.push({ role: 'user', content: 'Photo de facture envoyée.', display: `📎 ${file.name}` });
  chat.busy = true;
  chat.ctl = new AbortController();
  renderChat(body);
  try {
    const p = await sample.json(INVOICE_PROMPT, { images: [file], signal: chat.ctl.signal, cache: false });
    if (!p || p.readable === false) {
      chat.turns.push({ role: 'assistant', content: `Facture illisible. ${p?.why || ''}`.trim() });
    } else {
      const proposal = {
        label: String(p.label || 'Facture'), amount: num(p.amount), date: /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : today(),
        account: EXPENSE_ACCOUNTS.some(([c]) => c === String(p.account)) ? String(p.account) : '615000',
        supplier: String(p.supplier || ''), piece: String(p.piece || ''), why: String(p.why || ''),
      };
      const id = `p${Date.now()}`;
      chat.proposals[id] = proposal;
      const summary = `Facture lue : ${proposal.supplier || proposal.label}, ${money(proposal.amount)} au ${fmtDate(proposal.date, { day: 'numeric', month: 'long', year: 'numeric' })}. Vérifiez puis enregistrez.`;
      chat.turns.push({ role: 'assistant', content: `${summary} Écriture proposée : ${JSON.stringify(proposal)}`, display: summary, proposalId: id });
    }
  } catch (e) {
    if (e.code !== 'cancelled') chat.turns.push({ role: 'assistant', content: '…', display: `⚠︎ ${ERRORS[e.code] || 'Lecture interrompue. Réessayez.'}` });
  } finally {
    chat.busy = false;
    renderChat(body);
  }
}
