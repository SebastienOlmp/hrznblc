// Coffre de documents : tout fichier envoyé dans l'appli y est archivé et classé par Claude.
// Contient aussi l'accès direct au classeur Excel maître et l'export complet (ZIP).
import { esc, fmtDate, uid } from './utils.js';
import { db, upsert } from './store.js';
import { uploadFile, toast, saveFile, openSheet, field, ask, empty, attachmentLinks } from './ui.js';
import { requestDocFiling } from './ledger.js';

export const FOLDERS = [
  'Compta/Factures', 'Compta/Banque', 'Compta/Impôts et taxes', 'Compta/Classeur',
  'Juridique/Acquisition', 'Juridique/Copropriété', 'Juridique/Contrats',
  'Administratif/Mairie et taxe de séjour', 'Administratif/Assurances',
  'Conciergerie', 'Voyageurs', 'Travaux et entretien', 'Divers', 'À classer',
];

/**
 * Archive un fichier dans le coffre et demande son classement à Claude.
 * meta : { folder, title, linked: { coll, id }, origin, file: false pour ne pas déclencher le classement }
 * Renvoie la pièce jointe { id, url, name, type, size, at, vaultId } ou null.
 */
export async function archiveFile(file, meta = {}) {
  const a = await uploadFile(file);
  if (!a) return null;
  const vaultId = `v${uid()}`;
  upsert('vault', {
    id: vaultId, assetId: a.id, url: a.url, name: a.name, type: a.type, size: a.size, uploadedAt: a.at,
    folder: meta.folder || 'À classer', title: meta.title || a.name, origin: meta.origin || '',
    linked: meta.linked || null, status: meta.file === false ? 'classe' : 'nouveau', summary: '',
  });
  if (meta.file !== false) requestDocFiling(`${a.name} (envoyé depuis ${meta.origin || 'l’appli'})`);
  return { ...a, vaultId };
}

/** Rattache des pièces déjà archivées à un élément (dépense, tâche…). */
export function linkVault(attachments, linked) {
  for (const att of attachments || []) {
    const v = att.vaultId && db().vault.find((x) => x.id === att.vaultId);
    if (v && (!v.linked || v.linked.id !== linked.id)) upsert('vault', { ...v, linked });
  }
}

/** Bouton « Envoyer un document » à placer dans un écran. */
export const sendDocButton = (origin, folder, label = 'Envoyer un document') => `
  <label class="btn block doc-btn">
    <svg viewBox="0 0 24 24"><path d="M4 7h3l2-3h6l2 3h3v13H4z"/><circle cx="12" cy="13" r="4"/></svg>${esc(label)}
    <input type="file" accept="image/*,application/pdf" multiple data-senddoc="${esc(origin)}" data-folder="${esc(folder)}" hidden>
  </label>`;

/** À appeler après le rendu d'un écran contenant sendDocButton. */
export function bindSendDoc(root) {
  root.querySelectorAll('[data-senddoc]').forEach((inp) => inp.addEventListener('change', async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    toast(`Archivage de ${files.length} document${files.length > 1 ? 's' : ''}…`);
    let n = 0;
    for (const f of files) if (await archiveFile(f, { folder: inp.dataset.folder, origin: inp.dataset.senddoc })) n++;
    if (n) toast(`${n} document${n > 1 ? 's' : ''} archivé${n > 1 ? 's' : ''} : Claude les classe et vous répond dans les tâches`);
  }));
}

// ---------- Classeur Excel maître ----------

async function workbookBytes(version) {
  const ns = await window.claude?.use?.('db');
  if (!ns) throw new Error('indisponible');
  const meta = db().ledger || {};
  const v = (meta.versions || []).find((x) => x.version === (version || meta.currentVersion));
  if (!v) throw new Error('aucune version');
  let b64 = '';
  for (let i = 0; i < v.chunks; i++) {
    const snap = await ns.doc(`ledger/v${v.version}-${i}`).get();
    const d = snap.exists ? snap.data() : null;
    b64 += d?.data || '';
  }
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (v.size && bytes.length !== v.size) throw new Error('fichier incomplet');
  return { bytes, v };
}

