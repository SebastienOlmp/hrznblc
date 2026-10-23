#!/usr/bin/env python3
"""Ajoute des écritures au classeur comptable maître sans toucher aux écritures existantes.

Respecte les conventions du classeur :
- les montants sont saisis dans l'onglet Paramètres (une ligne par montant) ;
- le Journal y fait référence par formule, et les colonnes calculées sont recopiées depuis la ligne 5 ;
- chaque pièce est inscrite dans l'onglet Factures (numérotation continue).

Puis recalcule avec LibreOffice et vérifie les contrôles : écart du Journal nul, colonne Contrôle à 0,
aucun « COMPTE INCONNU ». En cas d'échec, rien n'est écrit dans le fichier de sortie.

Usage : python3 ledger_sync.py ENTREE.xlsx OPERATIONS.json SORTIE.xlsx

OPERATIONS.json : liste d'objets
  {
    "source": "expenses/abc123",              # identifiant côté appli (traçabilité)
    "journal": "AC" | "BQ" | "VE" | "OD",
    "date": "AAAA-MM-JJ",                     # date de la pièce
    "bank_date": "AAAA-MM-JJ" | null,         # date banque (BQ)
    "piece": "026" | null,                    # null = numéro suivant
    "ref": "ENEDIS 123",                      # référence fournisseur / relevé
    "lines": [["606100", "Électricité novembre", 45.2, 0], ["512100", "Prélèvement", 0, 45.2]],
    "invoice": {"issuer": "...", "object": "...", "ref": "..."} | null,
    "param_section": "NOVEMBRE 2026"          # titre de section dans Paramètres
  }
Affiche un JSON de résultat (premier/dernier n° d'écriture, pièces, contrôles).
"""
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from copy import copy

import openpyxl
from openpyxl.formula.translate import Translator

FIRST, LAST = 5, 1004  # zone de saisie du Journal
F_FIRST, F_LAST = 9, 208  # zone de saisie de l'onglet Factures


def last_row(ws, col, start, stop):
    r = start - 1
    for i in range(start, stop + 1):
        if ws.cell(i, col).value not in (None, ''):
            r = i
    return r


def copy_style(src, dst):
    if src.has_style:
        dst.font, dst.border, dst.fill = copy(src.font), copy(src.border), copy(src.fill)
        dst.number_format, dst.alignment, dst.protection = src.number_format, copy(src.alignment), copy(src.protection)


def d(s):
    return dt.datetime.strptime(s, '%Y-%m-%d') if s else None


def slug(s):
    s = re.sub(r'[^A-Za-z0-9ÀÂÄÉÈÊËÎÏÔÖÙÛÜÇàâäéèêëîïôöùûüç &\-]', ' ', s or '').upper()
    return re.sub(r'\s+', ' ', s).strip()[:40]


def recalc(path):
    out = tempfile.mkdtemp()
    subprocess.run(['soffice', '--headless', '--calc', '--convert-to', 'xlsx', '--outdir', out, path],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=240)
    return os.path.join(out, os.path.basename(path))


