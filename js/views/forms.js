// Formulaires partagés entre plusieurs écrans : réservation, dépense, contact, intervention.
import { esc, num, money, today, addDays, fmtDate, nightsBetween, isValidDate, toUTC } from '../utils.js';
import {
  db, settings, upsert, remove, byId, CHANNELS, channel, channelSlug, STATUSES, CLEANING, WELCOME, DEPOSIT,
  EXPENSE_ACCOUNTS, CONTACT_KINDS, overlaps, findContactByName, sortedContacts, resNights, resNet,
  conciergeCost, computeTax, taxByMe,
} from '../store.js';
import { field, row, openSheet, toast, ask, uploadFile, attachmentLinks } from '../ui.js';

const opts = (obj) => Object.entries(obj).map(([value, label]) => ({ value, label }));
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const weekday = (d) => WEEKDAYS[new Date(toUTC(d)).getUTCDay()];

// ---------- Réservation ----------

export function reservationForm(existing, preset = {}) {
  const s = settings();
  const start = preset.start || today();
  const r = existing || {
    start, end: addDays(start, 7), platform: 'Airbnb', status: 'confirmee', adults: 2, children: 0,
    cleaning: 'retouche', welcome: 'eco', deposit: 'demandee',
  };
  const guest = r.guestId ? byId('contacts', r.guestId) : null;
  const voyageurs = db().contacts.filter((c) => c.kind === 'voyageur');
  const body = `
    ${field({ name: 'guestName', label: 'Voyageur', value: guest?.name || r.guestName || '', required: true, placeholder: 'Nom du voyageur', attrs: 'list="guest-list" autocapitalize="words"' })}
    <datalist id="guest-list">${voyageurs.map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist>
    ${row(
      field({ name: 'start', label: 'Arrivée (16h)', type: 'date', value: r.start, required: true }),
      field({ name: 'end', label: 'Départ (matin)', type: 'date', value: r.end, required: true }),
    )}
    <p class="calc" data-dates></p>
    ${row(
      field({ name: 'platform', label: 'Canal', type: 'select', options: CHANNELS.map((c) => c.name), value: r.platform }),
      field({ name: 'status', label: 'Statut', type: 'select', options: opts(STATUSES), value: r.status }),
    )}
    ${row(
      field({ name: 'adults', label: 'Adultes', type: 'integer', value: r.adults }),
      field({ name: 'children', label: 'Mineurs', type: 'integer', value: r.children }),
    )}

    <h3 class="form-section">Prix</h3>
    ${field({ name: 'hostPrice', label: 'Prix hôte du séjour', type: 'money', value: r.hostPrice, hint: 'Hors commission voyageur et hors taxe de séjour.' })}
    ${row(
      field({ name: 'commission', label: 'Commission hôte', type: 'money', value: r.commission }),
      field({ name: 'bookedAt', label: 'Réservé le', type: 'date', value: r.bookedAt || (existing ? '' : today()) }),
    )}
    ${field({ name: 'ref', label: 'Référence de réservation', value: r.ref, placeholder: 'Code Airbnb, n° Booking…' })}
    ${row(
      field({ name: 'taxBy', label: 'Taxe de séjour collectée par', type: 'select', options: [{ value: 'plateforme', label: 'La plateforme' }, { value: 'moi', label: 'Moi' }], value: existing ? (taxByMe(r) ? 'moi' : 'plateforme') : (channel(r.platform).collectsTax ? 'plateforme' : 'moi') }),
      field({ name: 'touristTax', label: 'Montant taxe', type: 'money', value: r.touristTax }),
    )}
    <p class="hint" data-taxhint></p>

    <h3 class="form-section">Conciergerie</h3>
    ${field({ name: 'cleaning', label: 'Ménage', type: 'select', options: opts(CLEANING), value: r.cleaning })}
    ${field({ name: 'welcome', label: 'Accueil', type: 'select', options: opts(WELCOME), value: r.welcome })}
    ${row(
      field({ name: 'conciergeCost', label: 'Coût à ma charge', type: 'money', value: r.conciergeCost ?? '' }),
      field({ name: 'deposit', label: `Caution ${money(s.deposit)}`, type: 'select', options: opts(DEPOSIT), value: r.deposit }),
    )}
    ${field({ name: 'paid', label: 'Paiement intégral reçu (virement avant arrivée)', type: 'checkbox', value: r.paid })}
    <p class="calc" data-margin></p>

    ${!existing ? `<h3 class="form-section">Contact du voyageur</h3>${row(
      field({ name: 'phone', label: 'Téléphone', type: 'tel', value: '' }),
      field({ name: 'email', label: 'E-mail', type: 'email', value: '' }),
    )}` : ''}
    ${field({ name: 'notes', label: 'Notes', type: 'textarea', value: r.notes, placeholder: 'Heure d’arrivée, linge loué, demandes…' })}
  `;
  openSheet({
    title: existing ? 'Réservation' : 'Nouvelle réservation',
    body,
    onMount(dlg) {
      const f = dlg.querySelector('form');
      const out = (sel) => dlg.querySelector(sel);
      // Un montant saisi à la main n'est plus recalculé automatiquement.
      const manual = { touristTax: existing && r.touristTax !== undefined && r.touristTax !== '', conciergeCost: existing && r.conciergeCost !== undefined && r.conciergeCost !== '' };
      ['touristTax', 'conciergeCost'].forEach((k) => f[k].addEventListener('input', () => { manual[k] = f[k].value.trim() !== ''; }));
      const fmtInput = (v) => (v ? String(v.toFixed(2)).replace('.', ',') : '');

      const update = () => {
        const st = f.start.value, en = f.end.value;
        const n = isValidDate(st) && isValidDate(en) ? nightsBetween(st, en) : 0;
        const dates = out('[data-dates]');
        if (n <= 0) {
          dates.textContent = 'Le départ doit être après l’arrivée.';
          dates.className = 'calc error';
        } else {
          const warn = [];
          const day = weekday(en);
          if (day !== 'samedi') warn.push(`départ un ${day}${day === 'dimanche' ? ' (conciergerie +30 %)' : ''}`);
          const people = num(f.adults.value) + num(f.children.value);
          if (people > (Number(s.capacity) || 6)) warn.push(`${people} personnes > capacité ${s.capacity}`);
          dates.textContent = `${n} nuit${n > 1 ? 's' : ''}${warn.length ? ` · ⚠︎ ${warn.join(' · ')}` : ''}`;
          dates.className = warn.length ? 'calc warn' : 'calc';
        }

        const draft = {
          hostPrice: num(f.hostPrice.value), commission: num(f.commission.value), adults: f.adults.value,
          children: f.children.value, start: st, end: en, cleaning: f.cleaning.value,
        };
        const taxHint = out('[data-taxhint]');
        if (f.taxBy.value === 'moi') {
          const tax = computeTax(draft);
          if (tax === null) taxHint.textContent = 'Renseignez le taux de taxe de séjour dans Réglages pour le calcul automatique.';
          else {
            taxHint.textContent = `Calcul : ${money(tax)} à facturer au voyageur et à reverser à la commune.`;
            if (!manual.touristTax) f.touristTax.value = fmtInput(tax);
          }
        } else {
          taxHint.textContent = 'Collectée et reversée par la plateforme : montant pour information.';
        }
        if (!manual.conciergeCost) f.conciergeCost.value = fmtInput(conciergeCost(draft));
        if (!existing && f.cleaning.value !== 'retouche' && f.deposit.value === 'demandee') f.deposit.value = 'na';

        const net = draft.hostPrice - draft.commission;
        const margin = net - num(f.conciergeCost.value);
        out('[data-margin]').textContent = n > 0 && draft.hostPrice
          ? `Net ${money(net)} · après conciergerie ${money(margin)} · ${money(margin / n)} / nuit`
          : '';
      };
      f.start.addEventListener('change', () => {
        if (f.end.value <= f.start.value) f.end.value = addDays(f.start.value, 7);
      });
      f.platform.addEventListener('change', () => {
        f.taxBy.value = channel(f.platform.value).collectsTax ? 'plateforme' : 'moi';
        manual.touristTax = false;
        if (f.taxBy.value === 'plateforme') f.touristTax.value = '';
      });
      f.addEventListener('input', update);
      f.addEventListener('change', update);
      update();
    },
    async onSubmit(v) {
      if (!(v.end > v.start)) { toast('Le départ doit être après l’arrivée.'); return false; }
      if (v.status !== 'annulee') {
        const clash = overlaps(v.start, v.end, existing?.id);
        if (clash.length && !(await ask(`Attention : ces dates chevauchent ${clash.map((c) => `${guestName(c)} (${fmtDate(c.start)} → ${fmtDate(c.end)})`).join(', ')}.`, { ok: 'Enregistrer quand même' }))) return false;
      }
      let contact = findContactByName(v.guestName);
      if (!contact) {
        contact = upsert('contacts', { kind: 'voyageur', name: v.guestName.trim(), phone: v.phone || '', email: v.email || '', notes: '' });
      } else if (!existing && (v.phone || v.email)) {
        upsert('contacts', { ...contact, phone: contact.phone || v.phone || '', email: contact.email || v.email || '' });
      }
      upsert('reservations', {
        ...(existing || {}),
        guestId: contact.id, guestName: contact.name,
        start: v.start, end: v.end, platform: v.platform, status: v.status,
        adults: num(v.adults), children: num(v.children),
        hostPrice: num(v.hostPrice), commission: num(v.commission),
        taxBy: v.taxBy, touristTax: v.touristTax === '' ? '' : num(v.touristTax),
        cleaning: v.cleaning, welcome: v.welcome, conciergeCost: v.conciergeCost === '' ? '' : num(v.conciergeCost),
        deposit: v.deposit, paid: v.paid, notes: v.notes, bookedAt: v.bookedAt, ref: v.ref.trim(),
      });
      toast(existing ? 'Réservation mise à jour' : 'Réservation ajoutée');
    },
    onDelete: existing ? async () => {
      if (!(await ask('Supprimer cette réservation ?', { ok: 'Supprimer', danger: true }))) return false;
      remove('reservations', existing.id);
      toast('Réservation supprimée');
    } : null,
  });
}