export async function downloadWorkbook() {
  toast('Préparation du classeur…');
  try {
    const { bytes, v } = await workbookBytes();
    const date = (v.updatedAt || '').slice(0, 10);
    await saveFile(`Compta_LMNP_HorizonBlanc403_v${v.version}_${date}.xlsx`, new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  } catch (e) {
    toast(`Classeur indisponible (${e.message}). Ouvrez l’appli dans claude.ai.`);
  }
}

// ---------- Export complet ----------

function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = () => resolve(window.JSZip);
    s.onerror = () => reject(new Error('jszip'));
    document.head.appendChild(s);
  });
}

const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);

export async function downloadAll() {
  toast('Préparation de l’archive complète…');
  try {
    const JSZip = await loadJSZip();
    const zip = new JSZip();
    const root = zip.folder('Horizon Blanc 403');
    let missing = 0;
    try {
      const { bytes, v } = await workbookBytes();
      root.folder('Compta').file(`Compta_LMNP_HorizonBlanc403_v${v.version}.xlsx`, bytes);
    } catch { missing++; }
    for (const d of db().vault) {
      try {
        const r = await fetch(d.url);
        if (!r.ok) throw new Error(String(r.status));
        const ext = (d.name.match(/\.[a-z0-9]{2,4}$/i) || [d.type?.includes('pdf') ? '.pdf' : '.jpg'])[0];
        root.folder(d.folder || 'À classer').file(`${safe(d.title || d.name)}${ext}`, await r.blob());
      } catch { missing++; }
    }
    root.file('donnees-appli.json', JSON.stringify(db(), (k, val) => (k === 'chat' || k === 'ledgerSummary' ? undefined : val), 2));
    const blob = await zip.generateAsync({ type: 'blob' });
    await saveFile(`HorizonBlanc403_archive_${new Date().toISOString().slice(0, 10)}.zip`, blob);
    if (missing) toast(`${missing} fichier${missing > 1 ? 's' : ''} n’ont pas pu être ajoutés à l’archive.`);
  } catch {
    toast('Archive impossible pour le moment.');
  }
}

// ---------- Écran Documents ----------

const state = { folder: '', q: '' };
const STATUS = { nouveau: 'Classement en cours', classe: 'Classé', archive: 'Archivé' };

function docSheet(d) {
  openSheet({
    title: d.title || d.name,
    body: `
      <div class="attach-list">${attachmentLinks([d])}</div>
      ${d.summary ? `<div class="note-box claude"><small>Résumé de Claude</small><p>${esc(d.summary).replace(/\n/g, '<br>')}</p></div>` : ''}
      <ul class="kv">
        ${d.issuer ? `<li><span>Émetteur</span><span>${esc(d.issuer)}</span></li>` : ''}
        ${d.docDate ? `<li><span>Date du document</span><span>${fmtDate(d.docDate, { day: 'numeric', month: 'long', year: 'numeric' })}</span></li>` : ''}
        ${d.ref ? `<li><span>Référence</span><span>${esc(d.ref)}</span></li>` : ''}
        <li><span>Envoyé le</span><span>${fmtDate((d.uploadedAt || '').slice(0, 10), { day: 'numeric', month: 'long', year: 'numeric' })}${d.origin ? ` · ${esc(d.origin)}` : ''}</span></li>
        <li><span>État</span><span>${STATUS[d.status] || d.status}</span></li>
      </ul>
      ${field({ name: 'title', label: 'Titre', value: d.title })}
      ${field({ name: 'folder', label: 'Dossier', type: 'select', options: FOLDERS, value: d.folder })}
      ${field({ name: 'notes', label: 'Notes', type: 'textarea', value: d.notes })}
    `,
    onSubmit(v) {
      upsert('vault', { ...d, title: v.title.trim() || d.name, folder: v.folder, notes: v.notes });
      toast('Document mis à jour');
    },
    deleteLabel: 'Archiver (masquer de la liste)',
    onDelete: d.status === 'archive' ? null : async () => {
      if (!(await ask('Masquer ce document ? Il reste dans le coffre (filtre « Archivés ») et dans l’export.', { ok: 'Masquer' }))) return false;
      upsert('vault', { ...d, status: 'archive' });
    },
  });
}

