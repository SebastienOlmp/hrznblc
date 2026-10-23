// Onglet BANQUE : import du relevé (CSV), rapprochement avec dépenses et séjours, échéancier d'emprunt.
import { esc, money, num, fmtDate, nightsBetween, isValidDate, addDays, plural } from '../utils.js';
import { db, settings, upsert, remove, byId, resNet, isActive } from '../store.js';
import { expenseForm, guestName } from './forms.js';
import { openSheet, field, toast, ask, empty } from '../ui.js';

const state = { tab: 'releve', filter: 'a_rapprocher' };

// ---------- Import CSV ----------

function splitCSV(line, sep) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function parseDate(s) {
  const m = String(s).match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return isValidDate(String(s).slice(0, 10)) ? String(s).slice(0, 10) : '';
}

/** Repère la ligne d'en-tête et les colonnes date / libellé / débit / crédit / montant. */
function analyse(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  const sep = (lines.slice(0, 15).join('\n').match(/;/g) || []).length >= (lines.slice(0, 15).join('\n').match(/,/g) || []).length ? ';' : ',';
  const rows = lines.map((l) => splitCSV(l, sep));
  const hi = rows.findIndex((r) => r.some((c) => /date/i.test(c)) && r.some((c) => /libell|opération|description/i.test(c)));
  const head = hi >= 0 ? rows[hi] : [];
  const find = (re) => head.findIndex((c) => re.test(c));
  return {
    rows: rows.slice(hi + 1).filter((r) => r.length > 1),
    head,
    map: {
      date: find(/^date/i), label: find(/libell|opération|description/i),
      debit: find(/d[ée]bit/i), credit: find(/cr[ée]dit/i), amount: find(/^montant/i),
    },
  };
}

const hash = (l) => `${l.date}|${l.amount.toFixed(2)}|${l.label.slice(0, 40)}`.replace(/[^\w|.-]/g, '');

function importSheet(text) {
  const a = analyse(text);
  if (!a.rows.length || !a.head.length) { toast('En-tête du relevé introuvable (colonnes Date et Libellé attendues).'); return; }
  const opt = (sel) => [{ value: -1, label: '—' }, ...a.head.map((h, i) => ({ value: i, label: h || `Colonne ${i + 1}` }))].map((o) => ({ ...o, value: String(o.value) }));
  const preview = (m) => a.rows.slice(0, 3).map((r) => `${r[m.date] ?? ''} · ${r[m.label] ?? ''} · ${m.amount >= 0 ? r[m.amount] : `${r[m.debit] || ''} / ${r[m.credit] || ''}`}`).join('\n');
  openSheet({
    title: 'Importer le relevé',
    submitLabel: 'Importer',
    body: `
      <p class="hint">${plural(a.rows.length, 'ligne détectée', 'lignes détectées')}. Vérifiez les colonnes :</p>
      ${field({ name: 'date', label: 'Date d’opération', type: 'select', options: opt(), value: String(a.map.date) })}
      ${field({ name: 'label', label: 'Libellé', type: 'select', options: opt(), value: String(a.map.label) })}
      ${field({ name: 'debit', label: 'Débit', type: 'select', options: opt(), value: String(a.map.debit) })}
      ${field({ name: 'credit', label: 'Crédit', type: 'select', options: opt(), value: String(a.map.credit) })}
      ${field({ name: 'amount', label: 'ou Montant signé', type: 'select', options: opt(), value: String(a.map.amount) })}
      <pre class="preview">${esc(preview(a.map))}</pre>
    `,
    onSubmit(v) {
      const m = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)]));
      const known = new Set(db().bank.map((b) => b.hash));
      let added = 0;
      for (const r of a.rows) {
        const date = parseDate(r[m.date]);
        if (!date) continue;
        const amount = m.amount >= 0 ? num(r[m.amount]) : num(r[m.credit]) - Math.abs(num(r[m.debit]));
        if (!amount) continue;
        const line = { date, label: String(r[m.label] || '').replace(/\s+/g, ' ').trim(), amount };
        line.hash = hash(line);
        if (known.has(line.hash)) continue;
        known.add(line.hash);
        upsert('bank', { ...line, id: `b${line.hash.replace(/[^A-Za-z0-9]/g, '').slice(0, 60)}${added}`, match: null });
        added++;
      }
      toast(added ? `${plural(added, 'ligne importée', 'lignes importées')}` : 'Aucune nouvelle ligne (déjà importées).');
    },
  });
}

// ---------- Rapprochement ----------

