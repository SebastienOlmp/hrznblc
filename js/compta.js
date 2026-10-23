// Génération d'écritures comptables (partie double) au format du journal du classeur Excel :
// N° écriture · Journal · Date pièce · Date banque · N° justificatif · Référence fournisseur · Compte · Libellé · Débit · Crédit.
// L'appli ne tient pas la comptabilité : elle prépare les écritures de ventes, d'achats et de PCA
// à coller dans le classeur, qui reste la référence (banque, emprunt, amortissements).
import { fmtDate, nightsBetween } from './utils.js';
import { db, channel, isActive, resNights, taxByMe, accountLabel } from './store.js';

const round2 = (n) => Math.round(n * 100) / 100;
const guest = (r) => (r.guestId && db().contacts.find((c) => c.id === r.guestId)?.name) || r.guestName || 'Voyageur';

/** Part du prix hôte correspondant aux nuits après le 31/12 de `year` (produit constaté d'avance). */
function pcaPart(r, year) {
  const n = resNights(r);
  const after = nightsBetween(`${year + 1}-01-01`, r.end);
  return n && after > 0 ? round2(((Number(r.hostPrice) || 0) * after) / n) : 0;
}

export function journalEntries(year) {
  const y = String(year);
  const ops = []; // { journal, date, piece, ref, lines: [[compte, libellé, débit, crédit]] }

  for (const r of db().reservations) {
    if (!isActive(r) || !r.start?.startsWith(y)) continue;
    const ch = channel(r.platform);
    const host = round2(Number(r.hostPrice) || 0);
    const com = round2(Number(r.commission) || 0);
    const tax = taxByMe(r) ? round2(Number(r.touristTax) || 0) : 0;
    const lib = `Séjour ${guest(r)} ${fmtDate(r.start)}-${fmtDate(r.end)} ${r.platform}`;
    ops.push({
      journal: 'VE', date: r.start, piece: '', ref: r.ref || '',
      lines: [
        [ch.account, lib, round2(host - com + tax), 0],
        ['622800', `Commission ${r.platform} ${guest(r)}`, com, 0],
        ['706000', lib, 0, host],
        ['447000', `Taxe de séjour ${guest(r)}`, 0, tax],
      ],
    });
    const pca = pcaPart(r, year);
    if (pca) {
      ops.push({
        journal: 'OD', date: `${y}-12-31`, piece: '', ref: r.ref || '',
        lines: [['706000', `PCA ${lib}`, pca, 0], ['487000', `PCA ${lib}`, 0, pca]],
      });
    }
  }

  // Extourne au 1er janvier des PCA constatés au 31/12 de l'année précédente.
  for (const r of db().reservations) {
    if (!isActive(r) || !r.start?.startsWith(String(year - 1))) continue;
    const pca = pcaPart(r, year - 1);
    if (!pca) continue;
    const lib = `Extourne PCA séjour ${guest(r)} ${fmtDate(r.start)}-${fmtDate(r.end)}`;
    ops.push({ journal: 'OD', date: `${y}-01-01`, piece: '', ref: r.ref || '', lines: [['487000', lib, pca, 0], ['706000', lib, 0, pca]] });
  }

  for (const e of db().expenses) {
    if (!e.date?.startsWith(y)) continue;
    const amt = round2(Number(e.amount) || 0);
    const credit = e.paidBy === 'regine' ? '467600' : e.paidBy === 'exploitant' ? '108000' : String(e.account).startsWith('2') ? '404000' : '401000';
    ops.push({
      journal: 'AC', date: e.date, piece: e.piece || '', ref: e.supplier || '',
      lines: [[e.account, e.label, amt, 0], [credit, e.label, 0, amt]],
    });
  }

  ops.sort((a, b) => a.date.localeCompare(b.date) || a.journal.localeCompare(b.journal));
  const rows = [];
  ops.forEach((op, i) => {
    const no = `APP${y}-${String(i + 1).padStart(4, '0')}`;
    for (const [account, label, debit, credit] of op.lines) {
      if (!debit && !credit) continue;
      rows.push({ no, journal: op.journal, date: op.date, piece: op.piece, ref: op.ref, account, accountLabel: accountName(account), label, debit, credit });
    }
  });
  return rows;
}

const ACCOUNT_NAMES = {
  '401000': 'Fournisseurs', '404000': 'Fournisseurs d’immobilisations', '411000': 'Clients locations directes',
  '447000': 'Taxe de séjour à reverser', '467100': 'Airbnb liaison', '467200': 'Booking liaison',
  '467300': 'Chalet-Montagne liaison', '467400': 'Leboncoin/GdC liaison', '467600': 'Régine Fichera — avances', '108000': 'Compte de l’exploitant',
  '487000': 'Produits constatés d’avance', '622800': 'Commissions plateformes', '706000': 'Locations meublées',
};
const accountName = (code) => ACCOUNT_NAMES[code] || accountLabel(code);

const frDate = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
const n2 = (v) => (v ? v.toFixed(2).replace('.', ',') : '');
const cell = (v) => {
  const s = String(v ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function journalCSV(year) {
  const rows = journalEntries(year);
  const head = ['N° écriture', 'Journal', 'Date pièce', 'Date banque', 'N° justificatif', 'Référence fournisseur', 'Compte', 'Intitulé compte', 'Libellé', 'Débit', 'Crédit'];
  const lines = rows.map((r) => [r.no, r.journal, frDate(r.date), '', r.piece, r.ref, r.account, r.accountLabel, r.label, n2(r.debit), n2(r.credit)]);
  // BOM + point-virgule : ouverture directe dans Excel en français.
  return { csv: '﻿' + [head, ...lines].map((l) => l.map(cell).join(';')).join('\r\n'), rows };
}
