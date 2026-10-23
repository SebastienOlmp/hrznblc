// Petits utilitaires partagés : échappement HTML, montants, dates.
// Les dates sont stockées en chaînes "AAAA-MM-JJ" et calculées en UTC
// pour éviter les décalages liés aux changements d'heure.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const EUR0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
export const money = (n) => EUR.format(Number(n) || 0);
export const money0 = (n) => EUR0.format(Math.round(Number(n) || 0));
export const pct = (n) => `${Math.round((Number(n) || 0) * 100)} %`;

/** Convertit une saisie ("12,50", "12.5", "") en nombre. */
export const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export const toUTC = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
export const fromUTC = (t) => {
  const d = new Date(t);
  return iso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
export const today = () => {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth(), d.getDate());
};
export const addDays = (s, n) => fromUTC(toUTC(s) + n * 864e5);
export const nightsBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 864e5);
export const isValidDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

export const fmtDate = (s, opts = { day: 'numeric', month: 'short' }) =>
  isValidDate(s) ? new Date(toUTC(s)).toLocaleDateString('fr-FR', { ...opts, timeZone: 'UTC' }) : '';
export const fmtLong = (s) => fmtDate(s, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

export const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
