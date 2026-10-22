'use strict';

/* ============================================================
   Web Gallery — いいなと思ったWebとパーツのコレクション
   データは data/library.json（server.py 経由で読み書き）。
   追加したサイトはサーバーが自動で撮影し、パーツ分けは tools/parts.py で登録する。
   ============================================================ */

const FAV = '__fav__';
// 公開用に書き出したページ（tools/publish.py）は閲覧専用で、data/library.json を直接読む
const READ_ONLY = document.querySelector('meta[name="wg-mode"]')?.content === 'viewer';
const IMAGE_MAX_WIDTH = 1600;
const IMAGE_MAX_HEIGHT = 12000;
const POLL_MS = 4000;

/* ---------- API ---------- */

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ---------- DOM helpers ---------- */

const $ = (sel) => document.querySelector(sel);
const kids = (...c) => c.flat(Infinity).filter((x) => x != null && x !== false);

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...kids(children));
  return el;
}

const svg = (body, size = 16) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICONS = {
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  external: svg('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
  star: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="m12 2.8 2.83 5.74 6.33.92-4.58 4.47 1.08 6.3L12 17.25l-5.66 2.98 1.08-6.3L2.84 9.46l6.33-.92z"/></svg>',
  close: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 18),
  prev: svg('<path d="m15 18-6-6 6-6"/>', 18),
  next: svg('<path d="m9 18 6-6-6-6"/>', 18),
  camera: svg('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>'),
  expand: svg('<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>', 14),
  locate: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
};

function icon(name) {
  const el = h('span', { class: 'icon', 'aria-hidden': 'true' });
  el.innerHTML = ICONS[name];
  return el;
}

/* ---------- utils ---------- */

function normalizeUrl(input) {
  let s = String(input ?? '').trim();
  if (!s) return null;
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null;
    return u.href;
  } catch {
    return null;
  }
}

const urlKey = (url) => url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '').toLowerCase();

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