export const guestName = (r) => (r.guestId && byId('contacts', r.guestId)?.name) || r.guestName || 'Voyageur';

export function reservationRow(r) {
  const n = resNights(r);
  const flags = [];
  if (r.status !== 'confirmee') flags.push(`<span class="badge ${r.status}">${STATUSES[r.status]}</span>`);
  else if (taxByMe(r) && !r.paid && r.end >= today()) flags.push('<span class="badge option">Paiement</span>');
  if (r.status === 'confirmee' && r.deposit === 'demandee' && r.end >= today()) flags.push('<span class="badge option">Caution</span>');
  return `
    <button class="item" data-res="${r.id}">
      <span class="dot p-${channelSlug(r.platform)}"></span>
      <span class="item-main">
        <strong>${esc(guestName(r))}</strong>
        <small>${fmtDate(r.start)} → ${fmtDate(r.end)} · ${n} nuit${n > 1 ? 's' : ''} · ${esc(r.platform)}</small>
      </span>
      <span class="item-side">
        ${flags.join('')}
        <span>${money(resNet(r))}</span>
      </span>
    </button>`;
}

// ---------- Dépense ----------

export function expenseForm(existing, preset = null, onSaved = null) {
  const e = existing || { date: today(), account: '614000', paidBy: 'banque', ...(preset || {}) };
  const attachments = [...(e.attachments || [])];
  openSheet({
    title: existing ? 'Dépense' : preset ? 'Valider la dépense proposée' : 'Nouvelle dépense',
    body: `
      ${preset?.why ? `<p class="calc warn">${esc(preset.why)}</p>` : ''}
      ${field({ name: 'label', label: 'Libellé', value: e.label, required: true, placeholder: 'Ex. Appel de fonds T4 LOGEVAC' })}
      ${row(
        field({ name: 'amount', label: 'Montant TTC', type: 'money', value: e.amount, required: true }),
        field({ name: 'date', label: 'Date de la pièce', type: 'date', value: e.date, required: true }),
      )}
      ${field({ name: 'account', label: 'Compte', type: 'select', options: EXPENSE_ACCOUNTS.map(([c, l]) => ({ value: c, label: `${c} · ${l}` })), value: e.account })}
      ${row(
        field({ name: 'supplier', label: 'Fournisseur', value: e.supplier }),
        field({ name: 'piece', label: 'N° justificatif', value: e.piece }),
      )}
      ${field({ name: 'paidBy', label: 'Payé par', type: 'select', options: [{ value: 'banque', label: 'Compte bancaire dédié (512100)' }, { value: 'regine', label: 'Avance de Régine (467600)' }, { value: 'exploitant', label: 'Moi, sur mes fonds personnels (108000)' }], value: e.paidBy })}
      ${field({ name: 'reimbursed', label: 'Avance remboursée à Régine', type: 'checkbox', value: e.reimbursed })}
      ${field({ name: 'notes', label: 'Notes', type: 'textarea', value: e.notes })}
      <h3 class="form-section">Justificatif</h3>
      <div class="attach-list" data-attach>${attachmentLinks(attachments) || '<span class="muted">Aucun justificatif joint.</span>'}</div>
      <label class="btn small file-btn">+ Joindre une photo ou un PDF<input type="file" accept="image/*,application/pdf" data-attach-input hidden></label>
      ${e.ledgerEntry ? `<p class="hint">Au classeur : écriture n° ${e.ledgerEntry}${e.piece ? `, pièce ${esc(e.piece)}` : ''}.</p>` : ''}
    `,
    onMount(dlg) {
      dlg.querySelector('[data-attach-input]').addEventListener('change', async (ev) => {
        const f = ev.target.files?.[0];
        if (!f) return;
        toast('Archivage…');
        const a = await uploadFile(f);
        if (!a) return;
        attachments.push(a);
        dlg.querySelector('[data-attach]').innerHTML = attachmentLinks(attachments);
        toast('Justificatif joint');
      });
    },
    async onSubmit(v) {
      if (num(v.amount) <= 0) { toast('Indiquez un montant.'); return false; }
      const saved = upsert('expenses', {
        ...(existing || {}), label: v.label.trim(), amount: num(v.amount), date: v.date, account: v.account,
        supplier: v.supplier, piece: v.piece, paidBy: v.paidBy, reimbursed: v.paidBy === 'regine' ? v.reimbursed : false, notes: v.notes,
        attachments,
        ...(preset?.source ? { source: preset.source, sourceLink: preset.sourceLink || '' } : {}),
      });
      onSaved?.(saved);
      toast(existing ? 'Dépense mise à jour' : 'Dépense ajoutée');
    },
    onDelete: existing ? async () => {
      if (!(await ask(existing.ledgerEntry ? `Cette dépense est déjà au classeur (écriture n° ${existing.ledgerEntry}). La supprimer ici demandera une contre-passation, que Claude vous proposera. Continuer ?` : 'Supprimer cette dépense ?', { ok: 'Supprimer', danger: true }))) return false;
      remove('expenses', existing.id);
      db().tasks.filter((t) => t.expenseId === existing.id).forEach((t) => upsert('tasks', { ...t, expenseId: null }));
      toast('Dépense supprimée');
    } : null,
  });
}

