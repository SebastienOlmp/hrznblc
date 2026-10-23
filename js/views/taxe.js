// Onglet TAXE DE SÉJOUR : nuitées et montants par mois, déclarations mensuelles, reversements.
import { money, MONTHS, cap, plural } from '../utils.js';
import { db, settings, yearStats, yearsWithData, toggleTaxLog } from '../store.js';

const state = { year: new Date().getFullYear() };
// Reversement 3 fois par an (mai, septembre, janvier) : périodes supposées janv.-avr., mai-août, sept.-déc.
const PERIODS = [
  { months: [0, 1, 2, 3], label: 'janvier – avril', pay: (y) => `mai ${y}` },
  { months: [4, 5, 6, 7], label: 'mai – août', pay: (y) => `septembre ${y}` },
  { months: [8, 9, 10, 11], label: 'septembre – décembre', pay: (y) => `janvier ${y + 1}` },
];

export function renderTaxe(root) {
  const y = state.year;
  const s = settings();
  const { months, totals } = yearStats(y);
  const log = db().taxLog;
  const years = yearsWithData();
  if (!years.includes(y)) years.unshift(y);
  const configured = Number(String(s.taxRate).replace(',', '.')) > 0;

  root.innerHTML = `
    <header class="top">
      <div><p class="eyebrow">Taxe de séjour</p><h1>${y}</h1></div>
      <select class="year-select" id="tax-year" aria-label="Année">${years.map((v) => `<option ${v === y ? 'selected' : ''}>${v}</option>`).join('')}</select>
    </header>
    ${configured ? '' : '<a class="banner" href="#reglages">Taux non renseigné : la taxe ne se calcule pas automatiquement. Renseignez le taux, le plafond et la taxe additionnelle de la délibération du Dévoluy dans Réglages.</a>'}
    <div class="kpis">
      <div class="kpi"><small>À reverser (canaux directs)</small><strong>${money(totals.taxMe)}</strong><em>${plural(totals.adultNightsMe, 'nuitée adulte', 'nuitées adultes')}</em></div>
      <div class="kpi"><small>Collectée par les plateformes</small><strong>${money(totals.taxPlatform)}</strong><em>${plural(totals.adultNightsPlatform, 'nuitée adulte', 'nuitées adultes')}</em></div>
    </div>

    <section>
      <h2 class="section-title">Reversements</h2>
      <div class="list">${PERIODS.map((p, i) => {
        const amount = p.months.reduce((sum, m) => sum + months[m].taxMe, 0);
        const key = `R${y}-${i + 1}`;
        return `<label class="item check-item">
          <input type="checkbox" data-log="${key}" ${log[key] ? 'checked' : ''}>
          <span class="item-main"><strong>${cap(p.label)}</strong><small>à reverser en ${p.pay(y)}</small></span>
          <span class="item-side"><span>${money(amount)}</span></span>
        </label>`;
      }).join('')}</div>
      <p class="hint">Calendrier repris de votre brief (mai, septembre, janvier) ; les mois couverts par chaque reversement sont supposés. Vérifiez-les sur devoluy.taxesejour.fr.</p>
    </section>

    <section>
      <h2 class="section-title">Déclarations mensuelles des nuitées</h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Mois</th><th>Nuitées directes</th><th>Taxe</th><th>Plateformes</th><th>Déclaré</th></tr></thead>
        <tbody>${months.map((m, i) => {
          const key = `${y}-${String(i + 1).padStart(2, '0')}`;
          return `<tr><td>${cap(MONTHS[i])}</td><td>${m.adultNightsMe}</td><td>${money(m.taxMe)}</td><td>${m.adultNightsPlatform}</td>
            <td><input type="checkbox" aria-label="Déclaration de ${MONTHS[i]} faite" data-log="${key}" ${log[key] ? 'checked' : ''}></td></tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="hint">Nuitées = adultes × nuits (mineurs exonérés). Pour un meublé non classé, la taxe est un pourcentage du prix de la nuitée par personne, plafonné : elle varie donc avec le prix de chaque séjour. Déclarez le mode de commercialisation sur le portail pour éviter la double collecte avec Airbnb et Booking.</p>
    </section>
  `;
  root.querySelector('#tax-year').onchange = (e) => { state.year = Number(e.target.value); renderTaxe(root); };
  root.onchange = (e) => { const c = e.target.closest('[data-log]'); if (c) toggleTaxLog(c.dataset.log); };
}