export function renderDocuments(root) {
  const all = db().vault;
  const visible = all.filter((d) => (state.folder === '__archive' ? d.status === 'archive' : d.status !== 'archive'));
  const counts = {};
  visible.forEach((d) => { counts[d.folder] = (counts[d.folder] || 0) + 1; });
  let list = visible.filter((d) => !state.folder || state.folder === '__archive' || d.folder === state.folder);
  if (state.q) list = list.filter((d) => `${d.title} ${d.name} ${d.issuer || ''} ${d.ref || ''} ${d.summary || ''}`.toLowerCase().includes(state.q.toLowerCase()));
  list.sort((a, b) => (b.docDate || b.uploadedAt || '').localeCompare(a.docDate || a.uploadedAt || ''));
  const meta = db().ledger || {};
  const v = (meta.versions || []).find((x) => x.version === meta.currentVersion);

  root.innerHTML = `
    <header class="top"><div><p class="eyebrow">Coffre</p><h1>Documents</h1></div></header>
    ${v ? `<button class="hero-card free" data-act="xlsx">
      <small>Classeur comptable maître</small>
      <strong>Télécharger le fichier Excel</strong>
      <span>Version ${meta.currentVersion} du ${fmtDate(v.updatedAt.slice(0, 10), { day: 'numeric', month: 'long', year: 'numeric' })} · ${meta.lastEntryNo} écritures</span>
    </button>` : ''}
    ${sendDocButton('Documents', 'À classer')}
    <div class="chips">
      <button class="chip ${!state.folder ? 'on' : ''}" data-folder="">Tous (${visible.length})</button>
      ${FOLDERS.filter((f) => counts[f]).map((f) => `<button class="chip ${state.folder === f ? 'on' : ''}" data-folder="${esc(f)}">${esc(f)} (${counts[f]})</button>`).join('')}
      <button class="chip ${state.folder === '__archive' ? 'on' : ''}" data-folder="__archive">Archivés</button>
    </div>
    <input class="search" id="doc-search" type="search" placeholder="Rechercher (émetteur, objet, référence)" value="${esc(state.q)}">
    ${list.length ? `<div class="list">${list.map((d) => `
      <button class="item" data-doc="${d.id}">
        <span class="avatar">${d.type?.startsWith('image/') ? '🖼' : '📄'}</span>
        <span class="item-main"><strong>${esc(d.title || d.name)}</strong><small>${esc(d.folder)}${d.summary ? ` · ${esc(d.summary.slice(0, 80))}${d.summary.length > 80 ? '…' : ''}` : ''}</small></span>
        ${d.status === 'nouveau' ? '<span class="badge option">En cours</span>' : ''}
      </button>`).join('')}</div>` : empty('Aucun document ici. Envoyez une photo ou un PDF : Claude le classe, le résume et crée les tâches utiles.')}
    <div class="card">
      <h3 class="card-title">Tout récupérer</h3>
      <p class="hint">Une archive ZIP avec le classeur Excel, tous les documents rangés par dossier et les données de l’appli. À faire de temps en temps et à garder sur votre téléphone ou votre Drive.</p>
      <button class="btn" data-act="zip">Télécharger l’archive complète</button>
    </div>
  `;
  bindSendDoc(root);
  const search = root.querySelector('#doc-search');
  search.oninput = () => {
    state.q = search.value;
    const pos = search.selectionStart;
    renderDocuments(root);
    const s2 = root.querySelector('#doc-search');
    s2.focus();
    s2.setSelectionRange(pos, pos);
  };
  root.onclick = (e) => {
    const el = e.target.closest('[data-folder],[data-doc],[data-act]');
    if (!el || el.matches('input')) return;
    if (el.dataset.folder !== undefined && !el.dataset.senddoc) { state.folder = el.dataset.folder; renderDocuments(root); }
    else if (el.dataset.doc) docSheet(db().vault.find((d) => d.id === el.dataset.doc));
    else if (el.dataset.act === 'xlsx') downloadWorkbook();
    else if (el.dataset.act === 'zip') downloadAll();
  };
}
