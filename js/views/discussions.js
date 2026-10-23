// Onglet DISCUSSIONS : voyageurs et prestataires, raccourcis vers les messageries,
// mails détectés par la tâche planifiée, messages modèles prêts à copier.
import { esc, fmtDate, today } from '../utils.js';
import { db, settings, sortedContacts, CONTACT_KINDS, isActive } from '../store.js';
import { contactForm, reservationForm, guestName } from './forms.js';
import { openSheet, copy, empty } from '../ui.js';

const state = { filter: 'voyageur', q: '' };

const INBOXES = [
  { name: 'Airbnb', url: 'https://www.airbnb.fr/hosting/messages' },
  { name: 'Booking', url: 'https://admin.booking.com/' },
  { name: 'Chalet-Montagne', url: 'https://www.chalet-montagne.com/' },
  { name: 'Leboncoin', url: 'https://www.leboncoin.fr/messages' },
  { name: 'Gens de Confiance', url: 'https://gensdeconfiance.com/fr/messages' },
];

const digits = (p) => String(p || '').replace(/[^\d+]/g, '');
const intl = (p) => { const d = digits(p); return d.startsWith('+') ? d.slice(1) : d.startsWith('0') ? `33${d.slice(1)}` : d; };

function templates(r) {
  const s = settings();
  const name = r ? guestName(r).split(' ')[0] : '[prénom]';
  const arr = r ? fmtDate(r.start, { weekday: 'long', day: 'numeric', month: 'long' }) : '[date]';
  const dep = r ? fmtDate(r.end, { weekday: 'long', day: 'numeric', month: 'long' }) : '[date]';
  return [
    { title: 'Confirmation (canal direct)', text: `Bonjour ${name},\n\nJe vous confirme votre séjour à ${s.name} du ${arr} (arrivée à partir de 16h) au ${dep} (départ le matin).\nMerci de régler l’intégralité par virement avant l’arrivée. Une caution de ${s.deposit} € est demandée, sauf si vous commandez le ménage complet.\nLe linge de lit et de toilette n’est pas fourni.${s.declaloc ? `\n\nN° d’enregistrement du meublé : ${s.declaloc}` : ''}\n\nBonne journée,` },
    { title: 'Infos d’arrivée', text: `Bonjour ${name},\n\nVotre arrivée est prévue le ${arr} à partir de 16h. Le rendez-vous pour la remise des clés se fait avec la conciergerie rue des Bains, en bas du grand escalier en bois face à l’office du tourisme. Merci de prévenir de votre heure d’arrivée.\nCasier à skis au niveau -1, accès skis aux pieds.\n\nÀ bientôt,` },
    { title: 'Veille du départ', text: `Bonjour ${name},\n\nPetit rappel pour votre départ du ${dep} : libérez le logement le matin, fermez les fenêtres, mettez les convecteurs en hors-gel et rendez les clés à la conciergerie.\nMerci pour votre séjour !` },
    { title: 'Demande d’avis', text: `Bonjour ${name},\n\nMerci d’avoir séjourné à ${s.name}. Si le séjour vous a plu, un avis nous aiderait beaucoup.\n\nAu plaisir de vous accueillir à nouveau,` },
  ];
}

