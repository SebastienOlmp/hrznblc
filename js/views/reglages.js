// Réglages : bien, boîtes mail liées, taxe de séjour, conciergerie, tarification, emprunt, sauvegarde.
import { esc, num } from '../utils.js';
import { settings, updateSettings, exportJSON, importJSON, isCloud } from '../store.js';
import { field, row, toast, saveFile, ask, openSheet } from '../ui.js';

const MAIL_ROLES = { plateformes: 'Comptes plateformes (Airbnb, Booking…)', conciergerie: 'Conciergerie, syndic, fournisseurs', tout: 'Tout' };

function section(id, title, inner, note = '') {
  return `<form class="card settings-form" data-form="${id}">
    <h3 class="card-title">${esc(title)}</h3>
    ${inner}
    ${note ? `<p class="hint">${note}</p>` : ''}
    <button class="btn primary" type="submit">Enregistrer</button>
  </form>`;
}

function mailboxes(s) {
  const list = s.mailboxes || [];
  return `<div class="card">
    <h3 class="card-title">Boîtes mail liées</h3>
    <p class="hint">Chaque jour, une tâche Claude lit les nouveaux mails de ces adresses : elle repère les mails clients, la conciergerie et les factures (électricité, internet, syndic…), propose les écritures dans Compta › À valider, crée une tâche pour chaque décision à trancher et archive les mails traités.</p>
    ${list.length ? `<div class="list">${list.map((m, i) => `
      <div class="item static">
        <button class="item-main as-btn" data-mail-edit="${i}"><strong>${esc(m.address)}</strong><small>${esc(MAIL_ROLES[m.role] || MAIL_ROLES.tout)}</small></button>
        <span class="item-side"><span class="badge ${m.linked ? '' : 'option'}">${m.linked ? 'Liée' : 'À connecter'}</span><button class="btn small" data-mail-del="${i}">Retirer</button></span>
      </div>`).join('')}</div>` : '<p class="muted">Aucune adresse liée.</p>'}
    <button class="btn block" data-act="add-mail">+ Lier une adresse e-mail</button>
    <details class="howto"><summary>Comment connecter une adresse</summary>
      <ol>
        <li>Dans claude.ai, ouvrez Paramètres › Connecteurs et connectez Gmail avec le compte de cette adresse.</li>
        <li>Si un seul compte Gmail peut être connecté, créez dans l’autre boîte un transfert automatique (Gmail › Paramètres › Transfert) vers l’adresse connectée : les deux boîtes seront traitées.</li>
        <li>Revenez ici et marquez l’adresse comme liée. La tâche quotidienne ne traite que les adresses marquées « Liée ».</li>
      </ol>
    </details>
  </div>`;
}

function mailForm(existing, index) {
  const s = settings();
  const m = existing || { address: '', role: 'tout', linked: false };
  openSheet({
    title: existing ? 'Adresse liée' : 'Lier une adresse e-mail',
    body: `
      ${field({ name: 'address', label: 'Adresse', type: 'email', value: m.address, required: true })}
      ${field({ name: 'role', label: 'Ce qu’elle reçoit', type: 'select', options: Object.entries(MAIL_ROLES).map(([value, label]) => ({ value, label })), value: m.role })}
      ${field({ name: 'linked', label: 'Gmail connecté dans claude.ai (ou transfert en place)', type: 'checkbox', value: m.linked })}
    `,
    onSubmit(v) {
      const list = [...(s.mailboxes || [])];
      const item = { address: v.address.trim().toLowerCase(), role: v.role, linked: v.linked };
      if (list.some((x, i) => x.address === item.address && i !== index)) { toast('Adresse déjà liée.'); return false; }
      if (index === undefined) list.push(item); else list[index] = item;
      updateSettings({ mailboxes: list });
      toast('Adresse enregistrée');
    },
  });
}

