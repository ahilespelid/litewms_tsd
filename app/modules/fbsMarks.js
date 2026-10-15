import { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Modal, Image, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenHeader from '../../components/ScreenHeader';
import ScanField from '../../components/ScanField';
import { api } from '../../lib/api';
import { speak, formatCellSpeech, getCellVoiceMode } from '../../lib/cells';
import { useScanDedup } from '../../lib/scanner';
import { lsGet, lsSet } from '../../lib/storage';
import { getTakeFromCell, getSpeakCellSborka } from '../../lib/fbsSettings';
import { recordPick } from '../../lib/picks';
import { colors, font, radius, shadow } from '../../theme';

// ФБС Ozon / Яндекс (порт OzonFbsModule.vue / YandexFbsModule.vue). Один экран на
// оба маркетплейса — различия вынесены в MARKETS[market]. ЧЗ двухтактный:
// marks/check на пике (мгновенная валидация), marks/save перед /ship («Собрать»).
// Компания → сразу работа (шага «поставки» нет). Вкладки Сборка / Отбор.
const sound = (kind, text) => { if (text) speak(String(text)); };
const photoOf = (it) => it?.image_url || it?.image || it?.primary_image || '';
const shkTail = (c) => String(c || '').slice(-4);
const shkHead = (c) => { const s = String(c || ''); return s.length > 4 ? s.slice(0, -4) : ''; };
const itemArt = (it) => String(it?.offer_id || it?.article || '').trim();
const itemSize = (it) => String(it?.size || it?.tech_size || '').trim();
const cellSpeech = (code) => formatCellSpeech(code, getCellVoiceMode());
const firstCellLabel = (cells) => { const first = String(cells || '').split(',')[0] || ''; return first.split('×')[0].trim().toUpperCase(); };
const cellRack = (cells) => String(firstCellLabel(cells)).split('-')[0] || '—';
const cellNums = (cells) => String(firstCellLabel(cells)).split('-').slice(1).join('-');
const cellQty = (cells) => { const m = String(cells || '').split(',')[0].match(/×\s*(\d+)/); return m ? m[1] : ''; };

function cellDistance(a, b) {
  const pa = String(a || '').split('-'), pb = String(b || '').split('-');
  if (!pa[0] || !pb[0]) return 1e9;
  if (pa[0].toUpperCase() !== pb[0].toUpperCase()) return 1e6;
  let d = 0; const n = Math.max(pa.length, pb.length);
  for (let i = 1; i < n; i++) d += Math.abs((Number(pa[i]) || 0) - (Number(pb[i]) || 0)) * (n - i);
  return d;
}
function pickCells(places, need, near) {
  const enough = places.filter((pl) => Number(pl.quantity) >= (need || 1));
  if (enough.length) { if (near) enough.sort((a, b) => cellDistance(a.code, near) - cellDistance(b.code, near) || Number(b.quantity) - Number(a.quantity)); else enough.sort((a, b) => Number(b.quantity) - Number(a.quantity)); return [enough[0]]; }
  const sorted = [...places].sort((a, b) => Number(b.quantity) - Number(a.quantity)); const picked = []; let left = need || 1;
  for (const pl of sorted) { picked.push(pl); left -= Number(pl.quantity); if (left <= 0) break; } return picked;
}
function comparePickRoute(a, b) {
  const A = a.cellCode, B = b.cellCode;
  if (!A && !B) return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
  if (!A) return 1; if (!B) return -1;
  const pa = A.split('-'), pb = B.split('-'); const ra = (pa[0] || '').toUpperCase(), rb = (pb[0] || '').toUpperCase();
  if (ra !== rb) return ra < rb ? -1 : 1; const n = Math.max(pa.length, pb.length);
  for (let i = 1; i < n; i++) { const da = Number(pa[i]) || 0, db = Number(pb[i]) || 0; if (da !== db) return da - db; } return 0;
}
const RU_TO_EN = { 'й':'q','ц':'w','у':'e','к':'r','е':'t','н':'y','г':'u','ш':'i','щ':'o','з':'p','х':'[','ъ':']','ф':'a','ы':'s','в':'d','а':'f','п':'g','р':'h','о':'j','л':'k','д':'l','ж':';','э':"'",'я':'z','ч':'x','с':'c','м':'v','и':'b','т':'n','ь':'m','б':',','ю':'.','ё':'`','.':'/',',':'?','"':'@','№':'#',';':'$',':':'^','?':'&','/':'|' };
function fixLayout(raw) { const v = String(raw || ''); if (!/[А-Яа-яЁё]/.test(v)) return v; let out = ''; for (const ch of v) out += RU_TO_EN[ch] ?? RU_TO_EN[ch.toLowerCase()]?.toUpperCase() ?? ch; return out; }
function stripChzPrefix(code) { let t = String(code || '').trim(); t = t.replace(/^\][A-Za-z][0-9]/, ''); t = t.replace(/^[^\d(\x1D]+(?=01\d{14})/, ''); return t; }
function looksLikeKiz(code) { const s = stripChzPrefix(code); if (!s) return false; if (s.includes('\x1D') || s.includes('(01)')) return true; return /^01\d{14}/.test(s) && s.length > 20; }
function normalizeSgtin(raw) {
  if (!raw) return '';
  const GS = '\u001D';
  let s = String(raw).replace(/﻿/g, '').replace(/[\r\n\t]+$/g, '').trim();
  s = s.replace(/^\][A-Za-z][0-9]/, '').replace(/^[^\d(\x1D]+(?=01\d{14})/, '');
  s = s.replace(/␝/g, GS).replace(/<GS>/gi, GS).replace(/\{GS\}/gi, GS).replace(/\^029/g, GS);
  if (!s.includes('\x1D') && /^01\d{14}/.test(s) && s.includes(' ')) s = s.replace(/ +/g, GS);
  if (s.includes('\x1D')) return s;
  if (/\(\d{2}\)/.test(s)) { const segs = []; const re = /\((\d{2})\)([^()]+)/g; let m; while ((m = re.exec(s)) !== null) segs.push({ ai: m[1], value: m[2].replace(/\s+/g, '') }); if (!segs.length) return s; let out = ''; for (let i = 0; i < segs.length; i++) { out += segs[i].ai + segs[i].value; if (i < segs.length - 1 && segs[i].ai !== '01') out += GS; } return out; }
  return s;
}

const markKeyNum = (v) => { const n = Number(v); return Number.isFinite(n) && String(n) === String(v) ? n : v; };
const MARKETS = {
  ozon: {
    base: '/api/ozon-fbs', title: 'Ozon', companyFlag: 'has_ozon_api', mp: 'ozon', localDoneKey: 'tsd.ozonFbsDone',
    productBarcodes: (item) => [item.barcode, item.sku_id, item.product_id, ...(Array.isArray(item.barcodes) ? item.barcodes : [])].map((b) => String(b || '').trim()).filter(Boolean),
    needQty: (item) => Number(item.quantity ?? 1),
    statusOk: (p) => String(p.status || '').toLowerCase() === 'awaiting_packaging',
    needKizFor: (p, item) => { if (!p?.mark_required) return false; const skus = (Array.isArray(p.mark_required_skus) ? p.mark_required_skus : []).map(String); return skus.length === 0 || skus.includes(String(item.sku_id)); },
    markKeyField: 'product_id', markKey: (row) => markKeyNum(row?.item?.product_id),
  },
  yandex: {
    base: '/api/yandex-fbs', title: 'Яндекс', companyFlag: 'has_yandex_api', mp: 'yandex', localDoneKey: 'tsd.yandexFbsDone',
    productBarcodes: (item) => [item.barcode, item.offer_id, item.article, ...(Array.isArray(item.barcodes) ? item.barcodes : [])].map((b) => String(b || '').trim()).filter(Boolean),
    needQty: (item) => Number(item.count ?? item.quantity ?? 1),
    statusOk: (p) => { const st = String(p?.status || '').toUpperCase(); const sub = String(p?.substatus || '').toUpperCase(); const local = String(p?.local_status || '').toLowerCase(); if (sub === 'READY_TO_SHIP' || local === 'awaiting_shipment') return false; if (st === 'PROCESSING' && (!sub || sub === 'STARTED')) return true; if (local === 'new') return true; return false; },
    needKizFor: (p, item) => (Array.isArray(item?.mark_types) ? item.mark_types : []).map((x) => String(x).toUpperCase()).includes('CIS'),
    markKeyField: 'item_id', markKey: (row) => markKeyNum(row?.item?.item_id),
  },
};

export default function FbsMarksScreen({ market = 'ozon', onMarket }) {
  const M = MARKETS[market] || MARKETS.ozon;
  const insets = useSafeAreaInsets();
  const scanRef = useRef(null);
  const isDup = useScanDedup();
  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => (n + 1) % 1e9), []);

  const [step, setStep] = useState('companies'); // companies | work
  const [mode, setMode] = useState('sborka');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [errorLog, setErrorLog] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [companyQuery, setCompanyQuery] = useState('');
  const companyRef = useRef(null);

  const workRef = useRef([]);
  const [scan, setScan] = useState('');
  const [showKb, setShowKb] = useState(false);
  const [phase, setPhase] = useState('barcode'); // barcode | kiz
  const activeRowRef = useRef(null);
  const [current, setCurrent] = useState(null);
  const [targetFace, setTargetFace] = useState('cell');
  const [cellsLoading, setCellsLoading] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [detail, setDetail] = useState(null);
  const localDoneRef = useRef({});
  const cellsByBarcode = useRef(new Map());
  const marksBusy = useRef(new Set());

  const otborDoneRef = useRef({});
  const otborTakenRef = useRef({});
  const otborBusy = useRef(new Set());

  const work = workRef.current;
  const log = (kind, text) => { if (kind === 'error') setErrorLog((prev) => [{ text, t: Date.now() }, ...prev].slice(0, 3)); };
  const refocus = useCallback(() => { setTimeout(() => scanRef.current?.focus(), 250); }, []);
  const labelOf = (o) => o.posting.posting_number;

  const readLocalDone = async () => { try { return JSON.parse((await lsGet(M.localDoneKey)) || '{}') || {}; } catch (_) { return {}; } };
  const markLocalDone = (pn) => { if (!pn) return; localDoneRef.current[pn] = Date.now(); lsSet(M.localDoneKey, JSON.stringify(localDoneRef.current)); };

  // ---------- компании ----------
  const loadCompanies = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api(`${M.base}/companies?scope=all`);
      if (!res.ok) throw new Error(`Сервер ответил ${res.status}`);
      const list = await res.json();
      setCompanies((Array.isArray(list) ? list : []).filter((c) => c[M.companyFlag] && Number(c.orders_count) > 0).map((c) => ({ ...c, assembly_count: Number(c.orders_count) || 0 })).sort((a, b) => (b.assembly_count - a.assembly_count) || String(a.display_name || '').localeCompare(String(b.display_name || ''), 'ru')));
    } catch (e) { setError('Не удалось загрузить компании: ' + e.message); }
    finally { setLoading(false); }
  }, [M]);

  useEffect(() => { loadCompanies(); }, [loadCompanies]);

  const mapPostings = (postings) => (postings || []).filter((p) => M.statusOk(p)).map((p) => {
    const localDone = Boolean(localDoneRef.current[p.posting_number]);
    const entry = { posting: p, markRequired: (p.products || []).some((it) => M.needKizFor(p, it)), localDone, shipState: '', sendState: '', rows: (p.products || []).map((item) => ({ item, barcodes: M.productBarcodes(item), need: M.needQty(item), scanned: 0, kiz: [], needKiz: M.needKizFor(p, item) })) };
    if (localDone) for (const r of entry.rows) { r.scanned = r.need; if (r.needKiz) r.kizSkipped = r.need; }
    return entry;
  });

  // ---------- ячейки ----------
  const placesFor = async (barcode) => {
    try { const res = await api(`/api/cells/scan?code=${encodeURIComponent(barcode)}`); if (!res.ok) return { productId: null, places: [] }; const d = await res.json(); if (!d?.found || d.kind !== 'product') return { productId: null, places: [] }; return { productId: d.product?.id || null, places: (d.places || []).filter((pl) => Number(pl.quantity) > 0) }; } catch (_) { return { productId: null, places: [] }; }
  };
  const resolveProduct = async (code) => { if (cellsByBarcode.current.has(code)) return cellsByBarcode.current.get(code); const info = await placesFor(code); cellsByBarcode.current.set(code, info); return info; };
  const loadCells = useCallback(async () => {
    const barcodes = [];
    for (const o of workRef.current) for (const r of o.rows) for (const b of r.barcodes) if (b && !cellsByBarcode.current.has(b)) barcodes.push(b);
    const список = Array.from(new Set(barcodes));
    setCellsLoading(true);
    try {
      if (список.length) { const очередь = [...список]; const работник = async () => { while (очередь.length) { const b = очередь.shift(); cellsByBarcode.current.set(b, await placesFor(b)); } }; await Promise.all([работник(), работник(), работник(), работник()]); }
      for (const o of workRef.current) for (const r of o.rows) { for (const b of r.barcodes) { const info = cellsByBarcode.current.get(b); if (info && info.places.length) { r.places = info.places; r.cellNodes = pickCells(info.places, r.need, null); r.productId = info.productId; r.cells = r.cellNodes.map((pl) => `${pl.code} ×${pl.quantity}`).join(', '); break; } } }
      rerender();
    } catch (_) {} finally { setCellsLoading(false); }
  }, [rerender]);

  const openCompany = useCallback(async (c) => {
    companyRef.current = c; await loadOtbor(c); setStep('work'); setMode('sborka'); workRef.current = []; setError(''); setLoading(true); setErrorLog([]); setCurrent(null); setPhase('barcode'); activeRowRef.current = null;
    localDoneRef.current = await readLocalDone();
    try {
      const res = await api(`${M.base}/companies/${c.id}/postings?shop_index=0&sync_remote=0&hydrate_images=0`);
      if (!res.ok) throw new Error(`Сервер ответил ${res.status}`);
      workRef.current = mapPostings(await res.json()); pruneOtbor(); rerender();
      api(`${M.base}/companies/${c.id}/postings?shop_index=0&sync_remote=1&hydrate_images=1`).then((r) => (r.ok ? r.json() : null)).then((fresh) => { if (fresh && !workRef.current.some((o) => orderScanned(o) > 0 || o.localDone)) { workRef.current = mapPostings(fresh); pruneOtbor(); loadCells(); rerender(); } }).catch(() => {});
    } catch (e) { setError('Не удалось загрузить отправления: ' + e.message); }
    finally { setLoading(false); loadCells(); refocus(); }
  }, [M, loadCells, refocus, rerender]);

  // ---------- производные ----------
  const rowClosed = (r) => (r.needKiz ? Math.min(r.scanned, r.kiz.length + (r.kizSkipped || 0)) : r.scanned) >= r.need;
  const rowOpen = (r) => !rowClosed(r);
  const orderNeed = (o) => o.rows.reduce((s, r) => s + r.need, 0);
  const orderScanned = (o) => o.rows.reduce((s, r) => s + r.scanned, 0);
  const orderDone = (o) => { if (o.localDone) return true; if (orderNeed(o) === 0) return false; return o.rows.every(rowClosed); };
  const rowDoneQty = (r) => (r.needKiz ? Math.min(r.scanned, r.kiz.length + (r.kizSkipped || 0)) : r.scanned);
  const totalOrders = work.length;
  const doneOrders = work.filter(orderDone).length;
  const allDone = totalOrders > 0 && doneOrders >= totalOrders;
  const totalUnits = work.reduce((s, o) => s + orderNeed(o), 0);
  const doneUnits = work.reduce((s, o) => s + o.rows.reduce((t, r) => t + Math.min(r.need, rowDoneQty(r)), 0), 0);
  const workSorted = (() => { const done = (o) => orderDone(o) || o.shipState === 'shipped' || o.localDone; return work.map((o, i) => ({ o, i })).sort((a, b) => ((done(a.o) ? 1 : 0) - (done(b.o) ? 1 : 0)) || (a.i - b.i)).map((x) => x.o); })();
  const kizState = (o, r) => { if (!r.needKiz) return null; if (o.shipState === 'error' || /не ушла|ошибка/.test(o.sendState || '')) return 'rejected'; if (o.shipState === 'shipped' || o.localDone || (r.kiz && r.kiz.length >= r.need)) return 'scanned'; return 'pending'; };
  const target = (() => { const c = current; if (c?.order && c?.row && !orderDone(c.order) && rowOpen(c.row)) return c; for (const o of workSorted) { if (orderDone(o)) continue; const row = o.rows.find(rowOpen); if (row) return { order: o, row }; } return null; })();

  // ---------- голос/ячейка/снятие ----------
  const takeOneFromCell = async (order, row) => {
    if (!getTakeFromCell()) return;
    const place = (row.cellNodes || []).find((pl) => Number(pl.quantity) > 0) || (row.cellNodes || [])[0];
    if (!place || !row.productId) { log('error', `${row.item?.name || row.barcodes?.[0] || ''}: не знаю, с какой ячейки снять`); return; }
    try {
      const res = await api('/api/cells/stock/take', { method: 'POST', body: JSON.stringify({ node_id: place.node_id, product_id: row.productId, company_id: place.company_id || companyRef.current?.id || 0, quality: 'good', quantity: 1, source: 'tsd' }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); const detail = d?.detail; const msg = typeof detail === 'string' ? detail : (detail?.message || `ошибка ${res.status}`); log('error', `Не снял с ячейки ${place.code}: ${msg}`); return; }
      place.quantity = Math.max(0, Number(place.quantity) - 1); row.cells = (row.cellNodes || []).filter((pl) => pl.quantity > 0).map((pl) => `${pl.code} ×${pl.quantity}`).join(', '); rerender();
    } catch (e) { log('error', `Не снял с ячейки ${place.code}: ${e.message}`); }
  };

  const afterUnit = (order, row) => {
    if (row && rowOpen(row)) { const left = row.need - rowDoneQty(row); sound('ok', `Ещё ${left}`); return; }
    const closed = Boolean(order && orderDone(order));
    const prefix = closed ? 'Готово. ' : '';
    if (allDoneLive()) { sound('ok', 'Готово'); return; }
    const nextRow = order?.rows.find(rowOpen);
    if (nextRow) { setCurrent({ order, row: nextRow }); sound('ok', nextRow.cells ? cellSpeech(firstCellLabel(nextRow.cells)) : 'Далее'); return; }
    const nextOrder = workRef.current.find((o) => !orderDone(o));
    const r = nextOrder?.rows.find(rowOpen);
    if (r) { setCurrent({ order: nextOrder, row: r }); sound('ok', r.cells ? prefix + cellSpeech(firstCellLabel(r.cells)) : `${prefix}Далее`); }
    else sound('ok', `${prefix}Далее`);
  };
  const allDoneLive = () => { const w = workRef.current; return w.length > 0 && w.filter(orderDone).length >= w.length; };

  // ---------- ЧЗ ----------
  const checkKiz = async (order, row, mark) => {
    const pn = order.posting.posting_number;
    try {
      const res = await api(`${M.base}/postings/${encodeURIComponent(pn)}/marks/check`, { method: 'POST', body: JSON.stringify({ company_id: companyRef.current.id, shop_index: 0, [M.markKeyField]: M.markKey(row), mark }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: d.detail || d.message || `сервер ${res.status}` };
      const errs = Array.isArray(d.errors) ? d.errors.filter(Boolean) : [];
      return { ok: d.ok !== false, error: errs.join('; '), warning: d.chz_warning };
    } catch (e) { return { ok: false, network: true, error: e.message }; }
  };
  const savePostingMarks = async (order) => {
    const pn = order.posting.posting_number;
    if (marksBusy.current.has(pn)) return { ok: false, busy: true, rejected: [] };
    const items = [];
    for (const r of order.rows) { if (!r.needKiz) continue; for (const mark of (r.kiz || [])) items.push({ [M.markKeyField]: M.markKey(r), mark }); }
    if (!items.length) return { ok: true, rejected: [] };
    marksBusy.current.add(pn); order.sendState = 'привязка марок';
    try {
      const res = await api(`${M.base}/postings/${encodeURIComponent(pn)}/marks/save`, { method: 'POST', body: JSON.stringify({ company_id: companyRef.current.id, shop_index: 0, items }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { order.sendState = 'ошибка марки'; return { ok: false, error: d.detail || d.message || `сервер ${res.status}`, rejected: [] }; }
      for (const w of (Array.isArray(d.chz_warnings) ? d.chz_warnings : [])) log('error', `${pn} · ${w.message || w}`);
      const rejected = Array.isArray(d.rejected) ? d.rejected : [];
      order.sendState = rejected.length ? 'ошибка марки' : 'марки привязаны';
      return { ok: rejected.length === 0, rejected };
    } catch (e) { order.sendState = 'марки не ушли'; return { ok: false, error: e.message, network: true, rejected: [] }; }
    finally { marksBusy.current.delete(pn); }
  };
  const revertRejectedMarks = (order, rejected) => { const bad = new Set((rejected || []).map((x) => String(x.mark || x))); for (const r of order.rows) { if (!r.needKiz || !Array.isArray(r.kiz)) continue; r.kiz = r.kiz.filter((m) => !bad.has(String(m))); } };

  const shipOrder = async (order) => {
    if (!order || ['shipping', 'shipped', 'marks'].includes(order.shipState)) return;
    if (!orderDone(order)) return;
    const hasMarks = order.rows.some((r) => r.needKiz && (r.kiz || []).length);
    if (hasMarks) {
      order.shipState = 'marks'; rerender();
      const save = await savePostingMarks(order);
      if (!save.ok) { order.shipState = 'error'; if (save.rejected?.length) { revertRejectedMarks(order, save.rejected); log('error', `${order.posting.posting_number} · ${M.title} отклонил ${save.rejected.length} марок — перепикайте`); } else log('error', `${order.posting.posting_number} · марки не привязались: ${save.error || ''}`); sound('error', 'Марки не привязались'); rerender(); return; }
    }
    order.shipState = 'shipping'; rerender();
    try {
      const res = await api(`${M.base}/postings/${encodeURIComponent(order.posting.posting_number)}/ship`, { method: 'POST', body: JSON.stringify({ company_id: companyRef.current.id, shop_index: 0 }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.message || `Сервер ответил ${res.status}`);
      order.shipState = 'shipped'; markLocalDone(order.posting.posting_number); log('done', `${order.posting.posting_number} · собрано`); sound('ok', 'Заказ собран');
    } catch (e) { order.shipState = 'error'; log('error', `${order.posting.posting_number} · не собралось: ${e.message}`); sound('error', 'Ошибка'); }
    finally { rerender(); }
  };

  // ---------- пик ----------
  const acceptBarcode = async (code) => {
    let candidates = workRef.current.filter((o) => !orderDone(o) && o.rows.some((r) => r.barcodes.includes(code) && rowOpen(r)));
    let matchRow = (o) => o.rows.find((r) => r.barcodes.includes(code) && rowOpen(r));
    if (!candidates.length) { const info = await resolveProduct(code); if (info?.productId != null) { candidates = workRef.current.filter((o) => !orderDone(o) && o.rows.some((r) => r.productId === info.productId && rowOpen(r))); matchRow = (o) => o.rows.find((r) => r.productId === info.productId && rowOpen(r)); } }
    const order = candidates.find((o) => orderScanned(o) > 0) || candidates[0];
    if (!order) { const known = workRef.current.some((o) => o.rows.some((r) => r.barcodes.includes(code))); log('error', known ? `${code} — это отправление уже собрано` : `${code} — не из этой сборки`); sound('error', known ? 'Ошибка. Уже пикали' : 'Ошибка. Не из поставки'); return; }
    const row = matchRow(order); const before = row.scanned; row.scanned = Math.min(row.need, row.scanned + 1);
    if (row.scanned > before) takeOneFromCell(order, row);
    setCurrent({ order, row });
    recordPick({ company: companyRef.current?.display_name, order: labelOf(order), barcode: code, name: row.item?.name, mp: M.mp });
    if (row.needKiz && row.kiz.length + (row.kizSkipped || 0) < row.scanned) { setPhase('kiz'); activeRowRef.current = row; sound('step', 'Скан ЧЗ'); rerender(); return; }
    afterUnit(order, row); rerender();
  };
  const acceptKiz = async (code) => {
    const row = activeRowRef.current; if (!row || row._checking) return;
    const sgtin = normalizeSgtin(code);
    const order = workRef.current.find((o) => o.rows.includes(row)); if (!order) return;
    row._checking = true; order.sendState = 'проверка ЧЗ'; rerender();
    try {
      const v = await checkKiz(order, row, sgtin);
      if (!v.ok && !v.network) { order.sendState = 'ошибка марки'; log('error', `Марка не принята: ${v.error || 'код не прошёл'}`); sound('error', 'Марка не принята'); return; }
      if (v.network) log('error', 'ЧЗ: сервер недоступен — проверю при сборке');
      else if (v.warning) log('error', `Внимание ЧЗ: ${v.warning}`);
      row.kiz.push(sgtin); order.sendState = 'ЧЗ принят'; setPhase('barcode'); activeRowRef.current = null;
      afterUnit(order, row);
    } finally { row._checking = false; rerender(); }
  };
  const skipKiz = () => { const row = activeRowRef.current; if (!row) return; row.kizSkipped = (row.kizSkipped || 0) + 1; setPhase('barcode'); activeRowRef.current = null; const order = workRef.current.find((o) => o.rows.includes(row)); afterUnit(order, row); rerender(); };

  const handleCode = (raw) => {
    const trimmed = String(raw || '').trim(); if (!trimmed) return;
    const code = fixLayout(trimmed);
    if (isDup(code)) return;
    if (mode === 'otbor') { otborScan(code); return; }
    if (phase === 'kiz' && activeRowRef.current) { acceptKiz(code); return; }
    if (looksLikeKiz(code)) { log('error', 'Марка без товара — сначала пикните ШК'); sound('error', 'Ошибка. Сначала товар'); return; }
    acceptBarcode(code);
  };
  const onSubmitScan = () => { const raw = scan; setScan(''); handleCode(raw); };
  const selectOrder = (order) => { if (!order || orderDone(order)) return; const row = order.rows.find(rowOpen) || order.rows[0]; if (!row) return; setCurrent({ order, row }); sound('step', row.cells ? cellSpeech(firstCellLabel(row.cells)) : 'Далее'); refocus(); };

  // ---------- отбор (как у WB) ----------
  const otborKey = () => (companyRef.current?.id != null ? `tsd.otbor.${M.mp}.${companyRef.current.id}` : null);
  const otborTakenKey = () => (companyRef.current?.id != null ? `tsd.otbortaken.${M.mp}.${companyRef.current.id}` : null);
  const saveOtbor = () => { const k = otborKey(); if (k) lsSet(k, JSON.stringify(otborDoneRef.current)); };
  const saveOtborTaken = () => { const k = otborTakenKey(); if (k) lsSet(k, JSON.stringify(otborTakenRef.current)); };
  const loadOtbor = async (c) => { otborDoneRef.current = {}; otborTakenRef.current = {}; const key = c?.id != null ? `tsd.otbor.${M.mp}.${c.id}` : null; if (key) { try { const raw = JSON.parse((await lsGet(key)) || 'null'); if (raw && typeof raw === 'object') otborDoneRef.current = raw; } catch (_) {} } const tkey = c?.id != null ? `tsd.otbortaken.${M.mp}.${c.id}` : null; if (tkey) { try { const raw = JSON.parse((await lsGet(tkey)) || 'null'); if (raw && typeof raw === 'object') otborTakenRef.current = raw; } catch (_) {} } };
  const pruneOtbor = () => {
    // Ключи считаем из ЖИВОГО workRef (не из снимка pickList текущего рендера):
    // openCompany зовёт prune сразу после замены work, когда снимок ещё старый.
    const keys = new Set();
    for (const o of workRef.current) for (const r of o.rows) { const k = r.barcodes[0] || r.item?.offer_id || r.item?.article || r.item?.name; if (k) keys.add(k); }
    for (const k of Object.keys(otborDoneRef.current)) if (!keys.has(k)) delete otborDoneRef.current[k];
    for (const k of Object.keys(otborTakenRef.current)) if (!keys.has(k)) delete otborTakenRef.current[k];
  };

  const pickList = (() => {
    const map = new Map();
    for (const o of work) for (const r of o.rows) { const key = r.barcodes[0] || r.item?.offer_id || r.item?.article || r.item?.name; if (!key) continue; if (!map.has(key)) map.set(key, { key, item: r.item, name: r.item?.name || '', barcodes: r.barcodes || [], need: 0, orders: 0, places: (r.places && r.places.length) ? r.places : null, productId: r.productId || null }); const e = map.get(key); e.need += Number(r.need) || 0; e.orders += 1; if (!e.places && r.places && r.places.length) { e.places = r.places; e.productId = r.productId; } }
    const list = Array.from(map.values());
    for (const e of list) { if (e.places && e.places.length) { const chosen = pickCells(e.places, e.need, null); e.cellCode = chosen[0]?.code || ''; e.cellsText = chosen.map((pl) => `${pl.code} ×${pl.quantity}`).join(', '); } else { e.cellCode = ''; e.cellsText = ''; } }
    return list.sort((a, b) => ((otborDoneRef.current[a.key] ? 1 : 0) - (otborDoneRef.current[b.key] ? 1 : 0)) || comparePickRoute(a, b));
  })();
  const pickPositions = pickList.length;
  const pickDoneCount = pickList.filter((e) => otborDoneRef.current[e.key]).length;
  const pickUnitsTotal = pickList.reduce((s, e) => s + e.need, 0);
  const pickUnitsCollected = pickList.reduce((s, e) => s + (otborDoneRef.current[e.key] ? e.need : 0), 0);
  const pickAllDone = pickPositions > 0 && pickDoneCount >= pickPositions;
  const nextPick = pickList.find((e) => !otborDoneRef.current[e.key]) || null;
  const speakNextPick = () => { const nx = nextPick; if (!nx) { sound('ok', 'Отбор завершён'); return; } sound('ok', nx.cellCode ? cellSpeech(nx.cellCode) : 'Далее'); };
  const planPickTake = (e, want) => { const need = Number(want) || 0; if (!e.places || !e.places.length || need <= 0) return []; const chosen = pickCells(e.places, need, null); const plan = []; let left = need; for (const pl of chosen) { if (left <= 0) break; const take = Math.min(Number(pl.quantity) || 0, left); if (take > 0) { plan.push({ node_id: pl.node_id, company_id: pl.company_id || 0, code: pl.code, qty: take }); left -= take; } } return plan; };
  const applyPickTake = async (e) => {
    if (otborBusy.current.has(e.key)) return; otborBusy.current.add(e.key);
    try {
      const taken = otborTakenRef.current[e.key] || []; const already = taken.reduce((s, t) => s + (Number(t.qty) || 0), 0); const want = (Number(e.need) || 0) - already;
      if (want <= 0) return; if (!e.places || !e.places.length || !e.productId) return;
      const done = [];
      for (const p of planPickTake(e, want)) { try { const res = await api('/api/cells/stock/take', { method: 'POST', body: JSON.stringify({ node_id: p.node_id, product_id: e.productId, company_id: p.company_id, quality: 'good', quantity: p.qty, source: 'tsd' }) }); if (!res.ok) { const d = await res.json().catch(() => ({})); const detail = d?.detail; const msg = typeof detail === 'string' ? detail : (detail?.message || `ошибка ${res.status}`); log('error', `Не снял с ячейки ${p.code}: ${msg}`); continue; } done.push({ ...p, product_id: e.productId }); const pl = (e.places || []).find((x) => x.node_id === p.node_id); if (pl) pl.quantity = Math.max(0, Number(pl.quantity) - p.qty); } catch (err) { log('error', `Не снял с ячейки ${p.code}: ${err.message}`); } }
      if (done.length) { otborTakenRef.current = { ...otborTakenRef.current, [e.key]: [...taken, ...done] }; saveOtborTaken(); }
    } finally { otborBusy.current.delete(e.key); rerender(); }
  };
  const revertPickTake = async (e) => {
    if (otborBusy.current.has(e.key)) return; otborBusy.current.add(e.key);
    try {
      const taken = otborTakenRef.current[e.key] || []; if (!taken.length) return; const stillTaken = []; let back = 0;
      for (const t of taken) { try { const res = await api('/api/cells/stock/put', { method: 'POST', body: JSON.stringify({ node_id: t.node_id, product_id: t.product_id || e.productId, company_id: t.company_id || 0, quality: 'good', quantity: t.qty, source: 'tsd' }) }); if (!res.ok) { stillTaken.push(t); continue; } back += Number(t.qty) || 0; const pl = (e.places || []).find((x) => x.node_id === t.node_id); if (pl) pl.quantity = Number(pl.quantity || 0) + t.qty; } catch (_) { stillTaken.push(t); } }
      const next = { ...otborTakenRef.current }; if (stillTaken.length) next[e.key] = stillTaken; else delete next[e.key]; otborTakenRef.current = next; saveOtborTaken();
      if (stillTaken.length) log('error', `Не вернулось в ячейки: ${stillTaken.reduce((s, t) => s + (Number(t.qty) || 0), 0)} шт — повторите`);
    } finally { otborBusy.current.delete(e.key); rerender(); }
  };
  const togglePick = (e) => { if (otborBusy.current.has(e.key)) { refocus(); return; } const now = !otborDoneRef.current[e.key]; otborDoneRef.current = { ...otborDoneRef.current, [e.key]: now }; saveOtbor(); if (now) { applyPickTake(e); if (pickAllDone) sound('ok', 'Отбор завершён'); else speakNextPick(); } else revertPickTake(e); setDetail(null); rerender(); refocus(); };
  const otborScan = (code) => { const entry = pickList.find((e) => e.barcodes.includes(code)); if (!entry) { log('error', `${code} — не из этого отбора`); sound('error', 'Не из отбора'); return; } setDetail({ kind: 'pick', e: entry }); sound('step', entry.cellCode ? `Взять ${entry.need}. ${cellSpeech(entry.cellCode)}` : `Взять ${entry.need}`); };
  const resetOtbor = () => { Alert.alert('Сбросить отбор?', 'Снятое вернётся в ячейки.', [{ text: 'Отмена', style: 'cancel' }, { text: 'Сбросить', style: 'destructive', onPress: async () => { const all = otborTakenRef.current; const remainTaken = {}; const remainDone = {}; for (const key of Object.keys(all)) { const stillTaken = []; for (const t of (all[key] || [])) { try { const res = await api('/api/cells/stock/put', { method: 'POST', body: JSON.stringify({ node_id: t.node_id, product_id: t.product_id, company_id: t.company_id || 0, quality: 'good', quantity: t.qty, source: 'tsd' }) }); if (!res.ok) stillTaken.push(t); } catch (_) { stillTaken.push(t); } } if (stillTaken.length) { remainTaken[key] = stillTaken; remainDone[key] = otborDoneRef.current[key]; } } otborDoneRef.current = remainDone; otborTakenRef.current = remainTaken; saveOtbor(); saveOtborTaken(); rerender(); refocus(); } }]); };

  const switchMode = (m) => { setMode(m); refocus(); rerender(); };
  const refresh = async () => { if (loading) return; if (step === 'work') { for (const [k, v] of cellsByBarcode.current) if (!v || !v.places || !v.places.length) cellsByBarcode.current.delete(k); loadCells(); } else await loadCompanies(); };
  const goBack = () => { if (step === 'work') { setStep('companies'); setCurrent(null); setError(''); } else if (onMarket) onMarket('wb'); setError(''); };

  const filteredCompanies = (() => { const q = companyQuery.toLowerCase().trim(); if (!q) return companies; return companies.filter((c) => String(c.display_name || '').toLowerCase().includes(q)); })();
  const headerTitle = step === 'companies' ? `ФБС · ${M.title}` : (companyRef.current?.display_name || M.title);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={headerTitle} onBack={goBack}
        right={<Pressable onPress={refresh} hitSlop={8} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: '#ffffff22', alignItems: 'center', justifyContent: 'center' }}>{loading ? <ActivityIndicator color={colors.onDark} size="small" /> : <Text style={{ color: colors.onDark, fontSize: 18 }}>↻</Text>}</Pressable>} />

      {error ? <View style={{ paddingHorizontal: 12, paddingTop: 8 }}><Banner kind="error" text={error} /></View> : null}

      {step === 'companies' ? (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 24, gap: 8 }}>
          <View style={segWrap}>
            <Pressable style={segBtn} onPress={() => onMarket && onMarket('wb')}><Text style={segTxt}>WB</Text></Pressable>
            <Pressable style={[segBtn, market === 'ozon' && segOn]} onPress={() => onMarket && onMarket('ozon')}><Text style={[segTxt, market === 'ozon' && segTxtOn]}>Ozon</Text></Pressable>
            <Pressable style={[segBtn, market === 'yandex' && segOn]} onPress={() => onMarket && onMarket('yandex')}><Text style={[segTxt, market === 'yandex' && segTxtOn]}>Яндекс</Text></Pressable>
          </View>
          <TextInput value={companyQuery} onChangeText={setCompanyQuery} placeholder="Поиск по имени…" placeholderTextColor={colors.muted} style={fieldStyle} />
          {filteredCompanies.map((c) => (
            <Pressable key={c.id} onPress={() => openCompany(c)} style={[rowCard, shadow.card]}>
              <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 14, color: colors.ink }} numberOfLines={1}>{c.display_name || ('Компания #' + c.id)}</Text>
              <Badge text={`${c.assembly_count} зак.`} />
            </Pressable>
          ))}
          {!loading && companies.length && !filteredCompanies.length ? <Text style={hintTxt}>Никого не нашлось по «{companyQuery}»</Text> : null}
          {!loading && !companies.length && !error ? <Text style={hintTxt}>Сейчас ни у кого нет заказов на сборке</Text> : null}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={[segWrap, { margin: 12, marginBottom: 4 }]}>
            <Pressable style={[segBtn, mode === 'otbor' && segOn]} onPress={() => switchMode('otbor')}><Text style={[segTxt, mode === 'otbor' && segTxtOn]}>🛒 Отбор</Text></Pressable>
            <Pressable style={[segBtn, mode === 'sborka' && segOn]} onPress={() => switchMode('sborka')}><Text style={[segTxt, mode === 'sborka' && segTxtOn]}>📦 Сборка</Text></Pressable>
          </View>

          {mode === 'sborka' ? (
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 24, gap: 10 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Counter n={totalOrders} label="всего" />
                <Counter n={doneOrders} label="готово" ok={allDone} />
                <Counter n={`${doneUnits}/${totalUnits}`} label="штук" />
              </View>

              {target ? <TargetCard current={target} face={targetFace} setFace={setTargetFace} cellsLoading={cellsLoading} onPhoto={() => photoOf(target.row.item) && setLightbox({ src: photoOf(target.row.item), name: target.row.item.name })} phase={phase} label={labelOf(target.order)} /> : null}

              <View style={{ backgroundColor: phase === 'kiz' ? colors.accent + '22' : colors.bg, borderRadius: radius.md, padding: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 13, color: phase === 'kiz' ? colors.primary : colors.ink }}>{phase === 'kiz' ? 'Возьмите товар и пикните марку ЧЗ' : allDone ? 'Всё собрано' : 'Пикните ШК товара'}</Text>
                {phase === 'kiz' ? <Pressable onPress={skipKiz} style={ghostBtn}><Text style={ghostBtnTxt}>Пропустить ЧЗ</Text></Pressable> : null}
              </View>

              <ScanField ref={scanRef} value={scan} onChangeText={setScan} onSubmit={onSubmitScan} showKeyboard={showKb} onToggleKeyboard={() => setShowKb((s) => !s)} placeholder={phase === 'kiz' ? 'Пикните марку ЧЗ…' : 'Пикните ШК товара…'} />
              {errorLog.length ? <View style={{ gap: 4 }}>{errorLog.map((e) => <Text key={e.t} style={{ fontFamily: font.medium, fontSize: 12, color: colors.danger }}>{e.text}</Text>)}</View> : null}

              <Text style={sectionTxt}>Отправления</Text>
              {workSorted.map((o) => {
                const done = orderDone(o); const shipped = o.shipState === 'shipped';
                return (
                  <Pressable key={o.posting.posting_number} onPress={() => selectOrder(o)} onLongPress={() => setDetail({ kind: 'order', o })} style={[planRow, (done || shipped) && { opacity: 0.6 }, current?.order === o && { borderColor: colors.primary }]}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <Text style={{ fontFamily: font.bold, fontSize: 13, color: colors.ink }} numberOfLines={1}>{o.posting.posting_number}</Text>
                      <Text style={{ fontFamily: font.semibold, fontSize: 12, color: done ? colors.success : colors.muted }}>{orderScanned(o)}/{orderNeed(o)}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                      {photoOf(o.rows[0]?.item) ? <Image source={{ uri: photoOf(o.rows[0].item) }} style={thumb} /> : null}
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: font.semibold, fontSize: 13, color: colors.ink }} numberOfLines={2}>{o.rows[0]?.item?.name || '—'}</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                          {o.rows.map((r, i) => { const st = kizState(o, r); return st ? <Chip key={i} text="ЧЗ" kind={st} /> : null; })}
                          {o.rows[0]?.cells ? <Chip text={`📍 ${firstCellLabel(o.rows[0].cells)}`} kind="cell" /> : null}
                        </View>
                      </View>
                      {done && !shipped ? (
                        <Pressable onPress={() => shipOrder(o)} disabled={['shipping', 'marks'].includes(o.shipState)} style={[submitBtn, { paddingHorizontal: 14, minHeight: 42 }, ['shipping', 'marks'].includes(o.shipState) && { opacity: 0.5 }]}><Text style={submitTxt}>{o.shipState === 'marks' ? 'Марки…' : o.shipState === 'shipping' ? '…' : 'Собрать'}</Text></Pressable>
                      ) : shipped ? <Text style={{ fontFamily: font.bold, color: colors.success }}>✓</Text> : o.shipState === 'error' ? <Pressable onPress={() => shipOrder(o)} style={[outlineBtn, { paddingHorizontal: 12, minHeight: 42 }]}><Text style={[outlineTxt, { color: colors.danger }]}>Повтор</Text></Pressable> : null}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 24, gap: 10 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Counter n={`${pickDoneCount}/${pickPositions}`} label="позиций" />
                <Counter n={`${pickUnitsCollected}/${pickUnitsTotal}`} label="штук" ok={pickAllDone} />
              </View>
              <ScanField ref={scanRef} value={scan} onChangeText={setScan} onSubmit={onSubmitScan} showKeyboard={showKb} onToggleKeyboard={() => setShowKb((s) => !s)} placeholder="Пикните ШК товара для отбора…" />
              {errorLog.length ? <Text style={{ fontFamily: font.medium, fontSize: 12, color: colors.danger }}>{errorLog[0].text}</Text> : null}
              {nextPick ? <View style={{ backgroundColor: colors.accent + '18', borderRadius: radius.md, padding: 10 }}><Text style={{ fontFamily: font.semibold, fontSize: 13, color: colors.primary }}>Дальше: {nextPick.name} {nextPick.cellCode ? `· ${firstCellLabel(nextPick.cellsText)}` : ''} ×{nextPick.need}</Text></View> : null}
              {pickList.map((e) => { const picked = !!otborDoneRef.current[e.key]; return (
                <View key={e.key} style={[planRow, picked && { opacity: 0.55 }]}>
                  <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                    {photoOf(e.item) ? <Pressable onPress={() => setLightbox({ src: photoOf(e.item), name: e.name })}><Image source={{ uri: photoOf(e.item) }} style={thumb} /></Pressable> : null}
                    <View style={{ flex: 1 }}><Text style={{ fontFamily: font.semibold, fontSize: 13, color: colors.ink }} numberOfLines={2}>{e.name || '—'}</Text><Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.muted }}>{e.cellsText ? `📍 ${e.cellsText}` : 'нет ячейки'} · ×{e.need}</Text></View>
                    <Pressable onPress={() => togglePick(e)} style={[picked ? outlineBtn : submitBtn, { paddingHorizontal: 14, minHeight: 44 }]}><Text style={picked ? outlineTxt : submitTxt}>{picked ? 'Снять' : 'Собрал ✓'}</Text></Pressable>
                  </View>
                </View>
              ); })}
              {pickList.length ? <Pressable onPress={resetOtbor} style={{ padding: 10, alignItems: 'center' }}><Text style={{ fontFamily: font.medium, color: colors.danger }}>Сбросить отбор</Text></Pressable> : null}
              {!pickList.length ? <Text style={hintTxt}>Нет позиций для отбора.</Text> : null}
            </ScrollView>
          )}
        </View>
      )}

      <Modal visible={!!detail} transparent animationType="slide" onRequestClose={() => setDetail(null)}>
        <Pressable style={sheetBackdrop} onPress={() => setDetail(null)}>
          <Pressable style={[sheetBody, { paddingBottom: insets.bottom + 14 }]} onPress={() => {}}>
            {detail ? (() => {
              const isPick = detail.kind === 'pick';
              const item = isPick ? detail.e.item : (detail.o.rows[0]?.item);
              const nm = isPick ? detail.e.name : (item?.name || '');
              const cell = isPick ? (detail.e.cellsText || detail.e.cellCode) : (detail.o.rows[0]?.cells || '');
              const shk = isPick ? (detail.e.barcodes?.[0] || '') : String(item?.barcode || '').trim();
              const qty = isPick ? ('×' + detail.e.need) : (orderScanned(detail.o) + '/' + orderNeed(detail.o));
              return (
                <>
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    {photoOf(item) ? <Pressable onPress={() => setLightbox({ src: photoOf(item), name: nm })}><Image source={{ uri: photoOf(item) }} style={{ width: 70, height: 70, borderRadius: 10, backgroundColor: colors.bg }} /></Pressable> : null}
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: font.bold, fontSize: 15, color: colors.ink }} numberOfLines={3}>{nm}</Text>
                      {cell ? <Text style={{ fontFamily: font.semibold, fontSize: 13, color: colors.primary, marginTop: 2 }}>📍 {cell}</Text> : null}
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {!isPick ? <Text style={detLine}>{detail.o.posting.posting_number}</Text> : null}
                    {shk ? <Text style={detLine}>ШК {shkHead(shk)}<Text style={{ fontFamily: font.bold, color: colors.ink }}>{shkTail(shk)}</Text></Text> : null}
                    {itemSize(item) ? <Text style={detLine}>Размер {itemSize(item)}</Text> : null}
                    {itemArt(item) ? <Text style={detLine}>арт {itemArt(item)}</Text> : null}
                    <Text style={detLine}>{qty}</Text>
                  </View>
                  {isPick ? <Pressable onPress={() => togglePick(detail.e)} style={submitBtn}><Text style={submitTxt}>{otborDoneRef.current[detail.e.key] ? 'Снять отметку' : 'Собрал ✓'}</Text></Pressable>
                    : orderDone(detail.o) && detail.o.shipState !== 'shipped' ? <Pressable onPress={() => { shipOrder(detail.o); setDetail(null); }} style={submitBtn}><Text style={submitTxt}>Собрать (отгрузить)</Text></Pressable> : null}
                </>
              );
            })() : null}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!lightbox} transparent animationType="fade" onRequestClose={() => setLightbox(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(10,20,20,0.92)', alignItems: 'center', justifyContent: 'center', padding: 16, gap: 12 }} onPress={() => setLightbox(null)}>
          {lightbox ? <Image source={{ uri: lightbox.src }} style={{ width: '100%', height: '70%' }} resizeMode="contain" /> : null}
          {lightbox?.name ? <Text style={{ color: '#fff', fontFamily: font.regular, textAlign: 'center' }}>{lightbox.name}</Text> : null}
        </Pressable>
      </Modal>
    </View>
  );
}

