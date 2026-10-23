// Stockage local (sur le téléphone uniquement) + calculs métier.
// Aucune donnée personnelle n'est codée en dur : tout se saisit dans l'appli
// ou s'importe depuis un fichier de sauvegarde JSON.
import { uid, nightsBetween, toUTC, fromUTC, isValidDate, today, addDays } from './utils.js';

const KEY = 'hb403:data';
const SCHEMA = 2;

/** Canaux de vente. `account` = compte de liaison du plan comptable, `collectsTax` = la plateforme collecte la taxe de séjour. */
export const CHANNELS = [
  { name: 'Airbnb', account: '467100', collectsTax: true },
  { name: 'Booking', account: '467200', collectsTax: true },
  { name: 'Chalet-Montagne', account: '467300', collectsTax: false },
  { name: 'Leboncoin', account: '467400', collectsTax: false },
  { name: 'Gens de Confiance', account: '467400', collectsTax: false },
  { name: 'Site conciergerie', account: '411000', collectsTax: false },
  { name: 'Direct', account: '411000', collectsTax: false },
];
export const channel = (name) => CHANNELS.find((c) => c.name === name) || CHANNELS[CHANNELS.length - 1];
export const channelSlug = (name) => String(name || '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');

export const STATUSES = { confirmee: 'Confirmée', option: 'Option', annulee: 'Annulée' };
export const CLEANING = {
  retouche: 'Retouche (payée par moi)',
  complet_locataire: 'Ménage complet payé par le locataire',
  complet_proprio: 'Ménage complet payé par moi',
};
export const WELCOME = { eco: 'Accueil ECO (point de RDV)', logement: 'Accueil au logement (supplément client)' };
export const DEPOSIT = { na: 'Sans objet', demandee: 'Demandée', recue: 'Reçue', restituee: 'Restituée', retenue: 'Retenue' };

/** Comptes de charges / immobilisations proposés pour les dépenses (plan comptable du classeur). */
export const EXPENSE_ACCOUNTS = [
  ['606100', 'Électricité'], ['606300', 'Petit équipement et petit outillage'], ['606400', 'Fournitures administratives'],
  ['606800', 'Linge, produits d’entretien et consommables'], ['613200', 'Abonnements logiciels et services en ligne'],
  ['614000', 'Charges de copropriété (LOGEVAC)'], ['615000', 'Entretien et réparations'], ['616000', 'Assurance PNO'],
  ['616100', 'Extensions de garantie et contrats de service'], ['616600', 'Assurance emprunteur'],
  ['622600', 'Honoraires (comptable, juridique)'], ['622700', 'Frais d’actes'], ['622800', 'Commissions des plateformes'],
  ['622900', 'Prestations de conciergerie'], ['623000', 'Annonces et commercialisation'], ['625100', 'Déplacements et carburant'],
  ['626000', 'Frais postaux et télécommunications'], ['627000', 'Services bancaires'], ['635100', 'Taxe foncière'],
  ['635200', 'CFE'], ['661100', 'Intérêts de l’emprunt'],
  ['213400', 'Immobilisation : agencements intérieurs'], ['218410', 'Immobilisation : électroménager et audiovisuel'],
  ['218420', 'Immobilisation : meubles de cuisine'], ['218430', 'Immobilisation : lits, sièges, tables, rangements'],
  ['218440', 'Immobilisation : luminaires, linge, vaisselle, décoration'], ['275000', 'Avance au syndicat (fonds de travaux, roulement)'],
];
export const accountLabel = (code) => EXPENSE_ACCOUNTS.find(([c]) => c === code)?.[1] || code;

export const CONTACT_KINDS = { voyageur: 'Voyageur', prestataire: 'Prestataire', autre: 'Autre' };

const defaultChecklists = () => [
  {
    id: uid(), name: 'Avant l’arrivée',
    items: ['Retouche / ménage fait par la conciergerie', 'Lits faits', 'Consommables (papier, savon, café…)',
      'Convecteurs réglés', 'Boîte à clés de secours vérifiée', 'Livret d’accueil et code Wi-Fi en place',
      'Caution 140 € reçue (si pas de ménage complet)', 'Virement intégral reçu (canal direct)']
      .map((text) => ({ id: uid(), text, done: false })),
  },
  {
    id: uid(), name: 'Après le départ',
    items: ['Clés récupérées', 'Tour des pièces : dégâts éventuels', 'Inventaire vaisselle', 'Casier à skis vidé',
      'Fenêtres fermées', 'Convecteurs en hors-gel', 'Caution restituée ou retenue', 'Avis laissé au voyageur']
      .map((text) => ({ id: uid(), text, done: false })),
  },
];