const displayTitle = (site) => site.title || hostOf(site.url);
const parseTags = (s) => [...new Set(s.split(/[,、，\n]+/).map((t) => t.trim().replace(/^#/, '')).filter(Boolean))];
const asset = (path, v) => (path ? `${path}?v=${v ?? ''}` : null);
const searchTerms = () => state.query.toLowerCase().split(/\s+/).filter(Boolean);
const matches = (terms, fields) => {
  const hay = fields.join('\n').toLowerCase();
  return terms.every((t) => hay.includes(t));
};

function hashHue(str) {
  let x = 0;
  for (const c of str) x = (x * 31 + c.codePointAt(0)) >>> 0;
  return x % 360;
}

/* ---------- state ---------- */

const state = {
  categories: [],
  sites: [],
  view: 'sites',
  query: '',
  tag: null,
  cat: null,
  sort: 'new',
  detailId: null,
  partId: null,
  lpMode: 'lp',
};
let catMap = new Map();
let editingId = null;
let draftImage = null;
let draftImageChanged = false;
const cardCache = new Map();
const partCache = new Map();

const els = {
  grid: $('#grid'),
  partsGrid: $('#parts-grid'),
  empty: $('#empty'),
  noResult: $('#no-result'),
  toolbar: $('#toolbar'),
  chips: $('#chips'),
  count: $('#count'),
  countSites: $('#count-sites'),
  countParts: $('#count-parts'),
  sort: $('#sort'),
  search: $('#search'),
  editDialog: $('#edit-dialog'),
  form: $('#edit-form'),
  editHeading: $('#edit-heading'),
  fUrl: $('#f-url'),
  fTitle: $('#f-title'),
  fTags: $('#f-tags'),
  fMemo: $('#f-memo'),
  urlHint: $('#url-hint'),
  tagSuggest: $('#tag-suggest'),
  thumbPreview: $('#thumb-preview'),
  thumbHint: $('#thumb-hint'),
  fileInput: $('#file-input'),
  deleteBtn: $('#delete-btn'),
  detailDialog: $('#detail-dialog'),
  detail: $('#detail'),
  partDialog: $('#part-dialog'),
  partDetail: $('#part-detail'),
  helpDialog: $('#help-dialog'),
  bookmarklet: $('#bookmarklet'),
  toast: $('#toast'),
};

function setLibrary(lib) {
  state.categories = lib.categories ?? [];
  state.sites = lib.sites ?? [];
  catMap = new Map(state.categories.map((c) => [c.id, c]));
}

const findSite = (id) => state.sites.find((s) => s.id === id);
const catName = (id) => catMap.get(id)?.name ?? id;

function allParts() {
  return state.sites.flatMap((site) => (site.parts ?? []).map((p, order) => ({ ...p, site, order })));
}

/* ---------- thumbnails ---------- */

function placeholder(site) {
  const host = hostOf(site.url);
  return h('div', { class: 'ph' },
    h('span', { class: 'ph-initial' }, ([...displayTitle(site)][0] ?? '?').toUpperCase()),
    h('span', { class: 'ph-host' }, host));
}

function siteThumbSrc(site) {
  if (site.thumb === 'upload' && site.image) return asset(site.image, site.updatedAt);
  if (site.thumb !== 'none' && site.capture?.thumb) return asset(site.capture.thumb, site.capture.capturedAt);
  return null;
}

function siteThumb(site) {
  const wrap = h('div', { class: 'thumb', style: `--hue:${hashHue(hostOf(site.url))}` }, placeholder(site));
  const src = siteThumbSrc(site);
  if (src) {
    const img = h('img', { alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('load', () => wrap.classList.add('is-loaded'));
    img.addEventListener('error', () => img.remove());
    img.src = src;
    wrap.append(img);
  }
  return wrap;
}

function statusBadge(site) {
  if (READ_ONLY) return site.parts?.length ? h('span', { class: 'badge' }, `パーツ ${site.parts.length}${site.pages?.length ? `・${site.pages.length + 1}画面` : ''}`) : null;
  if (site.status === 'capturing') return h('span', { class: 'badge is-busy' }, '撮影中…');
  if (site.status === 'error') return h('span', { class: 'badge is-error', title: site.error ?? '' }, '撮影に失敗');
  if (site.status === 'pending') return h('span', { class: 'badge' }, '撮影待ち');
  if (site.parts?.length) return h('span', { class: 'badge' }, `パーツ ${site.parts.length}${site.pages?.length ? `・${site.pages.length + 1}画面` : ''}`);
  if (site.capture) return h('span', { class: 'badge is-todo' }, 'パーツ分け待ち');
  return null;
}

// 縦横比を一覧で見やすい範囲に収める（細長い帯や縦長セクション対策）
function partRatio(rect) {
  return Math.min(2.6, Math.max(1 / 1.7, rect.w / rect.h));
}

function partImage(part, cls) {
  const box = h('div', {
    class: `${cls} ${part.rect.w / part.rect.h > 2.6 ? 'is-wide' : ''}`,
    style: `aspect-ratio:${partRatio(part.rect)}`,
  });
  const img = h('img', { alt: '', loading: 'lazy', decoding: 'async' });
  img.addEventListener('load', () => box.classList.add('is-loaded'));
  img.src = asset(part.file, part.site.updatedAt);
  box.append(img);
  return box;
}

/* ---------- sites view ---------- */

function visibleSites() {
  const terms = searchTerms();
  const list = state.sites.filter((s) => {
    if (state.tag === FAV && !s.favorite) return false;
    if (state.tag && state.tag !== FAV && !s.tags.includes(state.tag)) return false;
    return !terms.length || matches(terms, [s.title, s.url, s.memo, ...s.tags, ...(s.parts ?? []).map((p) => p.label)]);
  });
  const sorters = {
    new: (a, b) => b.createdAt - a.createdAt,
    old: (a, b) => a.createdAt - b.createdAt,
    title: (a, b) => displayTitle(a).localeCompare(displayTitle(b), 'ja'),
  };
  return list.sort(sorters[state.sort] ?? sorters.new);
}

function tagCounts() {
  const counts = new Map();
  for (const s of state.sites) for (const t of s.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'));
}

function chip(label, n, pressed, onclick, title) {
  return h('button', {
    class: `chip ${n === 0 ? 'is-empty' : ''}`,
    type: 'button',
    title,
    'aria-pressed': String(pressed),
    onclick,
  }, label, n != null ? h('span', { class: 'chip-count' }, String(n)) : null);
}

function renderSiteChips() {
  const counts = tagCounts();
  const favCount = state.sites.filter((s) => s.favorite).length;
  if (state.tag === FAV && !favCount) state.tag = null;
  if (state.tag && state.tag !== FAV && !counts.some(([t]) => t === state.tag)) state.tag = null;
  const pick = (v) => () => { state.tag = state.tag === v ? null : v; render(); };
  els.chips.replaceChildren(...kids(
    chip('すべて', state.sites.length, state.tag === null, pick(null)),
    favCount ? chip('★ お気に入り', favCount, state.tag === FAV, pick(FAV)) : null,
    counts.map(([t, n]) => chip(`#${t}`, n, state.tag === t, pick(t))),
  ));
}

function siteCard(site) {
  return h('article', {
    class: 'card is-new',
    onanimationend: (e) => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('is-new'); },
  },
    h('div', { class: 'card-figure' },
      h('button', {
        class: 'card-media',
        type: 'button',
        'aria-label': `${displayTitle(site)} の詳細を見る`,
        onclick: () => showDetail(site.id),
      }, siteThumb(site)),
      h('div', { class: 'card-badges' }, statusBadge(site)),
      READ_ONLY ? null : h('button', {
        class: 'fav',
        type: 'button',
        title: 'お気に入り',
        'aria-label': 'お気に入り',
        'aria-pressed': String(!!site.favorite),
        onclick: () => toggleFav(site.id),
      }, icon('star'))),
    h('div', { class: 'card-body' },
      h('div', { class: 'card-row' },
        h('h3', { class: 'card-title' },
          h('a', { href: site.url, target: '_blank', rel: 'noopener noreferrer', title: site.url }, displayTitle(site))),
        site.title ? h('span', { class: 'card-host' }, hostOf(site.url)) : null,
        READ_ONLY ? null : h('button', { class: 'icon-btn card-edit', type: 'button', title: '編集', 'aria-label': '編集', onclick: () => openEdit(site.id) }, icon('edit'))),
      site.memo ? h('p', { class: 'card-memo' }, site.memo) : null,
      site.tags.length
        ? h('div', { class: 'chips chips-sm' }, site.tags.map((t) =>
            h('button', { class: 'chip', type: 'button', onclick: () => { state.tag = t; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, `#${t}`)))
        : null));
}

// 検索のたびに画像を読み直さないよう、カードは使い回す
function getSiteCard(site) {
  const key = `${site.updatedAt}|${site.status}`;
  let hit = cardCache.get(site.id);
  if (!hit || hit.key !== key) {
    hit = { key, el: siteCard(site) };
    cardCache.set(site.id, hit);
  }
  hit.el.querySelector('.fav')?.setAttribute('aria-pressed', String(!!site.favorite));
  return hit.el;
}

/* ---------- parts view ---------- */

function partMatches(p, terms) {
  return matches(terms, [p.label, p.note, catName(p.category), ...(p.also ?? []).map(catName),
    displayTitle(p.site), p.site.url, ...p.site.tags]);
}

function visibleParts() {
  const terms = searchTerms();
  const order = new Map(state.categories.map((c, i) => [c.id, i]));
  return allParts()
    .filter((p) => !state.cat || p.category === state.cat || (p.also ?? []).includes(state.cat))
    .filter((p) => !terms.length || partMatches(p, terms))
    .sort((a, b) => (state.cat ? 0 : (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99))
      || b.site.createdAt - a.site.createdAt || a.order - b.order);
}

function renderPartChips() {
  const parts = allParts();
  const counts = new Map();
  for (const p of parts) for (const c of new Set([p.category, ...(p.also ?? [])])) counts.set(c, (counts.get(c) ?? 0) + 1);
  if (state.cat && !catMap.has(state.cat)) state.cat = null;
  const pick = (v) => () => { state.cat = state.cat === v ? null : v; render(); };
  const group = (g, label) => {
    const cats = state.categories.filter((c) => c.group === g);
    return cats.length ? [
      h('span', { class: 'chip-group' }, label),
      cats.map((c) => chip(c.name, counts.get(c.id) ?? 0, state.cat === c.id, pick(c.id), c.desc)),
    ] : [];
  };
  els.chips.replaceChildren(...kids(
    chip('すべて', parts.length, state.cat === null, pick(null)),
    group('section', 'セクション'),
    group('ui', 'UIパーツ'),
  ));
}

function partCard(part) {
  return h('article', { class: 'part-card' },
    h('button', {
      class: 'part-media-btn',
      type: 'button',
      'aria-label': `${part.label || catName(part.category)} を大きく見る`,
      onclick: () => showPart(part.id),
    }, partImage(part, 'part-media')),
    h('div', { class: 'part-body' },
      h('span', { class: 'part-cat' }, catName(part.category)),
      h('h3', { class: 'part-label' }, part.label || catName(part.category)),
      h('button', { class: 'part-site', type: 'button', onclick: () => showDetail(part.site.id, { focus: part.id }) },
        displayTitle(part.site))));
}

function getPartCard(part) {
  const key = part.site.updatedAt;
  let hit = partCache.get(part.id);
  if (!hit || hit.key !== key) {
    hit = { key, el: partCard(part) };
    partCache.set(part.id, hit);
  }
  return hit.el;
}

/* ---------- render ---------- */

function render() {
  const isParts = state.view === 'parts';
  const total = state.sites.length;
  const partTotal = allParts().length;

  els.toolbar.hidden = total === 0;
  els.empty.hidden = total > 0;
  els.countSites.textContent = String(total);
  els.countParts.textContent = String(partTotal);
  els.sort.hidden = isParts;
  document.querySelectorAll('.view-switch [data-view]').forEach((b) =>
    b.setAttribute('aria-selected', String(b.dataset.view === state.view)));

  els.grid.hidden = isParts;
  els.partsGrid.hidden = !isParts;

  let shown;
  if (isParts) {
    renderPartChips();
    const list = visibleParts();
    els.partsGrid.replaceChildren(...list.map(getPartCard));
    els.count.textContent = list.length === partTotal ? `${partTotal} 件` : `${list.length} / ${partTotal} 件`;
    shown = list.length;
  } else {
    renderSiteChips();
    const list = visibleSites();
    const cards = list.map(getSiteCard);
    cards.forEach((el, i) => { if (el.classList.contains('is-new')) el.style.animationDelay = `${Math.min(i, 12) * 35}ms`; });
    els.grid.replaceChildren(...cards);
    els.count.textContent = list.length === total ? `${total} 件` : `${list.length} / ${total} 件`;
    shown = list.length;
  }

  els.noResult.hidden = total === 0 || shown > 0;
  els.noResult.textContent = isParts && partTotal === 0
    ? (READ_ONLY ? 'まだパーツがありません' : 'まだパーツがありません。Claude に「パーツ分けして」と頼むと、撮影した画面を切り分けて登録します。')
    : '条件に合うものはありません';
}

function setView(view) {
  if (state.view === view) return;
  state.view = view;
  try { localStorage.setItem('wg-view', view); } catch {}
  render();
}

/* ---------- actions ---------- */

function replaceSite(site) {
  const i = state.sites.findIndex((s) => s.id === site.id);
  if (i >= 0) state.sites[i] = site;
  else state.sites.unshift(site);
}

async function toggleFav(id) {
  const site = findSite(id);
  if (!site) return;
  try {
    replaceSite(await api('PUT', `api/sites/${encodeURIComponent(id)}`, { favorite: !site.favorite }));
  } catch (err) {
    console.error(err);
    toast('保存できませんでした');
  }
  render();
}

async function removeSite(id) {
  const site = findSite(id);
  if (!site) return;
  try {
    await api('DELETE', `api/sites/${encodeURIComponent(id)}`);
  } catch (err) {
    console.error(err);
    toast('削除できませんでした');
    return;
  }
  state.sites = state.sites.filter((s) => s.id !== id);
  cardCache.delete(id);
  els.editDialog.close();
  render();
  toast(`「${displayTitle(site)}」を削除しました`, {
    label: '元に戻す',
    run: async () => {
      replaceSite(await api('POST', 'api/sites', { restore: site }));
      render();
    },
  });
}

async function recapture(id) {
  try {
    await api('POST', `api/sites/${encodeURIComponent(id)}/capture`);
    await refresh();
    toast('撮影を始めました（30秒〜1分ほどかかります）');
  } catch (err) {
    console.error(err);
    toast('撮影を始められませんでした');
  }
}

/* ---------- site detail（LP全体＋パーツ） ---------- */

function detailBar(list, index, onStep, dialog) {
  const multi = list.length > 1 && index >= 0;
  return h('div', { class: 'detail-bar' },
    multi ? h('button', { class: 'icon-btn', type: 'button', title: '前へ（←）', 'aria-label': '前へ', onclick: () => onStep(-1) }, icon('prev')) : null,
    multi ? h('button', { class: 'icon-btn', type: 'button', title: '次へ（→）', 'aria-label': '次へ', onclick: () => onStep(1) }, icon('next')) : null,
    multi ? h('span', { class: 'detail-pos' }, `${index + 1} / ${list.length}`) : null,
    h('span', { class: 'spacer' }),
    h('button', { class: 'icon-btn', type: 'button', title: '閉じる', 'aria-label': '閉じる', onclick: () => dialog.close() }, icon('close')));
}

function inColumn(rect, lp) {
  return rect.x >= lp.x - 8 && rect.x + rect.w <= lp.x + lp.w + 8;
}

// トップ（page なし）と、遷移先・操作後の別画面（site.pages）
function sitePages(site) {
  return [
    { id: null, label: 'トップ', capture: site.capture, status: site.status, error: site.error },
    ...(site.pages ?? []),
  ];
}
const pageLabel = (site, pid) => (pid ? site.pages?.find((p) => p.id === pid)?.label ?? pid : 'トップ');

function lpView(cap, mode) {
  const isLp = mode === 'lp' && cap.lp;
  const segs = isLp ? cap.lp.segments : cap.segments;
  const refW = isLp ? cap.lp.w : cap.width;
  const offX = isLp ? cap.lp.x : 0;
  const stack = h('div', { class: `lp-stack ${isLp ? 'is-column' : ''}` },
    segs.map((s) => h('img', {
      src: asset(s.file, cap.capturedAt),
      alt: '',
      loading: 'lazy',
      decoding: 'async',
      style: `aspect-ratio:${refW}/${s.h}`,
    })));
  return { stack, refW, offX };
}

function focusPartInLp(scroller, view, rect) {
  const scale = view.stack.clientWidth / view.refW;
  view.stack.querySelector('.lp-hl')?.remove();
  view.stack.append(h('div', {
    class: 'lp-hl',
    style: `left:${(rect.x - view.offX) * scale}px;top:${rect.y * scale}px;width:${rect.w * scale}px;height:${rect.h * scale}px`,
  }));
  scroller.scrollTo({ top: Math.max(0, rect.y * scale - 56), behavior: 'smooth' });
}

function showDetail(id, { focus } = {}) {
  const site = findSite(id);
  if (!site) return;
  state.detailId = id;
  if (els.partDialog.open) els.partDialog.close();

  const list = visibleSites();
  const index = list.findIndex((s) => s.id === id);
  const pages = sitePages(site);
  const hasPages = pages.length > 1;
  const parts = (site.parts ?? []).map((p, order) => ({ ...p, site, order }));
  const focusPart = parts.find((p) => p.id === focus);

  const scroller = h('div', { class: 'detail-media lp-scroll' });
  let view = null;
  let currentFocus = focusPart;
  let pageId = null;
  let cap = null;
  let mode = 'full';
  const pickPage = (pid) => {
    pageId = pid;
    cap = pages.find((p) => p.id === pid)?.capture ?? null;
    mode = cap?.lp ? state.lpMode : 'full';
  };
  pickPage(focusPart?.page ?? null);
  if (focusPart && cap?.lp && !inColumn(focusPart.rect, cap.lp)) mode = 'full';

  const markCurrent = () => els.detail.querySelectorAll('.dpart').forEach((b) =>
    b.classList.toggle('is-current', b.dataset.id === currentFocus?.id));
  const refocus = () => {
    if (view && currentFocus && (currentFocus.page ?? null) === pageId) {
      requestAnimationFrame(() => focusPartInLp(scroller, view, currentFocus.rect));
    }
  };

  const drawMedia = () => {
    const pg = pages.find((p) => p.id === pageId);
    const bar = h('div', { class: 'lp-toolbar' },
      hasPages ? h('div', { class: 'lp-pages segmented' }, pages.map((p) => h('label', {},
        h('input', {
          type: 'radio',
          name: 'lp-page',
          checked: p.id === pageId,
          onchange: () => { pickPage(p.id); drawMedia(); scroller.scrollTop = 0; refocus(); },
        }),
        h('span', {}, p.label)))) : null,
      cap?.lp ? h('div', { class: 'lp-switch segmented' }, ['lp', 'full'].map((m) => h('label', {},
        h('input', {
          type: 'radio',
          name: 'lp-mode',
          checked: mode === m,
          onchange: () => { mode = m; state.lpMode = m; drawMedia(); refocus(); },
        }),
        h('span', {}, m === 'lp' ? 'LP本体' : 'PC表示全体')))) : null);
    const toolbar = bar.children.length ? bar : null;
    if (!cap) {
      view = null;
      scroller.replaceChildren(...kids(toolbar, h('div', { class: 'lp-empty' },
        siteThumb(site),
        h('p', {}, pg?.status === 'capturing' ? 'ページ全体を撮影しています…（30秒〜1分ほど）'
          : pg?.status === 'error' ? `撮影に失敗しました：${pg.error ?? ''}` : 'まだ撮影していません'))));
      return;
    }
    view = lpView(cap, mode);
    scroller.replaceChildren(...kids(toolbar, view.stack));
  };

  const focusOn = (part) => {
    currentFocus = part;
    const pid = part.page ?? null;
    if (pid !== pageId) { pickPage(pid); drawMedia(); }
    if (cap?.lp && mode === 'lp' && !inColumn(part.rect, cap.lp)) { mode = 'full'; drawMedia(); }
    markCurrent();
    refocus();
  };

  const top = site.capture;
  const date = new Date(site.createdAt).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
  const order = new Map(state.categories.map((c, i) => [c.id, i]));
  const groups = [...new Set(parts.map((p) => p.category))].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));

  drawMedia();
  els.detail.replaceChildren(
    scroller,
    h('div', { class: 'detail-info' },
      detailBar(list, index, stepDetail, els.detailDialog),
      h('h2', { class: 'detail-title' }, displayTitle(site)),
      h('a', { class: 'detail-url', href: site.url, target: '_blank', rel: 'noopener noreferrer' }, site.url),
      site.tags.length
        ? h('div', { class: 'chips chips-sm' }, site.tags.map((t) =>
            h('button', { class: 'chip', type: 'button', onclick: () => { els.detailDialog.close(); state.view = 'sites'; state.tag = t; render(); } }, `#${t}`)))
        : null,
      site.memo ? h('p', { class: 'detail-memo' }, site.memo) : null,
      h('p', { class: 'detail-date' }, `${date} に追加`,
        top ? `・${new Date(top.capturedAt).toLocaleDateString('ja-JP')} に撮影` : '',
        hasPages ? `・${pages.length} 画面` : ''),
      h('div', { class: 'detail-actions' },
        h('a', { class: 'btn btn-primary', href: site.url, target: '_blank', rel: 'noopener noreferrer' }, 'サイトを開く', icon('external')),
        READ_ONLY ? null : [
          h('button', {
            class: 'btn',
            type: 'button',
            'aria-pressed': String(!!site.favorite),
            onclick: async () => { await toggleFav(site.id); showDetail(site.id); },
          }, icon('star'), site.favorite ? 'お気に入り済み' : 'お気に入り'),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => openEdit(site.id) }, icon('edit'), '編集'),
          h('button', {
            class: 'btn btn-ghost',
            type: 'button',
            disabled: site.status === 'capturing',
            onclick: () => recapture(site.id),
          }, icon('camera'), site.status === 'capturing' ? '撮影中…' : '撮り直す'),
        ]),
      h('section', { class: 'dparts' },
        h('h3', { class: 'dparts-title' }, 'パーツ', h('span', { class: 'chip-count' }, String(parts.length))),
        parts.length
          ? groups.map((g) => h('div', { class: 'dparts-group' },
              h('h4', {}, catName(g)),
              h('div', { class: 'dparts-list' }, parts.filter((p) => p.category === g).map((p) =>
                h('div', { class: 'dpart', 'data-id': p.id },
                  h('button', { class: 'dpart-main', type: 'button', title: 'ページ内の位置を表示', onclick: () => focusOn(p) },
                    partImage(p, 'dpart-img'),
                    h('span', { class: 'dpart-label' }, p.label || catName(p.category)),
                    hasPages ? h('span', { class: 'dpart-page' }, pageLabel(site, p.page)) : null),
                  h('button', { class: 'dpart-zoom icon-btn', type: 'button', title: '大きく見る', 'aria-label': '大きく見る', onclick: () => showPart(p.id) }, icon('expand')))))))
          : h('p', { class: 'dparts-empty' }, READ_ONLY ? 'このサイトはまだパーツに分けていません。' : top
            ? 'まだパーツに分けていません。Claude に「パーツ分けして」と頼むと、この画面を切り分けて登録します。'
            : '撮影が終わると、ここにパーツが並びます。'))),
  );

  if (!els.detailDialog.open) els.detailDialog.showModal();
  if (focusPart) {
    requestAnimationFrame(() => focusOn(focusPart));
  } else {
    scroller.scrollTop = 0;
  }
}

function stepDetail(dir) {
  const list = visibleSites();
  const i = list.findIndex((s) => s.id === state.detailId);
  if (i < 0 || list.length < 2) return;
  showDetail(list[(i + dir + list.length) % list.length].id);
}

/* ---------- part detail ---------- */

function showPart(id) {
  const part = allParts().find((p) => p.id === id);
  if (!part) return;
  state.partId = id;
  const list = state.view === 'parts' ? visibleParts() : part.site.parts.map((p, order) => ({ ...p, site: part.site, order }));
  const index = list.findIndex((p) => p.id === id);
  const site = part.site;

  els.partDetail.replaceChildren(
    h('div', { class: 'detail-media part-full' },
      h('img', { src: asset(part.file, site.updatedAt), alt: part.label || catName(part.category), style: `width:${part.rect.w}px` })),
    h('div', { class: 'detail-info' },
      detailBar(list, index, stepPart, els.partDialog),
      h('div', { class: 'chips chips-sm' }, [part.category, ...(part.also ?? [])].map((c) =>
        h('button', {
          class: 'chip',
          type: 'button',
          onclick: () => { els.partDialog.close(); if (els.detailDialog.open) els.detailDialog.close(); state.view = 'parts'; state.cat = c; render(); },
        }, catName(c)))),
      h('h2', { class: 'detail-title' }, part.label || catName(part.category)),
      part.note ? h('p', { class: 'detail-memo' }, part.note) : null,
      h('p', { class: 'detail-date' }, part.page ? `${pageLabel(site, part.page)}の画面・` : '', `${part.rect.w}×${part.rect.h}px`),
      h('button', { class: 'part-source', type: 'button', onclick: () => showDetail(site.id, { focus: part.id }) },
        siteThumb(site),
        h('span', {},
          h('span', { class: 'part-source-title' }, displayTitle(site)),
          h('span', { class: 'part-source-host' }, hostOf(site.url)))),
      h('div', { class: 'detail-actions' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => showDetail(site.id, { focus: part.id }) }, icon('locate'), 'ページ内の位置を見る'),
        h('a', { class: 'btn', href: site.url, target: '_blank', rel: 'noopener noreferrer' }, 'サイトを開く', icon('external')))),
  );
  if (!els.partDialog.open) els.partDialog.showModal();
  els.partDetail.querySelector('.part-full').scrollTop = 0;
}

function stepPart(dir) {
  const part = allParts().find((p) => p.id === state.partId);
  if (!part) return;
  const list = state.view === 'parts' ? visibleParts() : part.site.parts;
  const i = list.findIndex((p) => p.id === state.partId);
  if (i < 0 || list.length < 2) return;
  showPart(list[(i + dir + list.length) % list.length].id);
}

/* ---------- edit ---------- */

const thumbMode = () => els.form.querySelector('input[name="thumb"]:checked').value;
const setThumbMode = (mode) => {
  const input = els.form.querySelector(`input[name="thumb"][value="${mode}"]`) ?? els.form.querySelector('input[name="thumb"]');
  input.checked = true;
};

function openEdit(id, prefill = {}) {
  const site = id ? findSite(id) : null;
  editingId = site?.id ?? null;

  els.form.reset();
  els.editHeading.textContent = site ? 'サイトを編集' : 'サイトを追加';
  els.fUrl.value = site?.url ?? prefill.url ?? '';
  els.fTitle.value = site?.title ?? prefill.title ?? '';
  els.fTags.value = site ? site.tags.join(', ') : '';
  els.fMemo.value = site?.memo ?? '';
  draftImage = site?.image ? asset(site.image, site.updatedAt) : null;
  draftImageChanged = false;
  setThumbMode(site?.thumb ?? 'capture');
  els.deleteBtn.hidden = !site;

  updateUrlHint();
  renderTagSuggest();
  updatePreview();

  if (els.detailDialog.open) els.detailDialog.close();
  if (els.partDialog.open) els.partDialog.close();
  if (!els.editDialog.open) els.editDialog.showModal();
  (els.fUrl.value ? els.fTitle : els.fUrl).focus();
}

function findDuplicate(url) {
  const key = urlKey(url);
  return state.sites.find((s) => s.id !== editingId && urlKey(s.url) === key);
}

function updateUrlHint() {
  const raw = els.fUrl.value.trim();
  const url = normalizeUrl(raw);
  const dup = url && findDuplicate(url);
  els.urlHint.className = 'hint';
  if (raw && !url) {
    els.urlHint.textContent = 'URLの形式を確認してください';
    els.urlHint.classList.add('is-error');
  } else if (dup) {
    els.urlHint.textContent = `「${displayTitle(dup)}」として登録済みです`;
    els.urlHint.classList.add('is-warn');
  } else {
    els.urlHint.textContent = '';
  }
}

function renderTagSuggest() {
  const current = new Set(parseTags(els.fTags.value));
  const rest = tagCounts().map(([t]) => t).filter((t) => !current.has(t)).slice(0, 24);
  els.tagSuggest.replaceChildren(...rest.map((t) =>
    h('button', {
      class: 'chip',
      type: 'button',
      onclick: () => {
        els.fTags.value = [...parseTags(els.fTags.value), t].join(', ') + ', ';
        renderTagSuggest();
        els.fTags.focus();
      },
    }, `+ ${t}`)));
}

function updatePreview() {
  const mode = thumbMode();
  const box = els.thumbPreview;
  const isDrop = mode === 'upload';
  const site = editingId ? findSite(editingId) : null;

  box.className = 'thumb-preview';
  box.classList.toggle('is-drop', isDrop);
  box.classList.toggle('has-image', isDrop && !!draftImage);
  if (isDrop) {
    box.setAttribute('tabindex', '0');
    box.setAttribute('role', 'button');
    box.setAttribute('aria-label', '画像を選択');
  } else {
    box.removeAttribute('tabindex');
    box.removeAttribute('role');
    box.removeAttribute('aria-label');
  }

  els.thumbHint.className = 'hint';
  if (isDrop) {
    box.replaceChildren(...kids(
      draftImage ? h('img', { src: draftImage, alt: '' }) : null,
      h('span', { class: 'drop-msg' }, draftImage
        ? 'クリック・ドロップ・⌘V で差し替え'
        : 'スクリーンショットをドロップ / ⌘V で貼り付け / クリックして選択'),
    ));
    els.thumbHint.textContent = 'ページ全体の撮影とパーツ分けは、この設定に関係なく行います';
  } else if (mode === 'capture') {
    if (site?.capture) {
      box.replaceChildren(siteThumb({ ...site, thumb: 'capture' }));
      els.thumbHint.textContent = '';
    } else {
      box.replaceChildren(h('div', { class: 'thumb-empty' }, '保存すると、このMacのChromeでページ全体を自動撮影します（30秒〜1分ほど）'));
      els.thumbHint.textContent = '';
    }
  } else {
    const url = normalizeUrl(els.fUrl.value) ?? 'https://example.com';
    box.replaceChildren(siteThumb({ url, title: els.fTitle.value.trim(), thumb: 'none' }));
    els.thumbHint.textContent = 'ドメイン名から色を決めたサムネイルを表示します';
  }
}

async function loadImageFile(file) {
  if (!file?.type.startsWith('image/')) return;
  try {
    draftImage = await resizeImage(file);
    draftImageChanged = true;
    setThumbMode('upload');
    updatePreview();
  } catch (err) {
    console.error(err);
    toast('画像を読み込めませんでした');
  }
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, IMAGE_MAX_WIDTH / img.naturalWidth, IMAGE_MAX_HEIGHT / img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(src);
      resolve(canvas.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('画像をデコードできません')); };
    img.src = src;
  });
}

