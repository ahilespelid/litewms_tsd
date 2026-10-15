// Журнал пиков: сколько собрано за смену (порт picks.js). В вебе был синхронный
// localStorage; в RN держим буфер в памяти (initPicks загружает на старте) и
// дебаунсим запись в AsyncStorage. По сотруднику (getEmail) — на устройстве за
// смену меняются люди. Серверной таблицы нет; для «Пики за смену» локально хватает.
import { getEmail, getTenantName } from './api';
import { lsGet, lsSet } from './storage';

const KEY = 'tsd.picks';
const LIMIT = 5000;
let rows = [];
let persistTimer = null;

export async function initPicks() {
  try { const raw = JSON.parse((await lsGet(KEY)) || '[]'); if (Array.isArray(raw)) rows = raw; } catch (_) { rows = []; }
}
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => { lsSet(KEY, JSON.stringify(rows.slice(-LIMIT))); }, 1200);
}

export function recordPick({ company, order, barcode, name, price = null, mp = '' }) {
  try {
    rows.push({ t: Date.now(), u: getEmail() || '—', w: getTenantName() || '', c: company || '', o: order || '', b: barcode || '', n: name || '', p: price, mp: mp || '' });
    if (rows.length > LIMIT) rows = rows.slice(-LIMIT);
    schedulePersist();
  } catch (_) {}
}

function dayKey(ts) { const d = new Date(ts); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

export function pickSummary({ email = null, days = 14 } = {}) {
  const list = rows.filter((r) => !email || r.u === email);
  const byDay = new Map();
  for (const r of list) {
    const key = dayKey(r.t);
    if (!byDay.has(key)) byDay.set(key, { day: key, picks: 0, revenue: 0, priced: 0, orders: new Set(), companies: new Map(), last: 0 });
    const d = byDay.get(key);
    d.picks += 1;
    if (r.o) d.orders.add(r.o);
    if (typeof r.p === 'number') { d.revenue += r.p; d.priced += 1; }
    if (r.c) { const c = d.companies.get(r.c) || { picks: 0, revenue: 0 }; c.picks += 1; if (typeof r.p === 'number') c.revenue += r.p; d.companies.set(r.c, c); }
    if (r.t > d.last) d.last = r.t;
  }
  return Array.from(byDay.values()).map((d) => ({
    day: d.day, picks: d.picks, orders: d.orders.size, last: d.last, revenue: d.revenue, allPriced: d.priced === d.picks,
    companies: Array.from(d.companies.entries()).map(([name, c]) => ({ name, picks: c.picks, revenue: c.revenue })).sort((a, b) => b.picks - a.picks),
  })).sort((a, b) => b.day.localeCompare(a.day)).slice(0, days);
}

export function pickUsers() { return Array.from(new Set(rows.map((r) => r.u))).sort(); }
export function clearPicks() { rows = []; lsSet(KEY, '[]'); }