function TargetCard({ current, face, setFace, cellsLoading, onPhoto, phase, label }) {
  const row = current.row; const cells = row.cells;
  return (
    <View style={{ backgroundColor: colors.surface, borderWidth: 2, borderColor: phase === 'kiz' ? colors.accent : colors.primary, borderRadius: radius.lg, padding: 12, flexDirection: 'row', gap: 12 }}>
      <Pressable onPress={() => setFace(face === 'cell' ? 'photo' : 'cell')} style={{ width: 92, height: 92, borderRadius: radius.md, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {face === 'photo' ? (photoOf(row.item) ? <Image source={{ uri: photoOf(row.item) }} style={{ width: '100%', height: '100%' }} /> : <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.muted }}>нет фото</Text>)
          : cells ? (<><Text style={{ fontFamily: font.medium, fontSize: 9, color: colors.muted }}>СТЕЛЛАЖ</Text><Text style={{ fontFamily: font.bold, fontSize: 34, color: colors.primary }}>{cellRack(cells)}</Text>{cellNums(cells) ? <Text style={{ fontFamily: font.semibold, fontSize: 12, color: colors.ink }}>{cellNums(cells)}</Text> : null}{cellQty(cells) ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.muted }}>×{cellQty(cells)}</Text> : null}</>)
            : (<><Text style={{ fontFamily: font.medium, fontSize: 9, color: colors.muted }}>{cellsLoading ? 'ИЩУ' : 'ЯЧЕЙКА'}</Text><Text style={{ fontFamily: font.bold, fontSize: 30, color: colors.muted }}>{cellsLoading ? '…' : '—'}</Text></>)}
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: font.semibold, fontSize: 14, color: colors.ink }} numberOfLines={2}>{row.item.name || '—'}</Text>
        {cells ? <Text style={{ fontFamily: font.medium, fontSize: 12, color: colors.primary, marginTop: 2 }}>{cellSpeech(firstCellLabel(cells))}</Text> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4, alignItems: 'center' }}>
          <Text style={{ fontFamily: font.bold, fontSize: 12, color: colors.ink }}>{label}</Text>
          {itemSize(row.item) ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.muted }}>р.{itemSize(row.item)}</Text> : null}
          {row.barcodes[0] ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.muted }}>{shkHead(row.barcodes[0])}<Text style={{ fontFamily: font.bold, color: colors.ink }}>{shkTail(row.barcodes[0])}</Text></Text> : null}
        </View>
      </View>
    </View>
  );
}
function Counter({ n, label, ok }) { return (<View style={[{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: ok ? colors.success : colors.border, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center' }, shadow.card]}><Text style={{ fontFamily: font.bold, fontSize: 17, color: ok ? colors.success : colors.ink }}>{n}</Text><Text style={{ fontFamily: font.medium, fontSize: 11, color: colors.muted }}>{label}</Text></View>); }
function Badge({ text }) { return <View style={{ backgroundColor: colors.primary + '18', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}><Text style={{ fontFamily: font.bold, fontSize: 11, color: colors.primary }}>{text}</Text></View>; }
function Chip({ text, kind }) { const map = { pending: [colors.accent + '22', colors.primary], scanned: [colors.success + '22', colors.primary], rejected: [colors.danger + '22', colors.danger], cell: [colors.primary + '14', colors.primary] }; const [bg, fg] = map[kind] || [colors.border, colors.muted]; return <View style={{ backgroundColor: bg, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}><Text style={{ fontFamily: font.semibold, fontSize: 10, color: fg }}>{text}</Text></View>; }
function Banner({ kind, text }) { const err = kind === 'error'; return <View style={{ backgroundColor: err ? colors.danger + '15' : colors.success + '18', borderWidth: 1, borderColor: err ? colors.danger + '40' : colors.success + '55', borderRadius: radius.md, padding: 11 }}><Text style={{ fontFamily: font.medium, fontSize: 13, color: err ? colors.danger : colors.primary }}>{text}</Text></View>; }

const fieldStyle = { paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, fontFamily: font.regular, fontSize: 15, color: colors.ink, backgroundColor: colors.surface };
const hintTxt = { fontFamily: font.regular, fontSize: 13, color: colors.muted, paddingVertical: 6, lineHeight: 18 };
const sectionTxt = { fontFamily: font.semibold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.muted, marginTop: 4 };
const rowCard = { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 14 };
const planRow = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10 };
const thumb = { width: 46, height: 46, borderRadius: 8, backgroundColor: colors.bg };
const segWrap = { flexDirection: 'row', gap: 4, padding: 4, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 999 };
const segBtn = { flex: 1, paddingVertical: 9, borderRadius: 999, alignItems: 'center' };
const segOn = { backgroundColor: colors.surface, ...shadow.card };
const segTxt = { fontFamily: font.bold, fontSize: 12, color: colors.muted };
const segTxtOn = { color: colors.primary };
const ghostBtn = { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border };
const ghostBtnTxt = { fontFamily: font.semibold, fontSize: 12, color: colors.muted };
const submitBtn = { minHeight: 48, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 };
const submitTxt = { fontFamily: font.bold, fontSize: 15, color: '#fff' };
const outlineBtn = { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 };
const outlineTxt = { fontFamily: font.semibold, fontSize: 14, color: colors.ink };
const detLine = { fontFamily: font.regular, fontSize: 12, color: colors.muted };
const sheetBackdrop = { flex: 1, backgroundColor: 'rgba(10,20,20,0.45)', justifyContent: 'flex-end' };
const sheetBody = { backgroundColor: colors.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, gap: 12 };
