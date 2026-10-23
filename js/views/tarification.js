// Onglet TARIFICATION : grille par semaine et par canal, historique réalisé, veille marché, propositions de Claude.
import { esc, money, money0, num, fmtDate, addDays, today, nightsBetween, MONTHS_SHORT, pct } from '../utils.js';
import { db, settings, upsert, remove, byId, isActive, resNights, overlaps, sortedReservations } from '../store.js';
import { openSheet, field, row, toast, ask, empty } from '../ui.js';

const state = { tab: 'grille', ai: null, aiMsg: '', busy: false };

const bookingPrice = (p) => Math.round(num(p) * (1 + (Number(settings().bookingMarkup) || 0) / 100));
const sortedWeeks = () => [...db().pricing].sort((a, b) => a.start.localeCompare(b.start));

function weekStatus(w) {
  const clash = overlaps(w.start, addDays(w.start, 7));
  if (!clash.length) return null;
  const r = clash[0];
  const n = resNights(r);
  return { r, perWeek: n ? (Number(r.hostPrice) || 0) / n * 7 : 0 };
}

function grille() {
  const weeks = sortedWeeks();
  const d = today();
  const future = weeks.filter((w) => addDays(w.start, 7) > d);
  return `
    <div class="btn-row wrap">
      <button class="btn primary" data-act="week">+ Semaine</button>
      <button class="btn" data-act="gen">Générer les samedis d’une période</button>
    </div>
    ${future.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Semaine (samedi)</th><th>Repère</th><th>Direct / Airbnb</th><th>Booking</th><th>État</th></tr></thead>
      <tbody>${future.map((w) => {
        const st = weekStatus(w);
        return `<tr data-week="${w.id}" class="clickable">
          <td>${fmtDate(w.start, { day: 'numeric', month: 'short' })} → ${fmtDate(addDays(w.start, 7), { day: 'numeric', month: 'short', year: '2-digit' })}</td>
          <td>${esc(w.label || '')}</td>
          <td>${w.price ? money0(w.price) : '—'}</td>
          <td>${w.price ? money0(bookingPrice(w.price)) : '—'}</td>
          <td>${st ? `<span class="badge">Loué ${money0(st.perWeek)}</span>` : '<span class="muted">Libre</span>'}</td>
        </tr>`;
      }).join('')}</tbody></table></div>` : empty('Grille vide. Générez les samedis de la saison puis saisissez les prix.')}
    <p class="hint">Prix hôte de la semaine, hors commission voyageur et hors taxe de séjour. Booking = grille + ${settings().bookingMarkup} % (taux réglable ; commission Booking non vérifiée). « Loué » = prix hôte réalisé ramené à 7 nuits.</p>`;
}

function historique() {
  const res = sortedReservations().filter((r) => isActive(r) && resNights(r) > 0 && r.start < today());
  if (!res.length) return empty('Pas encore d’historique : les séjours passés alimenteront cette analyse.');
  const byMonth = {};
  const byChannel = {};
  const leads = [];
  for (const r of res) {
    const k = r.start.slice(0, 7);
    const n = resNights(r);
    (byMonth[k] ||= { nights: 0, host: 0, stays: 0 });
    byMonth[k].nights += n; byMonth[k].host += Number(r.hostPrice) || 0; byMonth[k].stays++;
    (byChannel[r.platform] ||= { nights: 0, host: 0, commission: 0, stays: 0 });
    byChannel[r.platform].nights += n; byChannel[r.platform].host += Number(r.hostPrice) || 0;
    byChannel[r.platform].commission += Number(r.commission) || 0; byChannel[r.platform].stays++;
    if (r.bookedAt) leads.push(nightsBetween(r.bookedAt, r.start));
  }
  leads.sort((a, b) => a - b);
  const median = leads.length ? leads[Math.floor(leads.length / 2)] : null;
  return `
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Mois</th><th>Séjours</th><th>Nuits</th><th>Prix moyen / nuit</th><th>Recette</th></tr></thead>
      <tbody>${Object.entries(byMonth).map(([k, v]) => `<tr><td>${MONTHS_SHORT[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}</td><td>${v.stays}</td><td>${v.nights}</td><td>${money0(v.host / v.nights)}</td><td>${money0(v.host)}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Canal</th><th>Séjours</th><th>Prix moyen / nuit</th><th>Commission réelle</th></tr></thead>
      <tbody>${Object.entries(byChannel).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.stays}</td><td>${money0(v.host / v.nights)}</td><td>${v.host ? pct(v.commission / v.host) : '—'}</td></tr>`).join('')}</tbody>
    </table></div>
    ${median !== null ? `<p class="calc">Délai médian entre réservation et arrivée : ${median} jours (${leads.length} séjours renseignés).</p>` : '<p class="hint">Renseignez « Réservé le » dans les réservations pour mesurer le délai de réservation.</p>'}`;
}

function veille() {
  const m = db().market || {};
  return `
    <div class="card">
      <h3 class="card-title">Veille marché${m.updatedAt ? ` · ${fmtDate(m.updatedAt.slice(0, 10), { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}</h3>
      ${m.summary ? `<div class="fiche-body">${esc(m.summary).replace(/\n/g, '<br>')}</div>` : '<p class="hint">Aucune veille pour l’instant. La tâche planifiée hebdomadaire relève les prix d’annonces comparables à La Joue du Loup et les écrit ici.</p>'}
      ${(m.comparables || []).length ? `<ul class="kv">${m.comparables.map((c) => `<li><span>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a>` : esc(c.name)}</span><span>${esc(c.price || '')}</span></li>`).join('')}</ul>` : ''}
    </div>
    <div class="card">
      <h3 class="card-title">Propositions de Claude</h3>
      <p class="hint">Claude part de votre grille, de l’historique réalisé, de la veille et des règles de votre brief (haut de fourchette en vacances scolaires, plancher intersaison), et propose un prix pour les semaines libres à venir.</p>
      <button class="btn primary" data-act="ai" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Réflexion…' : 'Proposer des prix'}</button>
      ${state.aiMsg ? `<p class="hint">${esc(state.aiMsg)}</p>` : ''}
      ${state.ai?.length ? `<div class="list">${state.ai.map((x) => {
        const w = byId('pricing', x.id);
        if (!w) return '';
        return `<div class="item static"><span class="item-main"><strong>${fmtDate(w.start, { day: 'numeric', month: 'short' })} : ${x.old ? `${money0(x.old)} → ` : ''}${money0(x.price)}</strong><small>${esc(x.why || '')}</small></span>
          ${w.price === x.price ? '<span class="badge">Appliqué</span>' : `<button class="btn small primary" data-apply="${w.id}" data-price="${x.price}">Appliquer</button>`}</div>`;
      }).join('')}</div>` : ''}
    </div>`;
}

async function propose(root) {
  const done = (msg, ai = null) => { state.busy = false; state.aiMsg = msg; state.ai = ai; renderTarification(root); };
  let sample = null;
  try { sample = await window.claude?.use?.('sample'); } catch { sample = null; }
  if (!sample) { done('Claude n’est pas disponible dans cette vue.'); return; }
  const free = sortedWeeks().filter((w) => w.start > today() && !weekStatus(w)).slice(0, 30);
  if (!free.length) { done('Aucune semaine libre à venir dans la grille.'); return; }
  const hist = sortedReservations().filter((r) => isActive(r) && r.start < today()).slice(-40)
    .map((r) => `${r.start} ${resNights(r)}n ${r.platform} ${r.hostPrice}€ réservé ${r.bookedAt || '?'}`).join('\n');
  const m = db().market || {};
  const prompt = `Tu aides à fixer les prix d'un T2 cabine de 28 m², 6 couchages (4 confort), au 4e étage, exposé sud, skis aux pieds, sans parking, à La Joue du Loup (Dévoluy, 05). Première année de location, peu d'avis : décote de 10 à 12 %.
Règles du propriétaire : prix hôte à la semaine, hors commissions et taxe de séjour ; haut de fourchette des logements similaires pendant les vacances scolaires, milieu de fourchette les semaines ordinaires ; plancher 70 € par nuit en intersaison ; le prix inclut 45 € de retouche ménage et l'accueil conciergerie.
Semaines libres (début samedi, repère, prix actuel) :
${free.map((w) => `${w.start} | ${w.label || ''} | ${w.price || 'sans prix'}`).join('\n')}
Historique réalisé :
${hist || '(aucun)'}
Veille marché :
${m.summary || '(aucune)'}
Date du jour : ${today()}. Pour une semaine proche et encore libre, envisage une baisse.
Réponds uniquement par un tableau JSON : [{"start": "AAAA-MM-JJ", "price": nombre, "why": "raison courte"}] pour les semaines dont tu changerais le prix.`;
  state.busy = true;
  state.aiMsg = '';
  renderTarification(root);
  try {
    const list = await sample.json(prompt, { modelTier: 'complex', cache: false });
    const rows = (Array.isArray(list) ? list : [])
      .map((x) => ({ w: free.find((f) => f.start === x?.start), price: Math.round(num(x?.price)), why: String(x?.why || '') }))
      .filter((x) => x.w && x.price > 0)
      .map((x) => ({ id: x.w.id, old: x.w.price, price: x.price, why: x.why }));
    done(rows.length ? '' : 'Aucun changement proposé.', rows);
  } catch (e) {
    done(e?.code === 'not_granted' ? 'Accès à Claude refusé pour cette appli.' : e?.code === 'rate_limited' ? 'Limite d’usage atteinte, réessayez plus tard.' : 'Proposition impossible pour le moment, réessayez.');
  }
}

function weekForm(existing) {
  const w = existing || { start: nextSaturday(today()) };
  openSheet({
    title: existing ? 'Semaine' : 'Nouvelle semaine',
    body: `
      ${row(field({ name: 'start', label: 'Samedi d’arrivée', type: 'date', value: w.start, required: true }), field({ name: 'price', label: 'Prix hôte semaine', type: 'money', value: w.price }))}
      ${field({ name: 'label', label: 'Repère', value: w.label, placeholder: 'Vacances de février zone C, Noël…' })}
      ${field({ name: 'nightly', label: 'Prix à la nuit (courts séjours)', type: 'money', value: w.nightly })}
    `,
    onSubmit(v) {
      if (sortedWeeks().some((x) => x.start === v.start && x.id !== existing?.id)) { toast('Cette semaine existe déjà.'); return false; }
      upsert('pricing', { ...(existing || {}), start: v.start, price: num(v.price), label: v.label, nightly: num(v.nightly) });
      toast('Semaine enregistrée');
    },
    onDelete: existing ? async () => {
      if (!(await ask('Supprimer cette semaine de la grille ?', { ok: 'Supprimer', danger: true }))) return false;
      remove('pricing', existing.id);
    } : null,
  });
}

function nextSaturday(d) {
  const day = new Date(`${d}T00:00:00Z`).getUTCDay();
  return addDays(d, (6 - day + 7) % 7);
}

function genForm() {
  openSheet({
    title: 'Générer les semaines',
    submitLabel: 'Générer',
    body: row(field({ name: 'from', label: 'Du', type: 'date', value: today(), required: true }), field({ name: 'to', label: 'Au', type: 'date', value: addDays(today(), 365), required: true })),
    onSubmit(v) {
      const have = new Set(db().pricing.map((x) => x.start));
      let n = 0;
      for (let d = nextSaturday(v.from); d <= v.to && n < 60; d = addDays(d, 7)) {
        if (have.has(d)) continue;
        upsert('pricing', { id: `w${d.replace(/-/g, '')}`, start: d, price: 0, label: '' });
        n++;
      }
      toast(`${n} semaine${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''}`);
    },
  });
}

export function renderTarification(root) {
  const { tab } = state;
  root.innerHTML = `
    <header class="top"><div><p class="eyebrow">Tarification</p><h1>Prix et marché</h1></div></header>
    <div class="segmented">
      ${[['grille', 'Grille'], ['historique', 'Historique'], ['veille', 'Veille et conseils']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}
    </div>
    ${tab === 'grille' ? grille() : tab === 'historique' ? historique() : veille()}
  `;
  root.onclick = (e) => {
    const el = e.target.closest('[data-tab],[data-act],[data-week],[data-apply]');
    if (!el) return;
    if (el.dataset.tab) { state.tab = el.dataset.tab; renderTarification(root); }
    else if (el.dataset.act === 'week') weekForm(null);
    else if (el.dataset.act === 'gen') genForm();
    else if (el.dataset.act === 'ai') propose(root);
    else if (el.dataset.week) weekForm(byId('pricing', el.dataset.week));
    else if (el.dataset.apply) {
      const w = byId('pricing', el.dataset.apply);
      upsert('pricing', { ...w, price: Number(el.dataset.price) });
      toast('Prix appliqué');
    }
  };
}