export function renderReglages(root) {
  const s = settings();
  root.innerHTML = `
    <header class="top"><div><p class="eyebrow">Réglages</p><h1>${esc(s.name)}</h1></div></header>

    ${mailboxes(s)}

    ${section('bien', 'Le bien', `
      ${field({ name: 'name', label: 'Nom', value: s.name, required: true })}
      ${row(field({ name: 'declaloc', label: 'N° DéclaLoc', value: s.declaloc }), field({ name: 'capacity', label: 'Capacité max', type: 'integer', value: s.capacity }))}
    `)}

    ${section('taxe', 'Taxe de séjour (meublé non classé)', `
      ${row(field({ name: 'taxRate', label: 'Taux (%)', type: 'money', value: s.taxRate }), field({ name: 'taxCap', label: 'Plafond € / nuit / pers.', type: 'money', value: s.taxCap }))}
      ${field({ name: 'taxExtra', label: 'Taxe additionnelle départementale (%)', type: 'money', value: s.taxExtra })}
    `, 'À reprendre de la délibération du Dévoluy (portail devoluy.taxesejour.fr ou Maison des Propriétaires). Calcul : taux × prix de la nuitée ÷ nombre d’occupants, plafonné, × adultes × nuits, + taxe additionnelle.')}

    ${section('concierge', 'Conciergerie', `
      ${row(field({ name: 'welcomeEco', label: 'Accueil ECO', type: 'money', value: s.welcomeEco }), field({ name: 'touchUp', label: 'Retouche', type: 'money', value: s.touchUp }))}
      ${row(field({ name: 'fullCleanOwner', label: 'Ménage complet (moi)', type: 'money', value: s.fullCleanOwner }), field({ name: 'fullCleanGuest', label: 'Ménage complet (locataire)', type: 'money', value: s.fullCleanGuest }))}
      ${row(field({ name: 'deposit', label: 'Caution ménage', type: 'money', value: s.deposit }), field({ name: 'winterMin', label: 'Minimum locations hiver', type: 'integer', value: s.winterMin }))}
      ${row(field({ name: 'winterStart', label: 'Début hiver (MM-JJ)', value: s.winterStart, attrs: 'pattern="\\d{2}-\\d{2}"' }), field({ name: 'winterEnd', label: 'Fin hiver (MM-JJ)', value: s.winterEnd, attrs: 'pattern="\\d{2}-\\d{2}"' }))}
    `, 'Montants réellement payés par séjour. Le tarif ménage n’est pas confirmé par écrit et la grille manque dans votre exemplaire du contrat.')}

    ${section('resa', 'Réservations confirmées : mail à la conciergerie', `
      ${field({ name: 'autoMailOn', label: 'Préparer automatiquement le mail en brouillon', type: 'checkbox', value: s.autoMailOn })}
      ${field({ name: 'autoMailFrom', label: 'Boîte où créer le brouillon', type: 'email', value: s.autoMailFrom })}
      ${field({ name: 'autoMailTo', label: 'Destinataire', value: s.autoMailTo })}
      ${field({ name: 'autoMailCc', label: 'Copie (séparées par des virgules)', value: s.autoMailCc })}
      ${field({ name: 'autoMailTemplate', label: 'Modèle du mail', type: 'textarea', rows: 14, value: s.autoMailTemplate })}
    `, 'Repères remplacés automatiquement : {arrivee}, {depart}, {voyageurs}, {canal}, {menage}, {nom}. Le mail n’est jamais envoyé : il est créé en brouillon et vous recevez une notification pour le valider.')}

    ${section('ical', 'Calendriers des annonces (iCal)', `
      ${field({ name: 'icalAirbnb', label: 'Airbnb : lien d’export du calendrier', type: 'url', value: s.icalAirbnb, placeholder: 'https://www.airbnb.fr/calendar/ical/….ics' })}
      ${field({ name: 'icalBooking', label: 'Booking : lien d’export du calendrier', type: 'url', value: s.icalBooking })}
      ${field({ name: 'icalChalet', label: 'Chalet-Montagne : lien d’export du calendrier', type: 'url', value: s.icalChalet })}
    `, 'Ces liens permettent à Claude de repérer les nouvelles réservations même sans mail. Ils ne fonctionnent qu’une fois ces sites autorisés dans le réseau de l’environnement Claude (voir les explications de Claude).')}

    ${section('prix', 'Tarification', field({ name: 'bookingMarkup', label: 'Majoration Booking (%)', type: 'money', value: s.bookingMarkup }))}

    ${section('emprunt', 'Emprunt', `
      ${row(field({ name: 'loanAmount', label: 'Capital emprunté', type: 'money', value: s.loanAmount }), field({ name: 'loanRate', label: 'Taux nominal (%)', type: 'money', value: s.loanRate }))}
      ${row(field({ name: 'loanMonths', label: 'Durée (mois)', type: 'integer', value: s.loanMonths }), field({ name: 'loanStart', label: '1re échéance', type: 'date', value: s.loanStart }))}
      ${field({ name: 'loanInsurance', label: 'Assurance emprunteur / mois', type: 'money', value: s.loanInsurance })}
    `)}

    <div class="card">
      <h3 class="card-title">Sauvegarde</h3>
      <p class="hint">${isCloud() ? 'Les données sont enregistrées en ligne dans votre espace claude.ai.' : 'Les données sont enregistrées dans ce navigateur uniquement.'} Une copie JSON régulière reste prudente.</p>
      <div class="btn-row wrap">
        <button class="btn" data-act="export">Télécharger une sauvegarde</button>
        <label class="btn file-btn">Restaurer un fichier<input type="file" id="restore" accept="application/json,.json" hidden></label>
      </div>
    </div>
  `;

  root.onsubmit = (e) => {
    e.preventDefault();
    const form = e.target.closest('[data-form]');
    const v = Object.fromEntries(new FormData(form));
    form.querySelectorAll('input[type=checkbox]').forEach((c) => { v[c.name] = c.checked; });
    const money = ['welcomeEco', 'touchUp', 'fullCleanOwner', 'fullCleanGuest', 'deposit', 'bookingMarkup', 'loanAmount', 'loanInsurance'];
    for (const k of Object.keys(v)) if (money.includes(k) || k === 'capacity' || k === 'winterMin' || k === 'loanMonths') v[k] = v[k] === '' ? '' : num(v[k]);
    updateSettings(v);
    toast('Réglages enregistrés');
  };
  root.onclick = async (e) => {
    const el = e.target.closest('[data-act],[data-mail-del],[data-mail-edit]');
    if (!el) return;
    if (el.dataset.act === 'add-mail') mailForm(null);
    else if (el.dataset.mailEdit !== undefined) mailForm(settings().mailboxes[Number(el.dataset.mailEdit)], Number(el.dataset.mailEdit));
    else if (el.dataset.mailDel !== undefined) {
      const list = [...(settings().mailboxes || [])];
      const i = Number(el.dataset.mailDel);
      if (!(await ask(`Ne plus suivre ${list[i].address} ?`, { ok: 'Retirer', danger: true }))) return;
      list.splice(i, 1);
      updateSettings({ mailboxes: list });
    } else if (el.dataset.act === 'export') {
      if (await saveFile(`horizon-blanc-403_sauvegarde_${new Date().toISOString().slice(0, 10)}.json`, exportJSON())) updateSettings({ lastBackup: new Date().toISOString() });
    }
  };
  root.querySelector('#restore').onchange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!(await ask('Restaurer ce fichier ? Les éléments de même identifiant seront remplacés.', { ok: 'Restaurer' }))) return;
    try { importJSON(await f.text()); toast('Sauvegarde restaurée'); } catch { toast('Fichier non reconnu.'); }
  };
}