function candidates(line) {
  const out = [];
  const used = new Set(db().bank.filter((b) => b.match && b.id !== line.id).map((b) => `${b.match.coll}/${b.match.id}`));
  if (line.amount < 0) {
    for (const e of db().expenses) {
      if (used.has(`expenses/${e.id}`)) continue;
      if (Math.abs(Math.abs(line.amount) - (Number(e.amount) || 0)) < 0.01 && Math.abs(nightsBetween(e.date, line.date)) <= 20) {
        out.push({ coll: 'expenses', id: e.id, label: `${e.label} (${fmtDate(e.date)})` });
      }
    }
  } else {
    for (const r of db().reservations) {
      if (!isActive(r) || used.has(`reservations/${r.id}`)) continue;
      const net = resNet(r) + (r.taxBy === 'moi' ? Number(r.touristTax) || 0 : 0);
      if (Math.abs(line.amount - net) < 0.01 && nightsBetween(addDays(r.start, -60), line.date) >= 0 && nightsBetween(line.date, addDays(r.end, 40)) >= 0) {
        out.push({ coll: 'reservations', id: r.id, label: `Séjour ${guestName(r)} (${fmtDate(r.start)})` });
      }
    }
  }
  return out;
}

function matchLabel(m) {
  if (!m) return '';
  if (m.coll === 'expenses') return byId('expenses', m.id)?.label || 'Dépense supprimée';
  if (m.coll === 'reservations') { const r = byId('reservations', m.id); return r ? `Séjour ${guestName(r)}` : 'Séjour supprimé'; }
  return m.note || 'Justifié';
}

function lineSheet(line) {
  const c = candidates(line);
  openSheet({
    title: `${line.amount > 0 ? 'Crédit' : 'Débit'} ${money(Math.abs(line.amount))}`,
    body: `
      <p><strong>${esc(line.label)}</strong><br><span class="muted">${fmtDate(line.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span></p>
      ${line.match ? `<p class="calc">Rapproché : ${esc(matchLabel(line.match))}</p><button type="button" class="btn block" data-unmatch>Annuler le rapprochement</button>` : `
        ${c.length ? `<h3 class="form-section">Correspondances possibles</h3><div class="list">${c.map((x, i) => `<button type="button" class="item" data-pick="${i}"><span class="item-main"><strong>${esc(x.label)}</strong></span></button>`).join('')}</div>` : '<p class="hint">Aucune dépense ou séjour au même montant à proximité de cette date.</p>'}
        ${line.amount < 0 ? '<button type="button" class="btn block primary" data-create>Créer la dépense à partir de cette ligne</button>' : ''}
        ${field({ name: 'note', label: 'Ou justifier sans pièce (virement interne, remboursement Régine, mensualité…)', value: '' })}
        <button type="button" class="btn block" data-note>Marquer comme justifié</button>`}
    `,
    onMount(dlg) {
      dlg.querySelector('.sheet-body').addEventListener('click', (e) => {
        const el = e.target.closest('[data-pick],[data-create],[data-note],[data-unmatch]');
        if (!el) return;
        const set = (match) => { upsert('bank', { ...line, match }); dlg.close(); toast('Rapproché'); };
        if (el.dataset.pick) { const x = c[Number(el.dataset.pick)]; set({ coll: x.coll, id: x.id }); }
        else if (el.dataset.create !== undefined) {
          expenseForm(null, { label: line.label, amount: Math.abs(line.amount), date: line.date }, (exp) => upsert('bank', { ...line, match: { coll: 'expenses', id: exp.id } }));
        } else if (el.dataset.note !== undefined) {
          const note = dlg.querySelector('[name=note]').value.trim();
          if (!note) { toast('Indiquez la justification.'); return; }
          set({ coll: 'note', note });
        } else if (el.dataset.unmatch !== undefined) set(null);
      });
    },
    onDelete: async () => {
      if (!(await ask('Retirer cette ligne du relevé importé ?', { ok: 'Retirer', danger: true }))) return false;
      remove('bank', line.id);
    },
    deleteLabel: 'Retirer la ligne',
  });
}

// ---------- Emprunt ----------

export function loanSchedule(s = settings()) {
  const P = num(s.loanAmount), rate = num(s.loanRate) / 100 / 12, n = Math.round(num(s.loanMonths));
  if (!P || !n || !isValidDate(s.loanStart)) return null;
  const pmt = rate ? (P * rate) / (1 - (1 + rate) ** -n) : P / n;
  const rows = [];
  let crd = P;
  const [y0, m0, d0] = s.loanStart.split('-').map(Number);
  for (let k = 0; k < n; k++) {
    const interest = crd * rate;
    const capital = Math.min(crd, pmt - interest);
    crd -= capital;
    const dt = new Date(Date.UTC(y0, m0 - 1 + k, 1));
    const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
    rows.push({ k: k + 1, date: `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d0, last)).padStart(2, '0')}`, interest, capital, crd: Math.max(0, crd) });
  }
  return { pmt, rows, insurance: num(s.loanInsurance) };
}