async function saveForm(e) {
  e.preventDefault();
  const url = normalizeUrl(els.fUrl.value);
  if (!url) {
    els.urlHint.textContent = 'URLを入力してください';
    els.urlHint.className = 'hint is-error';
    els.fUrl.focus();
    return;
  }
  const mode = thumbMode();
  if (mode === 'upload' && !draftImage) {
    els.thumbHint.textContent = '画像を追加するか、ほかのサムネイル方法を選んでください';
    els.thumbHint.className = 'hint is-error';
    return;
  }
  const dup = findDuplicate(url);
  if (dup && !confirm(`このURLは「${displayTitle(dup)}」として登録済みです。それでも保存しますか？`)) return;

  const body = {
    url,
    title: els.fTitle.value.trim(),
    tags: parseTags(els.fTags.value),
    memo: els.fMemo.value.trim(),
    thumb: mode,
  };
  if (mode === 'upload' && draftImageChanged) body.imageData = draftImage;

  const isNew = !editingId;
  try {
    const site = isNew
      ? await api('POST', 'api/sites', body)
      : await api('PUT', `api/sites/${encodeURIComponent(editingId)}`, body);
    replaceSite(site);
  } catch (err) {
    console.error(err);
    toast(`保存できませんでした（${err.message}）`);
    return;
  }
  els.editDialog.close();
  if (isNew) state.view = 'sites';
  render();
  toast(isNew ? '追加しました。ページ全体を撮影しています…' : '更新しました');
  schedulePoll();
}