const defaultSettings = () => ({
  name: 'HORIZON BLANC 403',
  address: '',
  declaloc: '',
  capacity: 6,
  infos: '',
  // Taxe de séjour (meublé non classé : taux proportionnel, plafonné) — à renseigner d'après la délibération de la commune.
  taxRate: '', // % du coût HT de la nuitée par personne
  taxCap: '', // plafond € par nuit et par personne
  taxExtra: '', // taxe additionnelle départementale en %
  // Conciergerie (montants réellement payés par séjour)
  welcomeEco: 46.5,
  touchUp: 45,
  fullCleanOwner: 70,
  fullCleanGuest: 79.9,
  deposit: 140,
  winterStart: '12-01',
  winterEnd: '04-30',
  winterMin: 6,
  bookingMarkup: 18, // % ajouté à la grille pour Booking
  // Boîtes mail suivies par la tâche planifiée (tri, comptabilisation, archivage)
  mailboxes: [], // [{ address, role, linked: false }]
  // Emprunt (échéancier capital / intérêts)
  loanAmount: '', loanRate: '', loanMonths: '', loanStart: '', loanInsurance: '',
  lastBackup: null,
});

const empty = () => ({
  schema: SCHEMA,
  settings: defaultSettings(),
  property: { sections: [] }, // fiche du bien : [{ title, body }]
  reservations: [],
  expenses: [],
  contacts: [],
  tasks: [],
  deadlines: [],
  checklists: defaultChecklists(),
  documents: [],
  inbox: [], // éléments détectés dans les mails par la tâche planifiée, à valider
  bank: [], // lignes de relevé importées
  pricing: [], // grille tarifaire : une ligne par semaine
  vault: [], // coffre de documents : une fiche par fichier archivé (privé)
  famille: [], // dette personnelle envers Régine, hors comptabilité (privé)
  chat: [], // fil de discussion Compta (messages, pièces jointes)
  ledgerSummary: {}, // chiffres extraits du classeur : soldes, mois, lignes du journal
  ledger: {}, // état du classeur Excel maître (lecture seule, tenu par Claude)
  market: {}, // veille marché écrite par la tâche planifiée : { updatedAt, summary, comparables: [] }
  taxLog: {}, // { '2026-12': true (déclaration mensuelle faite), 'R2026-3': true (reversement fait) }
});

export const COLLECTIONS = ['reservations', 'expenses', 'contacts', 'tasks', 'deadlines', 'checklists', 'documents', 'inbox', 'bank', 'pricing', 'vault', 'famille'];
const CONFIG_DOCS = { settings: 'config/settings', property: 'config/property', taxLog: 'config/taxlog', market: 'config/market', ledger: 'ledger/meta', ledgerSummary: 'ledger/summary', ledgerRequest: 'ledger/request' };

function normalize(raw) {
  const base = empty();
  if (!raw || typeof raw !== 'object') return base;
  const out = { ...base, ...raw, settings: { ...base.settings, ...(raw.settings || {}) } };
  for (const k of COLLECTIONS) if (!Array.isArray(out[k])) out[k] = base[k];
  if (!out.taxLog || typeof out.taxLog !== 'object') out.taxLog = {};
  if (!out.property || !Array.isArray(out.property.sections)) out.property = { sections: [] };
  out.schema = SCHEMA;
  return out;
}

// ---------- Persistance ----------
// Dans claude.ai : base partagée de l'artifact (capability `db`), mise à jour en direct.
// Ailleurs (aperçu, fichier local) : localStorage de ce navigateur.

let data = empty();
let cloud = null; // namespace db quand disponible
let ready = false;
const listeners = new Set();
let notifyQueued = false;
const chains = {}; // une écriture à la fois par document

export const db = () => data;
export const settings = () => data.settings;
export const onChange = (fn) => listeners.add(fn);
export const isCloud = () => Boolean(cloud);
export const isReady = () => ready;

function notify() {
  if (notifyQueued) return;
  notifyQueued = true;
  requestAnimationFrame(() => { notifyQueued = false; listeners.forEach((fn) => fn()); });
}

const clean = (v) => JSON.parse(JSON.stringify(v));

function loadLocal() {
  try {
    const txt = localStorage.getItem(KEY);
    data = txt ? normalize(JSON.parse(txt)) : empty();
  } catch {
    data = empty();
  }
}