// ---------- Contact ----------

export function contactForm(existing, kind = 'prestataire') {
  const c = existing || { kind };
  openSheet({
    title: existing ? 'Modifier le contact' : 'Nouveau contact',
    body: `
      ${field({ name: 'name', label: 'Nom', value: c.name, required: true, attrs: 'autocapitalize="words"' })}
      ${row(
        field({ name: 'kind', label: 'Type', type: 'select', options: Object.entries(CONTACT_KINDS).map(([value, label]) => ({ value, label })), value: c.kind }),
        field({ name: 'role', label: 'Rôle', value: c.role, placeholder: 'Ménage, syndic…' }),
      )}
      ${field({ name: 'phone', label: 'Téléphone', type: 'tel', value: c.phone })}
      ${field({ name: 'email', label: 'E-mail', type: 'email', value: c.email })}
      ${field({ name: 'notes', label: 'Notes', type: 'textarea', value: c.notes })}
    `,
    async onSubmit(v) {
      const dup = findContactByName(v.name);
      if (dup && dup.id !== existing?.id) { toast('Un contact porte déjà ce nom.'); return false; }
      if (existing) {
        db().reservations.filter((r) => r.guestId === existing.id).forEach((r) => { r.guestName = v.name.trim(); });
      }
      upsert('contacts', { ...(existing || {}), name: v.name.trim(), kind: v.kind, role: v.role, phone: v.phone, email: v.email, notes: v.notes });
      toast(existing ? 'Contact mis à jour' : 'Contact ajouté');
    },
    onDelete: existing ? async () => {
      const used = db().reservations.filter((r) => r.guestId === existing.id).length;
      if (!(await ask(used ? `Ce contact est lié à ${used} réservation(s). Le supprimer quand même ? Les réservations sont conservées.` : 'Supprimer ce contact ?', { ok: 'Supprimer', danger: true }))) return false;
      remove('contacts', existing.id);
      toast('Contact supprimé');
    } : null,
  });
}