/* ---------- toast ---------- */

let toastTimer;
function toast(message, action) {
  const el = els.toast;
  const hide = () => {
    el.classList.remove('is-show');
    if (el.hidePopover && el.matches(':popover-open')) el.hidePopover();
  };
  el.replaceChildren(...kids(
    h('span', {}, message),
    action ? h('button', { class: 'toast-action', type: 'button', onclick: () => { hide(); action.run(); } }, action.label) : null,
  ));
  if (el.showPopover && !el.matches(':popover-open')) el.showPopover();
  el.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, action ? 6000 : 3000);
}

/* ---------- 撮影中のサイトがあれば定期的に読み直す ---------- */

const signature = () => state.sites.map((s) => `${s.id}:${s.updatedAt}:${s.status}`).join('|');
let pollTimer = null;

async function refresh() {
  const before = signature();
  setLibrary(await api('GET', 'api/library'));
  if (signature() === before) return;
  render();
  if (els.detailDialog.open && state.detailId && findSite(state.detailId)) {
    const scroller = els.detail.querySelector('.lp-scroll');
    const top = scroller?.scrollTop ?? 0;
    showDetail(state.detailId);
    const next = els.detail.querySelector('.lp-scroll');
    if (next) next.scrollTop = top;
  }
}

function schedulePoll() {
  clearTimeout(pollTimer);
  const busy = state.sites.some((s) => s.status === 'capturing' || s.status === 'pending');
  if (!busy) return;
  pollTimer = setTimeout(async () => {
    try { await refresh(); } catch (err) { console.error(err); }
    schedulePoll();
  }, POLL_MS);
}

