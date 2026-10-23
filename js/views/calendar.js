import { esc, iso, today, addDays, MONTHS, cap, fmtDate, nightsBetween, plural } from '../utils.js';
import { db, settings, isActive, sortedReservations, yearStats, currentStay, upcoming, channelSlug, CHANNELS } from '../store.js';
import { reservationForm, reservationRow, guestName } from './forms.js';
import { empty } from '../ui.js';

const state = { y: null, m: null };

function hero() {
  const d = today();
  const stay = currentStay(d);
  const next = upcoming(d, 1)[0];
  if (stay) {
    const left = nightsBetween(d, stay.end);
    return `<button class="hero-card" data-res="${stay.id}">
      <small>Occupé en ce moment</small>
      <strong>${esc(guestName(stay))}</strong>
      <span>Départ ${fmtDate(stay.end, { weekday: 'long', day: 'numeric', month: 'long' })} · ${left === 0 ? 'aujourd’hui' : `dans ${plural(left, 'jour', 'jours')}`}</span>
    </button>`;
  }
  if (next) {
    const inDays = nightsBetween(d, next.start);
    return `<button class="hero-card free" data-res="${next.id}">
      <small>Libre en ce moment</small>
      <strong>Prochaine arrivée ${inDays === 1 ? 'demain' : `dans ${inDays} jours`}</strong>
      <span>${esc(guestName(next))} · ${fmtDate(next.start, { weekday: 'long', day: 'numeric', month: 'long' })} · ${esc(next.platform)}</span>
    </button>`;
  }
  return '<div class="hero-card free"><small>Libre en ce moment</small><strong>Aucune réservation à venir</strong><span>Ajoutez la première avec le bouton ci-dessous.</span></div>';
}

export function renderCalendar(root) {
  if (state.y === null) {
    const d = today();
    state.y = Number(d.slice(0, 4));
    state.m = Number(d.slice(5, 7)) - 1;
  }
  const { y, m } = state;
  const first = iso(y, m, 1);
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const last = iso(y, m, daysInMonth);
  const nextMonthStart = addDays(last, 1);
  const lead = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7; // lundi = 0
  const t = today();

  const active = db().reservations.filter(isActive);
  // Pour chaque jour : réservation dont c'est une nuit, et réservation qui part ce jour-là.
  const nightOf = {};
  const checkoutOf = {};
  for (const r of active) {
    if (r.end < first || r.start > nextMonthStart) continue;
    for (let d = r.start; d < r.end; d = addDays(d, 1)) if (d >= first && d <= last) nightOf[d] = r;
    if (r.end >= first && r.end <= last) checkoutOf[r.end] = r;
  }

  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<span class="day pad"></span>';
  for (let day = 1; day <= daysInMonth; day++) {
    const d = iso(y, m, day);
    const r = nightOf[d];
    const out = checkoutOf[d];
    const cls = ['day'];
    if (d === t) cls.push('today');
    if (r) {
      cls.push('busy', `p-${channelSlug(r.platform)}`);
      if (r.start === d) cls.push('first');
      if (addDays(d, 1) === r.end) cls.push('last');
      if (r.status === 'option') cls.push('opt');
    }
    if (out && out !== r) cls.push('checkout');
    cells += `<button class="${cls.join(' ')}" data-day="${d}" ${r ? `data-res="${r.id}"` : ''} aria-label="${d}${r ? ` : ${esc(guestName(r))}` : ' : libre'}"><span>${day}</span></button>`;
  }

  const inMonth = sortedReservations().filter((r) => r.start <= last && r.end > first);
  const { months } = yearStats(y);
  const occ = months[m].nights / daysInMonth;

  root.innerHTML = `
    <header class="top">
      <div><p class="eyebrow">${esc(settings().name)}</p><h1>Planning</h1></div>
      <button class="btn primary" data-act="new">+ Réservation</button>
    </header>
    ${hero()}
    <header class="top sub">
      <h2>${cap(MONTHS[m])} ${y}</h2>
      <div class="nav-btns">
        <button class="icon-btn" data-nav="-1" aria-label="Mois précédent"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>
        <button class="icon-btn" data-nav="0" aria-label="Aujourd’hui"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/></svg></button>
        <button class="icon-btn" data-nav="1" aria-label="Mois suivant"><svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button>
      </div>
    </header>

    <div class="cal card">
      <div class="dow"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
      <div class="grid">${cells}</div>
      <p class="cal-foot">${months[m].nights} nuit${months[m].nights > 1 ? 's' : ''} louée${months[m].nights > 1 ? 's' : ''} · occupation ${Math.round(occ * 100)} %</p>
    </div>
    <div class="legend">
      ${CHANNELS.map((c) => `<span><i class="dot p-${channelSlug(c.name)}"></i>${c.name}</span>`).join('')}
      <span><i class="dot opt-dot"></i>Option</span>
    </div>
    <p class="hint center">Touchez un jour libre pour créer une réservation.</p>

    <section>
      <h2 class="section-title">Séjours du mois</h2>
      ${inMonth.length ? `<div class="list">${inMonth.map(reservationRow).join('')}</div>` : empty('Aucun séjour ce mois-ci.')}
    </section>
  `;

  root.onclick = (e) => {
    const el = e.target.closest('[data-nav],[data-res],[data-day],[data-act]');
    if (!el) return;
    if (el.dataset.nav !== undefined) {
      const step = Number(el.dataset.nav);
      if (step === 0) { state.y = null; } else {
        const mm = state.m + step;
        state.y += Math.floor(mm / 12);
        state.m = ((mm % 12) + 12) % 12;
      }
      renderCalendar(root);
    } else if (el.dataset.res) {
      reservationForm(db().reservations.find((r) => r.id === el.dataset.res));
    } else if (el.dataset.day) {
      reservationForm(null, { start: el.dataset.day });
    } else if (el.dataset.act === 'new') {
      reservationForm(null, { start: t >= first && t <= last ? t : first });
    }
  };
}
