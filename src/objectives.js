/**
 * A battle's objectives as a list, in the goal panel, a briefing or an end page. Each objective is
 * { text, meta?, state, items? }: `state` is 'done' (✓), 'now' (▸, the one to work on), 'fail' (✗),
 * 'rule' (•, a condition that holds all along) or '' (still to come); `meta` a count or a clock
 * after it; `items` the objectives it is made of.
 */
import { escapeHtml } from './state.js';

/** The list's <li>s. */
export function objectivesHtml(list) {
  const li = (o) => `<li class="${o.state ?? ''}">${escapeHtml(o.text)}${o.meta ? ` <span class="meta">${escapeHtml(o.meta)}</span>` : ''}${o.items?.length ? `<ul>${o.items.map(li).join('')}</ul>` : ''}</li>`;
  return list.map(li).join('');
}

/** The list in the goal panel (redrawn only when it has changed); `next`, whether the line under it
 * is the next step (it is then headed "Next:"). */
export function showObjectives(list, next = true) {
  const el = document.getElementById('goalList'), html = objectivesHtml(list);
  if (!el) return;
  if (el.dataset.html !== html) {
    el.dataset.html = html;
    el.innerHTML = html;
  }
  el.hidden = !list.length;
  document.getElementById('goal')?.classList.toggle('listed', list.length > 0 && next);
}