function contactSheet(c) {
  const stays = db().reservations.filter((r) => r.guestId === c.id).sort((a, b) => b.start.localeCompare(a.start));
  const next = stays.find((r) => isActive(r) && r.end >= today()) || stays[0];
  const mails = db().inbox.filter((m) => (c.email && m.fromEmail === c.email) || m.contactId === c.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const phone = c.phone ? digits(c.phone) : '';
  const body = `
    <div class="contact-head">
      <p class="muted">${esc(CONTACT_KINDS[c.kind] || '')}${c.role ? ` · ${esc(c.role)}` : ''}</p>
      ${c.phone ? `<div class="copy-row"><span class="selectable">${esc(c.phone)}</span><button type="button" class="btn small" data-copy="${esc(c.phone)}">Copier</button></div>` : ''}
      ${c.email ? `<div class="copy-row"><span class="selectable">${esc(c.email)}</span><button type="button" class="btn small" data-copy="${esc(c.email)}">Copier</button></div>` : ''}
      <div class="btn-row wrap">
        ${phone ? `<a class="btn small" href="https://wa.me/${intl(c.phone)}" target="_blank" rel="noopener">WhatsApp</a><a class="btn small" href="tel:${phone}">Appeler</a><a class="btn small" href="sms:${phone}">SMS</a>` : ''}
        ${c.email ? `<a class="btn small" href="https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(c.email)}" target="_blank" rel="noopener">Écrire (Gmail)</a>` : ''}
      </div>
      <p class="hint">Les liens Appeler et SMS peuvent ne rien faire dans certaines vues : le numéro reste copiable.</p>
    </div>
    ${c.notes ? `<p>${esc(c.notes)}</p>` : ''}
    ${stays.length ? `<h3 class="form-section">Séjours</h3><div class="list">${stays.map((r) => `<button type="button" class="item" data-res="${r.id}"><span class="item-main"><strong>${fmtDate(r.start)} → ${fmtDate(r.end, { day: 'numeric', month: 'short', year: 'numeric' })}</strong><small>${esc(r.platform)}${r.ref ? ` · ${esc(r.ref)}` : ''}</small></span></button>`).join('')}</div>` : ''}
    ${mails.length ? `<h3 class="form-section">Mails reçus</h3><div class="list">${mails.slice(0, 10).map((m) => `<div class="item static"><span class="item-main"><strong>${esc(m.subject || '(sans objet)')}</strong><small>${fmtDate(m.date, { day: 'numeric', month: 'short' })} · ${esc(m.summary || '')}</small>${m.gmailUrl ? `<a class="small-link" href="${esc(m.gmailUrl)}" target="_blank" rel="noopener">Ouvrir dans Gmail</a>` : ''}</span></div>`).join('')}</div>` : ''}
    ${c.kind === 'voyageur' ? `<h3 class="form-section">Messages modèles</h3>${templates(next).map((t, i) => `
      <details class="tpl"><summary>${esc(t.title)}</summary><pre class="selectable" id="tpl-${i}">${esc(t.text)}</pre><button type="button" class="btn small" data-copy-tpl="${i}">Copier le message</button></details>`).join('')}` : ''}
    <button type="button" class="btn block" data-edit>Modifier le contact</button>
  `;
  const tpls = c.kind === 'voyageur' ? templates(next) : [];
  openSheet({
    title: c.name,
    body,
    onMount(dlg) {
      dlg.querySelector('.sheet-body').addEventListener('click', (e) => {
        const el = e.target.closest('[data-copy],[data-copy-tpl],[data-res],[data-edit]');
        if (!el) return;
        if (el.dataset.copy) copy(el.dataset.copy);
        else if (el.dataset.copyTpl) copy(tpls[Number(el.dataset.copyTpl)].text);
        else if (el.dataset.res) reservationForm(db().reservations.find((r) => r.id === el.dataset.res));
        else if (el.dataset.edit !== undefined) contactForm(c);
      });
    },
  });
}

export function renderDiscussions(root) {
  const { filter, q } = state;
  const d = today();
  const upcomingGuests = new Map();
  db().reservations.filter((r) => isActive(r) && r.end >= d).forEach((r) => {
    if (r.guestId && (!upcomingGuests.has(r.guestId) || r.start < upcomingGuests.get(r.guestId).start)) upcomingGuests.set(r.guestId, r);
  });
  let list = sortedContacts().filter((c) => (filter === 'tous' || c.kind === filter || (filter === 'prestataire' && c.kind === 'autre')));
  if (q) list = list.filter((c) => `${c.name} ${c.role || ''} ${c.phone || ''} ${c.email || ''}`.toLowerCase().includes(q.toLowerCase()));
  if (filter === 'voyageur') list.sort((a, b) => (upcomingGuests.get(a.id)?.start || '9999').localeCompare(upcomingGuests.get(b.id)?.start || '9999'));
  const clientMails = db().inbox.filter((m) => m.kind === 'client' && m.status !== 'traite').sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 5);

  root.innerHTML = `
    <header class="top">
      <div><p class="eyebrow">Discussions</p><h1>Voyageurs et contacts</h1></div>
      <button class="btn primary" data-act="new">+ Contact</button>
    </header>
    <div class="chips">${INBOXES.map((x) => `<a class="chip" href="${x.url}" target="_blank" rel="noopener">${x.name} ↗</a>`).join('')}</div>
    ${clientMails.length ? `<section><h2 class="section-title">Mails clients récents</h2><div class="list">${clientMails.map((m) => `
      <div class="item static"><span class="item-main"><strong>${esc(m.subject || '(sans objet)')}</strong><small>${esc(m.from || '')} · ${fmtDate(m.date, { day: 'numeric', month: 'short' })}${m.summary ? ` · ${esc(m.summary)}` : ''}</small>${m.gmailUrl ? `<a class="small-link" href="${esc(m.gmailUrl)}" target="_blank" rel="noopener">Ouvrir dans Gmail</a>` : ''}</span></div>`).join('')}</div></section>` : ''}
    <div class="segmented">
      ${[['voyageur', 'Voyageurs'], ['prestataire', 'Prestataires'], ['tous', 'Tous']].map(([k, l]) => `<button class="${filter === k ? 'on' : ''}" data-filter="${k}">${l}</button>`).join('')}
    </div>
    <input class="search" id="contact-search" type="search" placeholder="Rechercher" value="${esc(q)}">
    ${list.length ? `<div class="list">${list.map((c) => {
      const r = upcomingGuests.get(c.id);
      return `<button class="item" data-contact="${c.id}">
        <span class="avatar">${esc(c.name.charAt(0).toUpperCase())}</span>
        <span class="item-main"><strong>${esc(c.name)}</strong><small>${r ? `Séjour ${fmtDate(r.start)} → ${fmtDate(r.end)} · ${esc(r.platform)}` : esc(c.role || c.phone || c.email || CONTACT_KINDS[c.kind])}</small></span>
      </button>`;
    }).join('')}</div>` : empty('Aucun contact. Les voyageurs sont ajoutés automatiquement avec leurs réservations.')}
    <p class="hint">Les messageries Airbnb et Booking ne sont pas accessibles depuis une appli tierce : utilisez les raccourcis ci-dessus. Les mails reçus sur la boîte liée sont rattachés aux contacts par la tâche quotidienne.</p>
  `;
  const search = root.querySelector('#contact-search');
  search.oninput = () => {
    state.q = search.value;
    const pos = search.selectionStart;
    renderDiscussions(root);
    const s2 = root.querySelector('#contact-search');
    s2.focus();
    s2.setSelectionRange(pos, pos);
  };
  root.onclick = (e) => {
    const el = e.target.closest('[data-filter],[data-contact],[data-act]');
    if (!el) return;
    if (el.dataset.filter) { state.filter = el.dataset.filter; renderDiscussions(root); }
    else if (el.dataset.contact) contactSheet(db().contacts.find((c) => c.id === el.dataset.contact));
    else if (el.dataset.act === 'new') contactForm(null, state.filter === 'voyageur' ? 'voyageur' : 'prestataire');
  };
}

