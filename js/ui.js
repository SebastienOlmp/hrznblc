// Composants d'interface : feuille modale, champs de formulaire, toast, partage de fichier.
import { $, esc } from './utils.js';

/**
 * Champ de formulaire.
 * f = { name, label, type, value, options, required, placeholder, hint, attrs }
 * options : tableau de chaînes ou de { value, label }.
 */
export function field(f) {
  const id = `f-${f.name}`;
  const req = f.required ? 'required' : '';
  const ph = f.placeholder ? `placeholder="${esc(f.placeholder)}"` : '';
  const attrs = f.attrs || '';
  const val = f.value ?? '';
  let input;
  switch (f.type) {
    case 'select': {
      const opts = (f.options || []).map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : o.label;
        return `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`;
      }).join('');
      input = `<select id="${id}" name="${f.name}" ${req} ${attrs}>${opts}</select>`;
      break;
    }
    case 'textarea':
      input = `<textarea id="${id}" name="${f.name}" rows="${f.rows || 3}" ${ph} ${req} ${attrs}>${esc(val)}</textarea>`;
      break;
    case 'money':
      input = `<div class="suffix"><input id="${id}" name="${f.name}" type="text" inputmode="decimal" autocomplete="off"
        pattern="[0-9]*[.,]?[0-9]*" value="${esc(val === 0 ? '' : val)}" ${ph} ${req} ${attrs}><span>€</span></div>`;
      break;
    case 'integer':
      input = `<input id="${id}" name="${f.name}" type="text" inputmode="numeric" pattern="[0-9]*" value="${esc(val)}" ${ph} ${req} ${attrs}>`;
      break;
    case 'checkbox':
      return `<label class="check"><input type="checkbox" name="${f.name}" ${val ? 'checked' : ''} ${attrs}><span>${esc(f.label)}</span></label>`;
    default:
      input = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(val)}" ${ph} ${req} ${attrs}>`;
  }
  const hint = f.hint ? `<small class="hint">${esc(f.hint)}</small>` : '';
  return `<div class="field"><label for="${id}">${esc(f.label)}</label>${input}${hint}</div>`;
}

export const row = (...fields) => `<div class="row">${fields.join('')}</div>`;

let onCloseCb = null;

/**
 * Ouvre une feuille modale.
 * opts = { title, body, onSubmit(values, form), onDelete, submitLabel, onMount(dialog) }
 * Si onSubmit renvoie false, la feuille reste ouverte.
 */
export function openSheet({ title, body, onSubmit, onDelete, deleteLabel = 'Supprimer', submitLabel = 'Enregistrer', onMount, onClose }) {
  const dlg = $('#sheet');
  const hasForm = typeof onSubmit === 'function';
  dlg.innerHTML = `
    <form class="sheet-inner" autocomplete="off">
      <header class="sheet-head">
        <button type="button" class="link" data-close>${hasForm ? 'Annuler' : 'Fermer'}</button>
        <h2>${esc(title)}</h2>
        ${hasForm ? `<button type="submit" class="link strong">${esc(submitLabel)}</button>` : '<span></span>'}
      </header>
      <div class="sheet-body">
        ${body}
        ${onDelete ? `<button type="button" class="btn danger block" data-delete>${esc(deleteLabel)}</button>` : ''}
      </div>
    </form>`;
  const form = dlg.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!hasForm) return;
    const values = Object.fromEntries(new FormData(form));
    form.querySelectorAll('input[type=checkbox]').forEach((c) => { values[c.name] = c.checked; });
    if ((await onSubmit(values, form)) !== false && dlg.querySelector('form') === form) closeSheet();
  });
  dlg.querySelector('[data-close]').addEventListener('click', closeSheet);
  dlg.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if ((await onDelete()) !== false && dlg.querySelector('form') === form) closeSheet();
  });
  onCloseCb = onClose || null;
  if (!dlg.open) dlg.showModal();
  dlg.querySelector('.sheet-body').scrollTop = 0;
  onMount?.(dlg);
  return dlg;
}

export function closeSheet() {
  const dlg = $('#sheet');
  if (dlg.open) dlg.close();
}

export function initSheet() {
  const dlg = $('#sheet');
  // Fermer en touchant le fond.
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeSheet(); });
  dlg.addEventListener('close', () => {
    dlg.innerHTML = '';
    const cb = onCloseCb;
    onCloseCb = null;
    cb?.();
  });
}

let toastTimer;
export function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/**
 * Demande une confirmation dans la page (le visualiseur bloque confirm()).
 * Résout true si l'utilisateur valide.
 */
export function ask(message, { ok = 'Confirmer', cancel = 'Annuler', danger = false } = {}) {
  const dlg = $('#ask');
  dlg.innerHTML = `<form method="dialog" class="ask-inner">
      <p>${esc(message).replace(/\n/g, '<br>')}</p>
      <div class="ask-actions">
        <button value="no" class="btn">${esc(cancel)}</button>
        <button value="yes" class="btn ${danger ? 'danger' : 'primary'}">${esc(ok)}</button>
      </div>
    </form>`;
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'yes'), { once: true });
    dlg.returnValue = '';
    dlg.showModal();
  });
}

/** Propose un fichier au téléchargement (capability `downloads`). */
export async function saveFile(filename, content) {
  let dl = null;
  try { dl = await window.claude?.use?.('downloads'); } catch { dl = null; }
  if (!dl) { toast('Téléchargement indisponible dans cette vue.'); return false; }
  try {
    const r = await dl.save({ filename, data: content });
    if (r?.status === 'saved') toast('Fichier enregistré');
    return true;
  } catch (e) {
    if (e?.code !== 'cancelled' && e?.code !== 'declined') toast('Téléchargement refusé ou impossible.');
    return false;
  }
}

/** Copie un texte ; renvoie false si le presse-papiers est refusé. */
export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copié');
    return true;
  } catch {
    toast('Copie refusée : sélectionnez le texte à la main.');
    return false;
  }
}

export const empty = (text, action = '') => `<div class="empty"><p>${esc(text)}</p>${action}</div>`;

let assetsPromise = null;
const getAssets = () => (assetsPromise ||= Promise.resolve(window.claude?.use?.('assets')).catch(() => null));

/** Archive un fichier (photo, PDF) dans l'espace de l'appli. Renvoie { id, url, name, type, size, at } ou null. */
export async function uploadFile(file) {
  const assets = await getAssets();
  if (!assets) { toast('Archivage des fichiers indisponible dans cette vue.'); return null; }
  try {
    const r = await assets.upload(file);
    return { id: r.id, url: r.url, name: file.name || 'piece', type: r.contentType || file.type, size: r.sizeBytes, at: new Date().toISOString() };
  } catch (e) {
    toast(e?.code === 'too_large' ? 'Fichier trop lourd (20 Mo maximum).' : e?.code === 'unsupported_type' ? 'Type de fichier non accepté (photo ou PDF).' : 'Archivage impossible pour le moment.');
    return null;
  }
}

/** Liens vers des pièces jointes archivées. */
export const attachmentLinks = (list = []) => list.map((a) => `<a class="attach" href="${esc(a.url)}" target="_blank" rel="noopener">${a.type?.startsWith('image/') ? '🖼' : '📄'} ${esc(a.name)}</a>`).join('');