function loanView() {
  const sch = loanSchedule();
  if (!sch) return empty('Renseignez l’emprunt (montant, taux, durée, date de la 1re échéance) dans Réglages pour afficher l’échéancier.');
  const byYear = {};
  sch.rows.forEach((r) => { const y = r.date.slice(0, 4); (byYear[y] ||= { interest: 0, capital: 0, n: 0, crd: 0 }); byYear[y].interest += r.interest; byYear[y].capital += r.capital; byYear[y].n++; byYear[y].crd = r.crd; });
  return `
    <div class="kpis">
      <div class="kpi"><small>Mensualité hors assurance</small><strong>${money(sch.pmt)}</strong></div>
      <div class="kpi"><small>Avec assurance</small><strong>${money(sch.pmt + sch.insurance)}</strong></div>
    </div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Année</th><th>Échéances</th><th>Intérêts (661100)</th><th>Capital</th><th>Assurance (616600)</th><th>Capital restant dû</th></tr></thead>
      <tbody>${Object.entries(byYear).map(([y, v]) => `<tr><td>${y}</td><td>${v.n}</td><td>${money(v.interest)}</td><td>${money(v.capital)}</td><td>${money(v.n * sch.insurance)}</td><td>${money(v.crd)}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="hint">Calcul à taux fixe sur échéances constantes. Comparez au tableau d’amortissement de la banque, qui fait foi (date et montant de la première échéance, éventuel différé).</p>`;
}

export function renderBanque(root) {
  const { tab, filter } = state;
  const lines = [...db().bank].sort((a, b) => b.date.localeCompare(a.date));
  const open = lines.filter((l) => !l.match);
  const shown = filter === 'a_rapprocher' ? open : lines;
  const balance = lines.reduce((s, l) => s + l.amount, 0);

  root.innerHTML = `
    <header class="top"><div><p class="eyebrow">Banque</p><h1>Compte dédié</h1></div></header>
    <div class="segmented">
      ${[['releve', `Relevé${open.length ? ` (${open.length})` : ''}`], ['emprunt', 'Emprunt']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}
    </div>
    ${tab === 'emprunt' ? loanView() : `
      <label class="btn block primary file-btn">Importer un relevé CSV<input type="file" id="bank-file" accept=".csv,text/csv,text/plain" hidden></label>
      <p class="hint">Dans l’appli ou le site du Crédit Agricole, exportez les opérations du compte au format CSV ou Excel/CSV, puis choisissez le fichier. Les lignes déjà importées sont ignorées.</p>
      ${lines.length ? `
        <div class="kpis"><div class="kpi"><small>Solde des lignes importées</small><strong>${money(balance)}</strong></div><div class="kpi"><small>À rapprocher</small><strong>${open.length}</strong></div></div>
        <div class="segmented small">${[['a_rapprocher', 'À rapprocher'], ['tout', 'Tout']].map(([k, l]) => `<button class="${filter === k ? 'on' : ''}" data-filter="${k}">${l}</button>`).join('')}</div>
        ${shown.length ? `<div class="list">${shown.slice(0, 300).map((l) => `
          <button class="item" data-line="${l.id}">
            <span class="item-main"><strong>${esc(l.label)}</strong><small>${fmtDate(l.date, { day: 'numeric', month: 'short', year: 'numeric' })}${l.match ? ` · ${esc(matchLabel(l.match))}` : ''}${!l.match && candidates(l).length ? ' · correspondance trouvée' : ''}</small></span>
            <span class="item-side"><span class="${l.amount < 0 ? 'neg' : 'pos'}">${money(l.amount)}</span>${l.match ? '<span class="badge">OK</span>' : ''}</span>
          </button>`).join('')}</div>` : empty('Tout est rapproché.')}`
        : empty('Aucun relevé importé.')}
    `}
  `;
  root.querySelector('#bank-file')?.addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const buf = await f.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes(String.fromCharCode(0xfffd))) text = new TextDecoder('windows-1252').decode(buf);
    importSheet(text);
  });
  root.onclick = (e) => {
    const el = e.target.closest('[data-tab],[data-filter],[data-line]');
    if (!el) return;
    if (el.dataset.tab) { state.tab = el.dataset.tab; renderBanque(root); }
    else if (el.dataset.filter) { state.filter = el.dataset.filter; renderBanque(root); }
    else lineSheet(byId('bank', el.dataset.line));
  };
}
