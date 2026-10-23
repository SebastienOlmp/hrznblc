// Onglet TO DO : décisions à trancher, actions, entretien ; check-lists d'arrivée / départ.
import { esc, uid, today, fmtDate, plural } from '../utils.js';
import { db, upsert, remove, byId } from '../store.js';
import { taskForm, TASK_KINDS, TASK_STATUS } from './forms.js';
import { openSheet, field, toast, ask, empty } from '../ui.js';

const state = { tab: 'afaire' };
const PRIO_ORDER = { haute: 0, normale: 1, basse: 2 };

export const openTasks = () => db().tasks.filter((t) => !t.status || t.status === 'todo');

function sortTasks(list) {
  return [...list].sort((a, b) =>
    (a.kind === 'decision' ? 0 : 1) - (b.kind === 'decision' ? 0 : 1)
    || (PRIO_ORDER[a.priority] ?? 1) - (PRIO_ORDER[b.priority] ?? 1)
    || (a.date || '9999').localeCompare(b.date || '9999'));
}

function taskRow(t, d) {
  const late = t.status !== 'done' && t.date && t.date < d;
  return `
    <div class="item task ${t.status && t.status !== 'todo' ? 'is-done' : ''}">
      <button class="tick" data-tick="${t.id}" aria-label="${t.status && t.status !== 'todo' ? 'Rouvrir' : 'Marquer fait'}">${t.status === 'done' ? '✓' : t.status && t.status !== 'todo' ? '–' : ''}</button>
      <button class="item-main as-btn" data-task="${t.id}">
        <strong>${esc(t.title)}</strong>
        <small>${esc(TASK_KINDS[t.kind] || 'Action')}${t.date ? ` · ${fmtDate(t.date, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}${late ? ' · <b class="neg">en retard</b>' : ''}${t.source === 'mail' ? ' · depuis un mail' : ''}${t.answerPending ? ' · <b>réponse envoyée à Claude</b>' : t.claudeReply ? ' · Claude a répondu' : ''}</small>
      </button>
      ${t.status && t.status !== 'todo' ? `<span class="badge ${t.status === 'done' ? '' : 'option'}">${TASK_STATUS[t.status] || t.status}</span>` : t.priority === 'haute' ? '<span class="badge annulee">Haute</span>' : ''}
    </div>`;
}

export function renderTodo(root) {
  const d = today();
  const { tab } = state;
  const open = sortTasks(openTasks());
  const done = db().tasks.filter((t) => t.status && t.status !== 'todo').sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
  const decisions = open.filter((t) => t.kind === 'decision');
  const others = open.filter((t) => t.kind !== 'decision');

  let body;
  if (tab === 'afaire') {
    body = `
      ${decisions.length ? `<h2 class="section-title">Décisions à trancher</h2><div class="list">${decisions.map((t) => taskRow(t, d)).join('')}</div>` : ''}
      <h2 class="section-title">À faire</h2>
      ${others.length ? `<div class="list">${others.map((t) => taskRow(t, d)).join('')}</div>` : empty('Rien à faire pour l’instant.')}`;
  } else if (tab === 'archive') {
    body = done.length ? `<p class="hint">Toutes les tâches faites, non retenues ou archivées, avec leur historique. Touchez-en une pour la relire ou la rouvrir.</p><div class="list">${done.map((t) => taskRow(t, d)).join('')}</div>` : empty('Aucune tâche archivée.');
  } else {
    body = `
      ${db().checklists.map((cl) => {
        const n = cl.items.filter((i) => i.done).length;
        return `<div class="card checklist">
          <div class="card-head"><h3 class="card-title">${esc(cl.name)}</h3><span class="muted">${n}/${cl.items.length}</span></div>
          <ul>${cl.items.map((it) => `<li><label class="check"><input type="checkbox" data-cl="${cl.id}" data-item="${it.id}" ${it.done ? 'checked' : ''}><span>${esc(it.text)}</span></label></li>`).join('')}</ul>
          <div class="btn-row"><button class="btn small" data-reset="${cl.id}">Tout décocher</button><button class="btn small" data-edit-cl="${cl.id}">Modifier</button></div>
        </div>`;
      }).join('') || empty('Aucune check-list.')}
      <button class="btn block" data-act="new-cl">+ Nouvelle check-list</button>`;
  }

  root.innerHTML = `
    <header class="top">
      <div><p class="eyebrow">To do</p><h1>${plural(open.length, 'tâche ouverte', 'tâches ouvertes')}</h1></div>
      <button class="btn primary" data-act="new">+ Tâche</button>
    </header>
    <div class="segmented">
      ${[['afaire', `À faire (${open.length})`], ['archive', `Archive (${done.length})`], ['listes', 'Check-lists']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}
    </div>
    ${body}
  `;

  root.onclick = async (e) => {
    const el = e.target.closest('[data-tab],[data-task],[data-tick],[data-act],[data-reset],[data-edit-cl]');
    if (!el) return;
    if (el.dataset.tab) { state.tab = el.dataset.tab; renderTodo(root); }
    else if (el.dataset.task) taskForm(byId('tasks', el.dataset.task));
    else if (el.dataset.tick) {
      const t = byId('tasks', el.dataset.tick);
      const doneNow = !t.status || t.status === 'todo';
      const history = [...(t.history || []), { at: new Date().toISOString(), by: 'moi', text: doneNow ? 'Marquée faite' : 'Rouverte' }];
      upsert('tasks', { ...t, status: doneNow ? 'done' : 'todo', doneAt: doneNow ? today() : null, history });
      toast(doneNow ? 'Fait, archivée' : 'Rouverte');
    } else if (el.dataset.act === 'new') taskForm(null);
    else if (el.dataset.act === 'new-cl') checklistForm(null);
    else if (el.dataset.editCl) checklistForm(byId('checklists', el.dataset.editCl));
    else if (el.dataset.reset) {
      const cl = byId('checklists', el.dataset.reset);
      upsert('checklists', { ...cl, items: cl.items.map((i) => ({ ...i, done: false })) });
    }
  };
  root.onchange = (e) => {
    const c = e.target.closest('[data-cl]');
    if (!c) return;
    const cl = byId('checklists', c.dataset.cl);
    upsert('checklists', { ...cl, items: cl.items.map((i) => (i.id === c.dataset.item ? { ...i, done: c.checked } : i)) });
  };
}

function checklistForm(existing) {
  const cl = existing || { name: '', items: [] };
  openSheet({
    title: existing ? 'Modifier la check-list' : 'Nouvelle check-list',
    body: `
      ${field({ name: 'name', label: 'Nom', value: cl.name, required: true })}
      ${field({ name: 'items', label: 'Points à vérifier (un par ligne)', type: 'textarea', rows: 10, value: cl.items.map((i) => i.text).join('\n') })}
    `,
    onSubmit(v) {
      const prev = new Map(cl.items.map((i) => [i.text, i]));
      const items = v.items.split('\n').map((s) => s.trim()).filter(Boolean)
        .map((text) => prev.get(text) || { id: uid(), text, done: false });
      upsert('checklists', { ...(existing || {}), name: v.name.trim(), items });
      toast('Check-list enregistrée');
    },
    onDelete: existing ? async () => {
      if (!(await ask('Supprimer cette check-list ?', { ok: 'Supprimer', danger: true }))) return false;
      remove('checklists', existing.id);
    } : null,
  });
}