function saveLocal() {
  if (cloud) return;
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* stockage indisponible : données en mémoire seulement */ }
}

let onError = (msg) => console.error(msg);
export const setErrorHandler = (fn) => { onError = fn; };

function persist(path, op) {
  if (!cloud) { saveLocal(); return; }
  chains[path] = (chains[path] || Promise.resolve())
    .then(op)
    .catch((e) => onError(e?.code === 'quota_exceeded' ? 'Base pleine : supprimez d’anciens éléments.'
      : e?.code === 'invalid_argument' ? 'Enregistrement refusé : vous n’avez pas les droits d’écriture.'
        : 'Enregistrement impossible pour le moment, réessayez.'));
}

/** Démarre la synchronisation. Appelle `onFirstData` dès que les données sont là. */
export async function connect(onFirstData) {
  let ns = null;
  try { ns = await window.claude?.use?.('db'); } catch { ns = null; }
  if (!ns) {
    loadLocal();
    ready = true;
    onFirstData();
    notify();
    return;
  }
  cloud = ns;
  const pending = new Set([...COLLECTIONS, ...Object.keys(CONFIG_DOCS)]);
  const loaded = (k) => {
    if (!pending.delete(k) || pending.size) return;
    ready = true;
    onFirstData();
  };
  for (const c of COLLECTIONS) {
    ns.collection(c).onSnapshot(
      (snap) => { data[c] = snap.docs.map((d) => ({ ...d.data(), id: d.id })); loaded(c); notify(); },
      () => { loaded(c); onError('Synchronisation interrompue : rechargez la page.'); },
    );
  }
  // Fil de discussion Compta (privé : zone ledger)
  ns.collection('ledger/chat/messages').onSnapshot(
    (snap) => { data.chat = snap.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => (a.at || '').localeCompare(b.at || '')); notify(); },
    () => {},
  );
  for (const [k, path] of Object.entries(CONFIG_DOCS)) {
    ns.doc(path).onSnapshot(
      (snap) => {
        const v = snap.exists ? snap.data() : {};
        if (k === 'settings') data.settings = { ...defaultSettings(), ...v };
        else if (k === 'property') data.property = { sections: Array.isArray(v.sections) ? v.sections : [] };
        else if (k === 'market') data.market = { ...v };
        else if (k === 'ledger') data.ledger = { ...v };
        else if (k === 'ledgerSummary') data.ledgerSummary = { ...v };
        else if (k === 'ledgerRequest') data.ledgerRequest = { ...v };
        else data.taxLog = { ...v };
        loaded(k);
        notify();
      },
      () => loaded(k),
    );
  }
}

// Saisies qui touchent la comptabilité : signalées pour le report au classeur maître.
const ACCOUNTING = { expenses: 'dépense', reservations: 'réservation', bank: 'ligne de banque' };
let accountingHook = null;
export const setAccountingHook = (fn) => { accountingHook = fn; };
const describe = (coll, item, verb) => `${ACCOUNTING[coll]} « ${item.label || item.guestName || item.id} » ${verb}`;

export function upsert(coll, item) {
  if (!item.id) item.id = uid();
  const list = data[coll];
  const i = list.findIndex((x) => x.id === item.id);
  if (ACCOUNTING[coll] && accountingHook && !(coll === 'bank' && !item.match && (i < 0 || !list[i].match))) {
    accountingHook(describe(coll, item, i >= 0 ? 'modifiée' : 'ajoutée'));
  }
  if (i >= 0) list[i] = item;
  else list.push(item);
  notify();
  const body = clean(item);
  persist(`${coll}/${item.id}`, () => cloud.collection(coll).doc(item.id).set(body));
  return item;
}

export function remove(coll, id) {
  const gone = data[coll].find((x) => x.id === id);
  if (gone && ACCOUNTING[coll] && accountingHook) accountingHook(describe(coll, gone, `supprimée${gone.ledgerEntry ? ` (déjà au classeur, écriture n° ${gone.ledgerEntry} : contre-passation à proposer)` : ''}`));
  data[coll] = data[coll].filter((x) => x.id !== id);
  notify();
  persist(`${coll}/${id}`, () => cloud.collection(coll).doc(id).delete());
}

export const byId = (coll, id) => data[coll].find((x) => x.id === id);