def main(src, ops_path, dst):
    ops = json.load(open(ops_path, encoding='utf-8'))
    wb = openpyxl.load_workbook(src)
    P, J, F, C = wb['Paramètres'], wb['Journal'], wb['Factures'], wb['Comptes']
    accounts = {str(r[0]) for r in C.iter_rows(min_row=5, values_only=True) if r[0]}

    jrow = last_row(J, 1, FIRST, LAST)
    nums = [J.cell(r, 1).value for r in range(FIRST, jrow + 1) if isinstance(J.cell(r, 1).value, (int, float))]
    entry = int(max(nums)) if nums else 0
    frow = last_row(F, 1, F_FIRST, F_LAST)
    pieces = [str(F.cell(r, 1).value) for r in range(F_FIRST, frow + 1) if re.fullmatch(r'\d{3}', str(F.cell(r, 1).value or ''))]
    piece = max(int(p) for p in pieces) if pieces else 0
    prow = P.max_row
    while prow > 1 and all(P.cell(prow, c).value in (None, '') for c in range(1, 5)):
        prow -= 1

    tpl = 5  # ligne modèle du Journal
    done, sections = [], set()
    for op in ops:
        lines = [l for l in op['lines'] if (l[2] or 0) or (l[3] or 0)]
        deb = round(sum(l[2] or 0 for l in lines), 2)
        cre = round(sum(l[3] or 0 for l in lines), 2)
        if deb != cre:
            raise SystemExit(f"Écriture déséquilibrée ({op.get('source')}) : {deb} ≠ {cre}")
        for l in lines:
            if str(l[0]) not in accounts:
                raise SystemExit(f"Compte inconnu du plan comptable : {l[0]} ({op.get('source')})")
        if jrow + len(lines) > LAST:
            raise SystemExit('Zone de saisie du Journal pleine (ligne 1004).')

        entry += 1
        pc = op.get('piece') or f'{piece + 1:03d}'
        if not op.get('piece'):
            piece += 1
        sec = op.get('param_section') or 'MOUVEMENTS REPRIS DE L’APPLI'
        if sec not in sections:
            prow += 2
            P.cell(prow, 2, sec)
            copy_style(P.cell(5, 2), P.cell(prow, 2))
            sections.add(sec)

        for acc, label, debit, credit in lines:
            prow += 1
            P.cell(prow, 2, f'{label} (écr. {entry})')
            P.cell(prow, 3, round(debit or credit, 2))
            P.cell(prow, 4, f"Pièce {pc} · {op.get('ref', '')} · source appli {op.get('source', '')}".strip())
            copy_style(P.cell(6, 3), P.cell(prow, 3))
            P.cell(prow, 3).number_format = '#,##0.00 €'
            jrow += 1
            vals = {1: entry, 2: op['journal'], 3: d(op['date']), 4: d(op.get('bank_date')), 5: pc,
                    6: op.get('ref', ''), 7: str(acc), 9: label}
            for col in range(1, 17):
                cell = J.cell(jrow, col)
                copy_style(J.cell(tpl + 1, col), cell)
                if col in vals:
                    cell.value = vals[col]
                elif col in (10, 11):
                    amt = debit if col == 10 else credit
                    cell.value = f'=Paramètres!$C${prow}' if amt else None
                else:
                    f = J.cell(tpl, col).value
                    cell.value = Translator(f, origin=J.cell(tpl, col).coordinate).translate_formula(cell.coordinate) \
                        if isinstance(f, str) and f.startswith('=') else None
            J.cell(jrow, 3).number_format = J.cell(tpl, 3).number_format or 'DD/MM/YYYY'
            J.cell(jrow, 4).number_format = J.cell(tpl, 3).number_format or 'DD/MM/YYYY'

        inv = op.get('invoice')
        if inv and not op.get('piece'):
            frow += 1
            if frow > F_LAST:
                raise SystemExit('Zone de l’onglet Factures pleine (ligne 208).')
            obj = inv.get('object') or lines[0][1]
            date = d(op['date'])
            row = [pc, date, inv.get('issuer', ''), obj, deb, inv.get('ref', op.get('ref', '')), entry,
                   f"{pc} - {date:%m.%y} {slug(obj)}.pdf"]
            for col, v in enumerate(row, 1):
                copy_style(F.cell(frow - 1, col), F.cell(frow, col))
                F.cell(frow, col, v)
        done.append({'source': op.get('source'), 'entry': entry, 'piece': pc})

    tmp = tempfile.mkdtemp()
    out = os.path.join(tmp, os.path.basename(dst))
    wb.save(out)
    calc = recalc(out)
    v = openpyxl.load_workbook(calc, data_only=True)
    j = v['Journal']
    gap = j['J1007'].value
    bad = [r for r in range(FIRST, LAST + 1) if j.cell(r, 16).value not in (None, '', 0)]
    unknown = [r for r in range(FIRST, LAST + 1) if j.cell(r, 8).value == 'COMPTE INCONNU']
    result = {'entries': done, 'journalGap': gap, 'entriesInError': bad, 'unknownAccounts': unknown,
              'bankBalanceAll': j['J1012'].value, 'due467600': j['J1020'].value}
    b = v['Balance']
    for r in range(1, b.max_row + 1):
        if b.cell(r, 2).value == "RÉSULTAT DE L'EXERCICE":
            result['result'] = b.cell(r, 4).value
    ok = gap == 0 and not bad and not unknown
    result['ok'] = ok
    if ok:
        shutil.copy(calc, dst)
    print(json.dumps(result, ensure_ascii=False, default=str))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main(*sys.argv[1:4])