// ---------- To-do (actions, décisions, entretien) ----------

export const TASK_KINDS = { action: 'Action', decision: 'Décision à trancher', entretien: 'Entretien / travaux', admin: 'Administratif' };
export const PRIORITIES = { haute: 'Haute', normale: 'Normale', basse: 'Basse' };

export const TASK_STATUS = { todo: 'À faire', done: 'Fait', refusee: 'Non retenue', supprimee: 'Archivée (supprimée)' };
let taskHook = null;
/** Appelé quand une réponse ou un statut de tâche change : Claude en fait le suivi. */
export const setTaskHook = (fn) => { taskHook = fn; };

export function taskForm(existing, preset = {}) {
  const t = existing || { date: '', status: 'todo', kind: preset.kind || 'action', priority: 'normale', source: 'manuel' };
  const pros = sortedContacts().filter((c) => c.kind !== 'voyageur');
  const history = Array.isArray(t.history) ? t.history : [];
  openSheet({
    title: existing ? 'Tâche' : 'Nouvelle tâche',
    body: `
      ${t.source && t.source !== 'manuel' ? `<p class="hint">Proposée ${t.source === 'mail' ? 'depuis un mail' : t.source === 'brief' ? 'à partir de votre brief' : 'par Claude'}${t.createdAt ? ` le ${fmtDate(t.createdAt.slice(0, 10), { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}${t.link ? ` · <a href="${esc(t.link)}" target="_blank" rel="noopener">ouvrir le mail</a>` : ''}</p>` : ''}
      ${field({ name: 'title', label: 'Quoi ?', value: t.title, required: true, placeholder: 'Ex. Relancer Pacifica (capacité 6)' })}
      ${row(
        field({ name: 'kind', label: 'Type', type: 'select', options: opts(TASK_KINDS), value: t.kind }),
        field({ name: 'priority', label: 'Priorité', type: 'select', options: opts(PRIORITIES), value: t.priority }),
      )}
      ${row(
        field({ name: 'date', label: 'Échéance', type: 'date', value: t.date }),
        field({ name: 'status', label: 'Statut', type: 'select', options: opts(TASK_STATUS), value: t.status }),
      )}
      ${t.notes ? `<div class="note-box"><small>Contexte</small><p>${esc(t.notes).replace(/\n/g, '<br>')}</p></div>` : ''}
      ${t.claudeReply ? `<div class="note-box claude"><small>Réponse de Claude${t.claudeReplyAt ? ` · ${fmtDate(t.claudeReplyAt.slice(0, 10), { day: 'numeric', month: 'short' })}` : ''}</small><p>${esc(t.claudeReply).replace(/\n/g, '<br>')}</p></div>` : ''}
      ${field({ name: 'decision', label: 'Ma réponse à Claude', type: 'textarea', rows: 3, value: '', placeholder: 'Ex. « C’est fait, Pacifica a confirmé par mail » ou « Non, inutile ». Dictée possible avec le micro du clavier.', hint: 'Claude lit votre réponse, fait ce qui est possible de son côté et vous répond ici.' })}
      ${!existing ? field({ name: 'notes', label: 'Détails', type: 'textarea', rows: 3, value: '' }) : ''}
      <h3 class="form-section">Prestataire et coût (facultatif)</h3>
      ${field({ name: 'contactId', label: 'Prestataire', type: 'select', options: [{ value: '', label: '— Aucun —' }, ...pros.map((c) => ({ value: c.id, label: c.role ? `${c.name} (${c.role})` : c.name }))], value: t.contactId || '' })}
      ${field({ name: 'cost', label: 'Coût', type: 'money', value: t.cost })}
      ${field({ name: 'toExpense', label: t.expenseId ? 'Dépense liée dans Compta (mise à jour automatique)' : 'Ajouter le coût aux dépenses (615000)', type: 'checkbox', value: Boolean(t.expenseId) })}
      ${history.length ? `<h3 class="form-section">Historique</h3><ul class="history">${history.slice().reverse().map((h) => `<li><small>${fmtDate((h.at || '').slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' })} · ${h.by === 'claude' ? 'Claude' : 'Vous'}</small><span>${esc(h.text)}</span></li>`).join('')}</ul>` : ''}
    `,
    async onSubmit(v) {
      const now = new Date().toISOString();
      const events = [...history];
      const reply = v.decision.trim();
      if (!existing) events.push({ at: now, by: 'moi', text: 'Tâche créée' });
      if (existing && v.status !== t.status) events.push({ at: now, by: 'moi', text: `Statut : ${TASK_STATUS[t.status] || t.status} → ${TASK_STATUS[v.status]}` });
      if (reply) events.push({ at: now, by: 'moi', text: reply });
      const task = {
        ...(existing || {}), title: v.title.trim(), kind: v.kind, priority: v.priority, date: v.date, status: v.status,
        notes: existing ? t.notes || '' : v.notes, contactId: v.contactId || null, cost: num(v.cost), source: t.source || 'manuel',
        createdAt: t.createdAt || now, history: events,
        decision: reply || t.decision || '',
        doneAt: v.status !== 'todo' ? (t.doneAt || today()) : null,
        answerPending: Boolean(reply) || Boolean(existing && v.status !== t.status) || Boolean(t.answerPending),
      };
      if (v.toExpense && task.cost > 0) {
        const prev = task.expenseId ? byId('expenses', task.expenseId) : null;
        const exp = upsert('expenses', {
          ...(prev || {}), label: task.title, amount: task.cost, date: task.date || today(),
          account: prev?.account || '615000', supplier: prev?.supplier || (task.contactId ? byId('contacts', task.contactId)?.name || '' : ''),
          paidBy: prev?.paidBy || 'banque', notes: prev?.notes || '',
        });
        task.expenseId = exp.id;
      } else if (!v.toExpense && task.expenseId) {
        remove('expenses', task.expenseId);
        task.expenseId = null;
      }
      upsert('tasks', task);
      if (task.answerPending && existing) taskHook?.(`« ${task.title} » : ${reply || `statut ${TASK_STATUS[v.status]}`}`);
      toast(reply ? 'Réponse envoyée à Claude' : existing ? 'Tâche mise à jour' : 'Tâche ajoutée');
    },
    deleteLabel: 'Archiver (ne plus l’afficher)',
    onDelete: existing ? async () => {
      if (!(await ask('Archiver cette tâche ? Elle reste consultable dans l’onglet Archive.', { ok: 'Archiver' }))) return false;
      const now = new Date().toISOString();
      upsert('tasks', { ...existing, status: 'supprimee', doneAt: existing.doneAt || today(), history: [...history, { at: now, by: 'moi', text: 'Archivée à ma demande' }] });
      toast('Tâche archivée');
    } : null,
  });
}