/* ---------- 旧版（ブラウザ内保存）からの移行 ---------- */

async function migrateFromBrowser() {
  if (!window.indexedDB) return;
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('web-gallery', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('sites', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return;
  }
  const tx = (mode, fn) => new Promise((resolve, reject) => {
    const t = db.transaction('sites', mode);
    const req = fn(t.objectStore('sites'));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
  const old = await tx('readonly', (s) => s.getAll());
  if (!old?.length) { db.close(); return; }

  let moved = 0;
  for (const r of old) {
    const url = normalizeUrl(r.url);
    if (!url || state.sites.some((s) => urlKey(s.url) === urlKey(url))) continue;
    const hasImage = r.thumb === 'upload' && typeof r.image === 'string' && r.image.startsWith('data:image/');
    try {
      const site = await api('POST', 'api/sites', {
        url,
        title: r.title ?? '',
        tags: Array.isArray(r.tags) ? r.tags : [],
        memo: r.memo ?? '',
        favorite: !!r.favorite,
        thumb: hasImage ? 'upload' : r.thumb === 'none' ? 'none' : 'capture',
        imageData: hasImage ? r.image : undefined,
      });
      replaceSite(site);
      moved++;
    } catch (err) {
      console.error(err);
    }
  }
  await tx('readwrite', (s) => s.clear());
  db.close();
  if (moved) {
    render();
    toast(`ブラウザに保存されていた ${moved} 件を移しました。順番に撮影します`);
  }
}

/* ---------- bookmarklet / incoming ---------- */

function setupBookmarklet() {
  const base = location.href.split(/[?#]/)[0];
  els.bookmarklet.href =
    `javascript:(()=>{window.open(${JSON.stringify(base)}+'?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title))})()`;
  els.bookmarklet.addEventListener('click', (e) => {
    e.preventDefault();
    toast('このボタンはブックマークバーにドラッグして使います');
  });
}

function handleIncoming() {
  const params = new URLSearchParams(location.search);
  const url = params.get('url');
  if (!url) return;
  history.replaceState(null, '', location.pathname);
  openEdit(null, { url, title: params.get('title') ?? '' });
}

/* ---------- events ---------- */

const anyDialogOpen = () => !!document.querySelector('dialog[open]');

function bindEvents() {
  $('#add-btn').addEventListener('click', () => openEdit(null));
  $('#empty-add').addEventListener('click', () => openEdit(null));
  document.querySelectorAll('[data-open-help]').forEach((b) => b.addEventListener('click', () => els.helpDialog.showModal()));
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
  document.querySelectorAll('.view-switch [data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

  els.search.addEventListener('input', () => { state.query = els.search.value; render(); });
  els.sort.addEventListener('change', () => {
    state.sort = els.sort.value;
    try { localStorage.setItem('wg-sort', state.sort); } catch {}
    render();
  });

  // 背景クリックで閉じる（入力中のフォームは誤って閉じないよう対象外）
  for (const dialog of [els.detailDialog, els.partDialog, els.helpDialog]) {
    let downOnBackdrop = false;
    dialog.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === dialog; });
    dialog.addEventListener('click', (e) => { if (downOnBackdrop && e.target === dialog) dialog.close(); });
  }

  // フォーム
  els.form.addEventListener('submit', saveForm);
  els.form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); els.form.requestSubmit(); }
  });
  els.deleteBtn.addEventListener('click', () => removeSite(editingId));
  els.fUrl.addEventListener('input', updateUrlHint);
  els.fUrl.addEventListener('change', updatePreview);
  els.fTitle.addEventListener('change', updatePreview);
  els.fTags.addEventListener('input', renderTagSuggest);
  els.form.querySelectorAll('input[name="thumb"]').forEach((r) => r.addEventListener('change', updatePreview));

  const pick = () => { if (thumbMode() === 'upload') els.fileInput.click(); };
  els.thumbPreview.addEventListener('click', pick);
  els.thumbPreview.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
  });
  els.fileInput.addEventListener('change', () => {
    loadImageFile(els.fileInput.files[0]);
    els.fileInput.value = '';
  });

  // 貼り付け：フォームでは画像、一覧ではURLから新規追加
  document.addEventListener('paste', (e) => {
    if (READ_ONLY) return;
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (els.editDialog.open) {
      if (file) { e.preventDefault(); loadImageFile(file); }
      return;
    }
    if (anyDialogOpen() || e.target.closest?.('input, textarea, [contenteditable]')) return;
    const text = e.clipboardData?.getData('text/plain')?.trim() ?? '';
    const url = /^https?:\/\/\S+$/i.test(text) ? normalizeUrl(text) : null;
    if (!url) return;
    e.preventDefault();
    openEdit(null, { url });
  });

  // ドラッグ＆ドロップ
  let dragTimer;
  window.addEventListener('dragover', (e) => {
    if (READ_ONLY) return;
    const types = [...e.dataTransfer.types];
    const files = types.includes('Files');
    const link = types.includes('text/uri-list');
    if (!files && !(link && !anyDialogOpen())) return;
    e.preventDefault();
    const target = els.editDialog.open ? els.thumbPreview : anyDialogOpen() ? null : document.body;
    if (!target) return;
    target.classList.add(target === document.body ? 'is-dragging' : 'is-over');
    clearTimeout(dragTimer);
    dragTimer = setTimeout(() => target.classList.remove('is-dragging', 'is-over'), 150);
  });
  window.addEventListener('drop', (e) => {
    if (READ_ONLY) return;
    document.body.classList.remove('is-dragging');
    const dt = e.dataTransfer;
    const file = [...dt.files].find((f) => f.type.startsWith('image/'));
    if (dt.types.includes('Files')) e.preventDefault();
    if (els.editDialog.open) { if (file) loadImageFile(file); return; }
    if (anyDialogOpen()) return;
    const link = (dt.getData('text/uri-list') || '').split(/\r?\n/).find((l) => l && !l.startsWith('#'));
    if (!link) return;
    e.preventDefault();
    openEdit(null, { url: link });
  });

  // キーボード
  document.addEventListener('keydown', (e) => {
    if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (els.partDialog.open) {
      if (e.key === 'ArrowRight') stepPart(1);
      else if (e.key === 'ArrowLeft') stepPart(-1);
      return;
    }
    if (els.detailDialog.open) {
      if (e.key === 'ArrowRight') stepDetail(1);
      else if (e.key === 'ArrowLeft') stepDetail(-1);
      else if ((e.key === 'e' || e.key === 'E') && !READ_ONLY) openEdit(state.detailId);
      return;
    }
    if (anyDialogOpen() || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.key === '/') { e.preventDefault(); els.search.focus(); }
    else if ((e.key === 'n' || e.key === 'N') && !READ_ONLY) { e.preventDefault(); openEdit(null); }
    else if (e.key === '1') setView('sites');
    else if (e.key === '2') setView('parts');
  });
}

/* ---------- init ---------- */

async function init() {
  document.body.classList.toggle('is-readonly', READ_ONLY);
  bindEvents();
  if (!READ_ONLY) setupBookmarklet();
  try {
    const sort = localStorage.getItem('wg-sort');
    if (sort && [...els.sort.options].some((o) => o.value === sort)) state.sort = sort;
    const view = localStorage.getItem('wg-view');
    if (view === 'sites' || view === 'parts') state.view = view;
  } catch {}
  els.sort.value = state.sort;

  try {
    setLibrary(await api('GET', READ_ONLY ? 'data/library.json' : 'api/library'));
  } catch (err) {
    console.error(err);
    toast(READ_ONLY ? 'データを読み込めませんでした' : 'データを読み込めませんでした。python3 server.py で起動しているか確認してください');
  }
  render();
  if (READ_ONLY) return;
  await migrateFromBrowser();
  schedulePoll();
  handleIncoming();
}

init();