/** Ajoute ou met à jour un message du fil Compta. */
export function saveChatMessage(msg) {
  if (!msg.id) msg.id = uid();
  const list = data.chat || (data.chat = []);
  const i = list.findIndex((x) => x.id === msg.id);
  if (i >= 0) list[i] = msg; else list.push(msg);
  notify();
  const body = clean(msg);
  persist(`ledger/chat/messages/${msg.id}`, () => cloud.collection('ledger/chat/messages').doc(msg.id).set(body));
  return msg;
}

export function updateSettings(patch) {
  data.settings = { ...data.settings, ...patch };
  notify();
  const body = clean(data.settings);
  persist(CONFIG_DOCS.settings, () => cloud.doc(CONFIG_DOCS.settings).set(body));
}

export function setProperty(sections) {
  data.property = { sections };
  notify();
  const body = clean(data.property);
  persist(CONFIG_DOCS.property, () => cloud.doc(CONFIG_DOCS.property).set(body));
}

export const toggleTaxLog = (key) => setTaxLog({ ...data.taxLog, [key]: !data.taxLog[key] });

function setTaxLog(log) {
  data.taxLog = log;
  notify();
  const body = clean(data.taxLog);
  persist(CONFIG_DOCS.taxLog, () => cloud.doc(CONFIG_DOCS.taxLog).set(body));
}

// ---------- Sauvegarde ----------

export function exportJSON() {
  return JSON.stringify({ app: 'horizon-blanc-403', exportedAt: new Date().toISOString(), data }, null, 2);
}

/** Ajoute ou remplace les éléments du fichier (même identifiant = remplacé). */
export function importJSON(text) {
  const parsed = JSON.parse(text);
  const incoming = parsed && parsed.app === 'horizon-blanc-403' ? parsed.data : parsed;
  if (!incoming || typeof incoming !== 'object' || !COLLECTIONS.some((k) => Array.isArray(incoming[k]))) {
    throw new Error('Fichier non reconnu');
  }
  const n = normalize(incoming);
  for (const c of COLLECTIONS) for (const item of incoming[c] || []) upsert(c, { ...item });
  if (incoming.settings) updateSettings(n.settings);
  if (incoming.property) setProperty(n.property.sections);
  if (incoming.taxLog) setTaxLog(n.taxLog);
}

// ---------- Réservations ----------

export const isActive = (r) => r.status !== 'annulee';
export const resNights = (r) => (isValidDate(r.start) && isValidDate(r.end) ? Math.max(0, nightsBetween(r.start, r.end)) : 0);
/** Ce que je touche pour le séjour : prix hôte moins commission. */
export const resNet = (r) => (Number(r.hostPrice) || 0) - (Number(r.commission) || 0);
/** Coût conciergerie à ma charge pour un séjour, selon les tarifs des réglages. */
export function conciergeCost(r, s = data.settings) {
  const welcome = Number(s.welcomeEco) || 0; // l'accueil ECO est toujours payé ; le supplément « au logement » est refacturé
  const cleaning = r.cleaning === 'complet_proprio' ? Number(s.fullCleanOwner) || 0
    : r.cleaning === 'complet_locataire' ? 0 : Number(s.touchUp) || 0;
  return welcome + cleaning;
}
const costOf = (r) => (r.conciergeCost === '' || r.conciergeCost == null ? conciergeCost(r) : Number(r.conciergeCost) || 0);
/** Marge du séjour après commission et conciergerie. */
export const resMargin = (r) => resNet(r) - costOf(r);
export const resConcierge = costOf;
export const taxByMe = (r) => r.taxBy ? r.taxBy === 'moi' : !channel(r.platform).collectsTax;

/**
 * Taxe de séjour d'un meublé non classé : taux % × (prix HT de la nuitée / nb d'occupants),
 * plafonné, × adultes × nuits, + taxe additionnelle. Renvoie null si le taux n'est pas renseigné.
 */
export function computeTax({ hostPrice, adults, children, start, end }, s = data.settings) {
  const rate = Number(String(s.taxRate).replace(',', '.'));
  if (!rate) return null;
  const n = isValidDate(start) && isValidDate(end) ? nightsBetween(start, end) : 0;
  const a = Number(adults) || 0;
  const occupants = a + (Number(children) || 0);
  if (n <= 0 || !a || !occupants) return 0;
  const perPersonNight = (Number(hostPrice) || 0) / n / occupants;
  const cap = Number(String(s.taxCap).replace(',', '.')) || Infinity;
  const perAdultNight = Math.min((rate / 100) * perPersonNight, cap);
  const extra = Number(String(s.taxExtra).replace(',', '.')) || 0;
  return Math.round(perAdultNight * a * n * (1 + extra / 100) * 100) / 100;
}

