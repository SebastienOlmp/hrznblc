// Onglet CONCIERGERIE : prestations par séjour, coût estimé vs factures, minimum de locations l'hiver.
import { esc, money, fmtDate, plural, today } from '../utils.js';
import { db, settings, isActive, sortedReservations, winterSeason, resConcierge, CLEANING, WELCOME, DEPOSIT } from '../store.js';
import { reservationForm, guestName } from './forms.js';
import { empty } from '../ui.js';
import { sendDocButton, bindSendDoc } from '../vault.js';

const now = new Date();
const state = { season: now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1 };

export function renderConciergerie(root) {
  const s = settings();
  const y = state.season;
  const { start, end } = winterSeason(y);
  const winterStays = sortedReservations().filter((r) => isActive(r) && r.start >= start && r.start < end);
  const min = Number(s.winterMin) || 6;
  const count = winterStays.length;
  const year = String(today().slice(0, 4));
  const stays = sortedReservations().filter((r) => isActive(r) && (r.start.startsWith(year) || r.end.startsWith(year)));
  const estimate = stays.reduce((sum, r) => sum + resConcierge(r), 0);
  const invoices = db().expenses.filter((e) => e.account === '622900' && e.date?.startsWith(year));
  const invoiced = invoices.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const deposits = stays.filter((r) => r.deposit === 'demandee' && r.end >= today());

  root.innerHTML = `
    <header class="top">
      <div><p class="eyebrow">Conciergerie</p><h1>Prestations et contrat</h1></div>
      <div class="nav-btns">
        <button class="icon-btn" data-season="-1" aria-label="Saison précédente"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>
        <button class="icon-btn" data-season="1" aria-label="Saison suivante"><svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button>
      </div>
    </header>

    ${sendDocButton('Conciergerie', 'Conciergerie', 'Envoyer un contrat, une facture ou un courrier')}
    <div class="card">
      <h3 class="card-title">Saison d’hiver ${y}-${y + 1} · minimum contractuel (article 8)</h3>
      <div class="meter"><i style="width:${Math.min(100, (count / min) * 100)}%"></i></div>
      <p class="big">${count} / ${min} location${min > 1 ? 's' : ''}</p>
      <small class="hint">Séjours confirmés ou en option arrivant entre le ${fmtDate(start, { day: 'numeric', month: 'long', year: 'numeric' })} et le ${fmtDate(end, { day: 'numeric', month: 'long', year: 'numeric' })} (bornes modifiables dans Réglages).${count < min ? ` Il en manque ${min - count}.` : ''}</small>
    </div>

    <div class="kpis">
      <div class="kpi"><small>Coût estimé ${year}</small><strong>${money(estimate)}</strong><em>${plural(stays.length, 'séjour', 'séjours')}</em></div>
      <div class="kpi"><small>Factures saisies (622900)</small><strong>${money(invoiced)}</strong><em>${plural(invoices.length, 'facture', 'factures')}</em></div>
    </div>
    ${invoices.length && Math.abs(invoiced - estimate) > 1 ? `<p class="calc warn">Écart factures − estimation : ${money(invoiced - estimate)}. Vérifiez la grille tarifaire réelle (le tarif ménage n’est pas confirmé par écrit).</p>` : ''}

    ${deposits.length ? `<section><h2 class="section-title">Cautions à recevoir</h2><div class="list">${deposits.map((r) => `
      <button class="item" data-res="${r.id}"><span class="item-main"><strong>${esc(guestName(r))}</strong><small>Arrivée ${fmtDate(r.start, { day: 'numeric', month: 'long' })} · ${esc(r.platform)}</small></span><span class="badge option">${DEPOSIT[r.deposit]}</span></button>`).join('')}</div></section>` : ''}

    <section>
      <h2 class="section-title">Prestations par séjour (${year})</h2>
      ${stays.length ? `<div class="list">${stays.map((r) => `
        <button class="item" data-res="${r.id}">
          <span class="item-main"><strong>${esc(guestName(r))} · ${fmtDate(r.start)} → ${fmtDate(r.end)}</strong>
          <small>${esc(WELCOME[r.welcome] || WELCOME.eco)} · ${esc(CLEANING[r.cleaning] || CLEANING.retouche)}</small></span>
          <span class="item-side"><span>${money(resConcierge(r))}</span></span>
        </button>`).join('')}</div>` : empty('Aucun séjour cette année.')}
    </section>

    <div class="card">
      <h3 class="card-title">Tarifs appliqués (Réglages)</h3>
      <ul class="kv">
        <li><span>Accueil ECO</span><span>${money(s.welcomeEco)}</span></li>
        <li><span>Retouche après départ</span><span>${money(s.touchUp)}</span></li>
        <li><span>Ménage complet payé par moi</span><span>${money(s.fullCleanOwner)}</span></li>
        <li><span>Ménage complet payé par le locataire</span><span>${money(s.fullCleanGuest)}</span></li>
        <li><span>Caution ménage</span><span>${money(s.deposit)}</span></li>
      </ul>
      <small class="hint">Pas de mandat d’encaissement : sur les canaux directs, le voyageur règle tout par virement avant l’arrivée. Départ le dimanche : +30 % chez la conciergerie.</small>
    </div>
  `;
  bindSendDoc(root);
  root.onclick = (e) => {
    const el = e.target.closest('[data-season],[data-res]');
    if (!el) return;
    if (el.dataset.season) { state.season += Number(el.dataset.season); renderConciergerie(root); }
    else reservationForm(db().reservations.find((r) => r.id === el.dataset.res));
  };
}