export const sortedReservations = () =>
  [...data.reservations].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

/** Réservations actives qui chevauchent [start, end[ (hors celle d'id `exceptId`). */
export function overlaps(start, end, exceptId) {
  return data.reservations.filter((r) => r.id !== exceptId && isActive(r) && r.start < end && start < r.end);
}

export function currentStay(d = today()) {
  return data.reservations.find((r) => isActive(r) && r.start <= d && d < r.end);
}

export function upcoming(d = today(), n = 5) {
  return sortedReservations().filter((r) => isActive(r) && r.start > d).slice(0, n);
}

/** Itère sur les nuits d'une réservation : fn(dateISO). */
export function eachNight(r, fn) {
  for (let t = toUTC(r.start); t < toUTC(r.end); t += 864e5) fn(fromUTC(t));
}

/**
 * Statistiques d'une année, réparties nuit par nuit (prorata) sur les mois.
 * Par mois : nuits louées, prix hôte, commission, net, conciergerie, taxe collectée par moi / par plateforme,
 * nuitées taxables (adultes × nuits), dépenses (hors immobilisations).
 */
export function yearStats(year) {
  const blank = () => ({ nights: 0, host: 0, commission: 0, net: 0, concierge: 0, taxMe: 0, taxPlatform: 0, adultNightsMe: 0, adultNightsPlatform: 0, expenses: 0 });
  const months = Array.from({ length: 12 }, blank);
  const yStart = `${year}-01-01`;
  const yEnd = `${year + 1}-01-01`;
  for (const r of data.reservations) {
    const n = resNights(r);
    if (!isActive(r) || !n || r.end <= yStart || r.start >= yEnd) continue;
    const me = taxByMe(r);
    const tax = Number(r.touristTax) || 0;
    const adults = Number(r.adults) || 0;
    const per = {
      host: (Number(r.hostPrice) || 0) / n, commission: (Number(r.commission) || 0) / n,
      concierge: costOf(r) / n, tax: tax / n,
    };
    eachNight(r, (d) => {
      if (d < yStart || d >= yEnd) return;
      const m = months[Number(d.slice(5, 7)) - 1];
      m.nights += 1;
      m.host += per.host;
      m.commission += per.commission;
      m.net += per.host - per.commission;
      m.concierge += per.concierge;
      if (me) { m.taxMe += per.tax; m.adultNightsMe += adults; } else { m.taxPlatform += per.tax; m.adultNightsPlatform += adults; }
    });
  }
  for (const e of data.expenses) {
    if (!isValidDate(e.date) || Number(e.date.slice(0, 4)) !== year || String(e.account).startsWith('2')) continue;
    months[Number(e.date.slice(5, 7)) - 1].expenses += Number(e.amount) || 0;
  }
  const totals = Object.fromEntries(Object.keys(blank()).map((k) => [k, months.reduce((s, m) => s + m[k], 0)]));
  totals.result = totals.net - totals.expenses;
  totals.occupancy = totals.nights / nightsBetween(yStart, yEnd);
  totals.adr = totals.nights ? totals.host / totals.nights : 0;
  return { months, totals };
}

export function yearsWithData() {
  const ys = new Set([new Date().getFullYear()]);
  data.reservations.forEach((r) => { if (r.start) ys.add(Number(r.start.slice(0, 4))); if (r.end) ys.add(Number(r.end.slice(0, 4))); });
  data.expenses.forEach((e) => { if (e.date) ys.add(Number(e.date.slice(0, 4))); });
  return [...ys].filter(Boolean).sort((a, b) => b - a);
}

/** Saison d'hiver qui commence l'année `y` (ex. 2026 → 01/12/2026 – 30/04/2027 avec les réglages par défaut). */
export function winterSeason(y, s = data.settings) {
  const start = `${y}-${s.winterStart || '12-01'}`;
  let end = `${y}-${s.winterEnd || '04-30'}`;
  if (end <= start) end = `${y + 1}-${s.winterEnd || '04-30'}`;
  return { start, end: addDays(end, 1) }; // fin exclusive
}

// ---------- Contacts ----------

export function findContactByName(name) {
  const n = String(name || '').trim().toLowerCase();
  return n ? data.contacts.find((c) => c.name.trim().toLowerCase() === n) : undefined;
}

export const sortedContacts = () => [...data.contacts].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
