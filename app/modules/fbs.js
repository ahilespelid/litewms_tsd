import { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Modal, Image, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenHeader from '../../components/ScreenHeader';
import ScanField from '../../components/ScanField';
import { api } from '../../lib/api';
import { speak, formatCellSpeech, getCellVoiceMode } from '../../lib/cells';
import { useScanDedup } from '../../lib/scanner';
import { lsGet, lsSet } from '../../lib/storage';
import { getVerifySticker, getTakeFromCell, getSpeakCellSborka } from '../../lib/fbsSettings';
import { recordPick } from '../../lib/picks';
import { loadPricing, priceForItem } from '../../lib/pricing';
import { colors, font, radius, shadow } from '../../theme';

// ФБС WB (порт FbsModule.vue). Компании → поставки на сборке → окно: вкладки
// «Сборка» (пик ШК+стикер со сверкой пары, затем марка ЧЗ → bulk-очередь WB) и
// «Отбор» (снять товар с ячеек по маршруту). Печать по BT — только в dev-build.
const sound = (kind, text) => { if (text) speak(String(text)); };
const photoOf = (it) => it?.image_url || it?.image || it?.primary_image || '';
const shkTail = (c) => String(c || '').slice(-4);
const shkHead = (c) => { const s = String(c || ''); return s.length > 4 ? s.slice(0, -4) : ''; };
const stickerValue = (p) => `${String(p?.sticker_part_a || '').trim()}${String(p?.sticker_number || '').trim()}`;
const stickerHead = (p) => { const v = stickerValue(p); return v.length > 4 ? v.slice(0, -4) : ''; };
const stickerTail = (p) => { const v = stickerValue(p); return v.length > 4 ? v.slice(-4) : v; };
const itemArt = (it) => String(it?.article || it?.offer_id || '').trim();
const itemSize = (it) => String(it?.size || it?.tech_size || it?.wb_size || '').trim();
const cellSpeech = (code) => formatCellSpeech(code, getCellVoiceMode());

const CANCELLED_STATUSES = new Set(['cancel', 'cancel_carrier']);
function isCancelled(p) {
  if (p?.cancelled === true) return true;
  const stage = String(p?.workflow_stage || p?.status || '').toLowerCase().trim();
  return CANCELLED_STATUSES.has(stage);
}
function hasSgtin(arr) { return Array.isArray(arr) && arr.some((m) => String(m).trim().toLowerCase() === 'sgtin'); }
function productBarcodes(item) {
  return [item.barcode, item.barcode_wb, item.sku_id, ...(Array.isArray(item.barcodes) ? item.barcodes : [])]
    .map((b) => String(b || '').trim()).filter(Boolean);
}
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
  if (enough.length) {
    if (near) enough.sort((a, b) => cellDistance(a.code, near) - cellDistance(b.code, near) || Number(b.quantity) - Number(a.quantity));
    else enough.sort((a, b) => Number(b.quantity) - Number(a.quantity));
    return [enough[0]];
  }
  const sorted = [...places].sort((a, b) => Number(b.quantity) - Number(a.quantity));
  const picked = []; let left = need || 1;
  for (const pl of sorted) { picked.push(pl); left -= Number(pl.quantity); if (left <= 0) break; }
  return picked;
}
function firstCellLabel(cells) { const first = String(cells || '').split(',')[0] || ''; return first.split('×')[0].trim().toUpperCase(); }
function cellRack(cells) { return String(firstCellLabel(cells)).split('-')[0] || '—'; }
function cellNums(cells) { return String(firstCellLabel(cells)).split('-').slice(1).join('-'); }
function cellQty(cells) { const m = String(cells || '').split(',')[0].match(/×\s*(\d+)/); return m ? m[1] : ''; }
function normSticker(v) { return String(v || '').trim().replace(/\s+/g, '').replace(/^\*+|\*+$/g, '').toLowerCase(); }
function comparePickRoute(a, b) {
  const A = a.cellCode, B = b.cellCode;
  if (!A && !B) return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
  if (!A) return 1; if (!B) return -1;
  const pa = A.split('-'), pb = B.split('-');
  const ra = (pa[0] || '').toUpperCase(), rb = (pb[0] || '').toUpperCase();
  if (ra !== rb) return ra < rb ? -1 : 1;
  const n = Math.max(pa.length, pb.length);
  for (let i = 1; i < n; i++) { const da = Number(pa[i]) || 0, db = Number(pb[i]) || 0; if (da !== db) return da - db; }
  return 0;
}

// --- разбор кода ЧЗ (перенос с сайта дословно) ---
const RU_TO_EN_BY_KEY = { 'й':'q','ц':'w','у':'e','к':'r','е':'t','н':'y','г':'u','ш':'i','щ':'o','з':'p','х':'[','ъ':']','ф':'a','ы':'s','в':'d','а':'f','п':'g','р':'h','о':'j','л':'k','д':'l','ж':';','э':"'",'я':'z','ч':'x','с':'c','м':'v','и':'b','т':'n','ь':'m','б':',','ю':'.','ё':'`','Й':'Q','Ц':'W','У':'E','К':'R','Е':'T','Н':'Y','Г':'U','Ш':'I','Щ':'O','З':'P','Х':'{','Ъ':'}','Ф':'A','Ы':'S','В':'D','А':'F','П':'G','Р':'H','О':'J','Л':'K','Д':'L','Ж':':','Э':'"','Я':'Z','Ч':'X','С':'C','М':'V','И':'B','Т':'N','Ь':'M','Б':'<','Ю':'>','Ё':'~','.':'/',',':'?','"':'@','№':'#',';':'$',':':'^','?':'&','/':'|' };
function fixKeyboardLayout(raw) {
  const value = String(raw || '');
  if (!/[А-Яа-яЁё]/.test(value)) return value;
  let out = ''; for (const ch of value) out += RU_TO_EN_BY_KEY[ch] ?? ch; return out;
}
function stripChzPrefix(code) {
  let t = String(code || '').trim();
  t = t.replace(/^\][A-Za-z][0-9]/, '');
  t = t.replace(/^[^\d(\x1D]+(?=01\d{14})/, '');
  return t;
}
function looksLikeChz(code) {
  const s = stripChzPrefix(code);
  if (!s) return false;
  if (s.includes('\x1D') || s.includes('(01)')) return true;
  return /^01\d{14}/.test(s) && s.length > 20;
}
function sanitizeSgtinRaw(value) {
  const GS = '\u001D';
  let s = String(value || '').replace(/﻿/g, '').replace(/[\r\n\t]+$/g, '').trim();
  s = s.replace(/^\][A-Za-z][0-9]/, '');
  s = s.replace(/^[^\d(\x1D]+(?=01\d{14})/, '');
  s = s.replace(/␝/g, GS).replace(/<GS>/gi, GS).replace(/\{GS\}/gi, GS).replace(/\^029/g, GS);
  return s;
}
function normalizeSgtin(raw) {
  if (!raw) return '';
  let s = sanitizeSgtinRaw(raw);
  if (!s.includes('\x1D') && /^01\d{14}/.test(s) && s.includes(' ')) s = s.replace(/ +/g, '\u001D');
  if (s.includes('\x1D')) return s;
  if (s.includes('(01)') || s.includes('(21)') || s.includes('(91)') || s.includes('(92)')) {
    const GS = '\u001D'; const segments = []; const re = /\((\d{2})\)([^()]+)/g; let m;
    while ((m = re.exec(s)) !== null) segments.push({ ai: m[1], value: m[2].replace(/\s+/g, '') });
    if (!segments.length) return s;
    const fixed = new Set(['01']); let result = '';
    for (let i = 0; i < segments.length; i++) { const seg = segments[i]; result += seg.ai + seg.value; if (i < segments.length - 1 && !fixed.has(seg.ai)) result += GS; }
    return result;
  }
  return s;
}

const SGTIN_BATCH_SIZE = 20;
const SGTIN_IDLE_MS = 900;
const POLL_MS = 30000;

export default function FbsScreen({ mod }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scanRef = useRef(null);
  const isDup = useScanDedup();
  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => (n + 1) % 1e9), []);

  const [market] = useState('wb'); // Ozon/Яндекс — отдельным шагом
  const [step, setStep] = useState('companies'); // companies | supplies | work
  const [mode, setMode] = useState('sborka');     // sborka | otbor
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [errorLog, setErrorLog] = useState([]); // последние ошибки (до 3)

  const [companies, setCompanies] = useState([]);
  const [companyQuery, setCompanyQuery] = useState('');
  const companyRef = useRef(null);
  const [supplies, setSupplies] = useState([]);
  const supplyRef = useRef(null);
  const [skippedCancelled, setSkippedCancelled] = useState(0);
  const [finishedSupplies, setFinishedSupplies] = useState({});

  const workRef = useRef([]);
  const [scan, setScan] = useState('');
  const [showKb, setShowKb] = useState(false);
  const [phase, setPhase] = useState('barcode'); // barcode | sgtin
  const [current, setCurrent] = useState(null);   // { order, row }
  const [targetFace, setTargetFace] = useState('cell');
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [metaLoading, setMetaLoading] = useState(false);
  const [cellsLoading, setCellsLoading] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [detail, setDetail] = useState(null);
  const pricingRef = useRef(null);

  const activeOrderRef = useRef(null);
  const pairPendingRef = useRef(null);   // { kind:'barcode'|'sticker', code, order }
  const lastScannedRef = useRef(null);   // { order, row }
  const lastCellCodeRef = useRef(null);
  const localDoneRef = useRef({});
  const cellsByBarcode = useRef(new Map());
  const whRef = useRef(null);

  // грузоместа ПВЗ
  const [deliveryMode, setDeliveryMode] = useState('sc');
  const [boxes, setBoxes] = useState([]);
  const boxOfOrderRef = useRef({});
  const [currentBoxN, setCurrentBoxN] = useState(1);

  // отбор
  const otborDoneRef = useRef({});
  const otborTakenRef = useRef({});
  const otborBusy = useRef(new Set());

  // очередь марок
  const sgtinQueue = useRef([]);
  const sgtinFlushTimer = useRef(null);
  const sgtinFlushing = useRef(false);

  const work = workRef.current;

  const log = (kind, text) => { if (kind === 'error') setErrorLog((prev) => [{ text, t: Date.now() }, ...prev].slice(0, 3)); };
  const refocus = useCallback(() => { setTimeout(() => scanRef.current?.focus(), 250); }, []);

  // ---------- компании ----------
  const loadCompanies = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api('/api/wb-fbs/companies?scope=all');
      if (!res.ok) throw new Error(`Сервер ответил ${res.status}`);
      const list = await res.json();
      const fbsClients = list.filter((c) => c.has_wb_api && c.owner_works_with_fbs);
      const withAssembly = await Promise.all(fbsClients.map(async (c) => {
        try {
          const r = await api(`/api/wb-fbs/companies/${c.id}/stage-counts?shop_index=0`);
          if (!r.ok) return null;
          const d = await r.json();
          const assembly = Number(d?.counts?.confirm || 0);
          return assembly > 0 ? { ...c, assembly_count: assembly } : null;
        } catch (_) { return null; }
      }));
      setCompanies(withAssembly.filter(Boolean).sort((a, b) => (b.assembly_count - a.assembly_count) || String(a.display_name || '').localeCompare(String(b.display_name || ''), 'ru')));
    } catch (e) { setError('Не удалось загрузить компании: ' + e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadCompanies(); (async () => { try { const raw = JSON.parse((await lsGet('tsd.fbsSupplyDone')) || '{}'); setFinishedSupplies(raw || {}); } catch (_) {} })(); }, [loadCompanies]);

  // ---------- поставки ----------
  const fetchMetaOrders = useCallback(async (ids) => {
    const out = []; const BATCH = 100;
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      const res = await api('/api/wb-fbs/postings/meta', { method: 'POST', body: JSON.stringify({ company_id: companyRef.current.id, shop_index: 0, order_ids: chunk }) });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data.orders)) out.push(...data.orders);
    }
    return out;
  }, []);

  const readLocalDone = useCallback(async () => {
    try { const raw = JSON.parse((await lsGet('tsd.fbsDone')) || '{}'); return raw || {}; } catch (_) { return {}; }
  }, []);

  const loadSuppliesProgress = useCallback(async (list) => {
    const supl = list || supplies;
    const все = supl.flatMap((s) => s.orders);
    const ids = все.map((p) => p.order_id).filter(Boolean);
    if (!ids.length || !companyRef.current) return;
    const локально = localDoneRef.current;
    for (const s of supl) s.done = s.orders.filter((p) => локально[p.order_id]).length;
    setSupplies([...supl]);
    try {
      const orders = await fetchMetaOrders(ids);
      const закрытые = new Set(), отклонённые = new Set();
      for (const o of orders) {
        const det = (o.metaDetails || []).find((md) => String(md.key || '').trim().toLowerCase() === 'sgtin');
        const value = det && (Array.isArray(det.value) ? det.value[0] : det.value);
        if (!value) continue;
        if (det.can_deliver === false) отклонённые.add(Number(o.id)); else закрытые.add(Number(o.id));
      }
      for (const s of supl) {
        s.done = s.orders.filter((p) => закрытые.has(Number(p.order_id)) || локально[p.order_id]).length;
        s.rejected = s.orders.filter((p) => отклонённые.has(Number(p.order_id))).length;
      }
      setSupplies([...supl]);
    } catch (_) {}
  }, [supplies, fetchMetaOrders]);

  const openCompany = useCallback(async (c) => {
    companyRef.current = c; setStep('supplies'); setSupplies([]); setLoading(true); setError('');
    localDoneRef.current = await readLocalDone();
    try {
      const res = await api(`/api/wb-fbs/companies/${c.id}/postings-local?shop_index=0&stages=confirm`);
      if (!res.ok) throw new Error(`Сервер ответил ${res.status}`);
      const all = await res.json();
      const postings = all.filter((p) => !isCancelled(p));
      const map = new Map();
      for (const p of postings) {
        const s = p.supply && typeof p.supply === 'object' ? p.supply : null;
        const supplyId = String(s?.supplyId || s?.id || '').trim() || 'нет поставки';
        const groupId = supplyId !== 'нет поставки' ? String(p.supply_group_id || '').trim() : '';
        const key = groupId ? 'MP:' + groupId : supplyId;
        if (!map.has(key)) map.set(key, { sid: key, multi: Boolean(groupId), label: String(p.supply_group_label || '').trim(), name: String(s?.name || '').trim(), warehouse: String(s?.warehouse || '').trim(), supplyIds: new Set(), orders: [] });
        const entry = map.get(key); entry.orders.push(p); entry.supplyIds.add(supplyId);
      }
      const list = Array.from(map.values()).map((e) => ({ ...e, supplyCount: e.supplyIds.size }));
      setSupplies(list); setSkippedCancelled(all.length - postings.length);
      loadSuppliesProgress(list);
    } catch (e) { setError('Не удалось загрузить заявки: ' + e.message); }
    finally { setLoading(false); }
  }, [readLocalDone, loadSuppliesProgress]);

  // ---------- окно поставки ----------
  const placesFor = async (barcode) => {
    try {
      const res = await api(`/api/cells/scan?code=${encodeURIComponent(barcode)}`);
      if (!res.ok) return { productId: null, places: [] };
      const d = await res.json();
      if (!d?.found || d.kind !== 'product') return { productId: null, places: [] };
      return { productId: d.product?.id || null, places: (d.places || []).filter((pl) => Number(pl.quantity) > 0) };
    } catch (_) { return { productId: null, places: [] }; }
  };

  const loadCells = useCallback(async () => {
    const barcodes = [];
    for (const o of workRef.current) for (const r of o.rows) for (const b of r.barcodes) if (b && !cellsByBarcode.current.has(b)) barcodes.push(b);
    const список = Array.from(new Set(barcodes));
    setCellsLoading(true);
    try {
      const очередь = [...список];
      const работник = async () => { while (очередь.length) { const b = очередь.shift(); cellsByBarcode.current.set(b, await placesFor(b)); } };
      await Promise.all([работник(), работник(), работник(), работник()]);
      for (const o of workRef.current) for (const r of o.rows) {
        for (const b of r.barcodes) {
          const info = cellsByBarcode.current.get(b);
          if (info && info.places.length) { r.places = info.places; r.cellNodes = pickCells(info.places, r.need, null); r.productId = info.productId; r.cells = r.cellNodes.map((pl) => `${pl.code} ×${pl.quantity}`).join(', '); break; }
        }
      }
      rerender();
    } catch (_) {} finally { setCellsLoading(false); }
  }, [rerender]);

  const applyOrderVerdict = (entry, det) => {
    const rawValue = det?.value;
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    if (!value) return;
    if (det.can_deliver === false) {
      if (Date.now() - (entry._sentAt || 0) < 45000) return;
      markRowsRejected(entry, rawValue);
      entry.sendState = 'ЧЗ отклонён';
      return;
    }
    entry.serverClosed = true;
    clearRowsRejected(entry);
    for (const r of entry.rows) r.scanned = r.need;
    entry.sendState = det.decision === 'sgtinIntroduced' ? 'ЧЗ принят' : 'ЧЗ записан';
  };

  const loadSupplyMeta = useCallback(async (silent = false) => {
    const ids = workRef.current.map((w) => w.posting.order_id).filter(Boolean);
    if (!ids.length || !companyRef.current) return;
    if (!silent) setMetaLoading(true);
    try {
      const orders = await fetchMetaOrders(ids);
      for (const o of orders) {
        const det = (o.metaDetails || []).find((md) => String(md.key || '').trim().toLowerCase() === 'sgtin');
        if (!det) continue;
        const entry = workRef.current.find((w) => Number(w.posting.order_id) === Number(o.id));
        if (!entry) continue;
        if (sgtinQueue.current.some((b) => b.order === entry)) continue;
        applyOrderVerdict(entry, det);
      }
      rerender();
    } catch (_) {} finally { if (!silent) setMetaLoading(false); }
  }, [fetchMetaOrders, rerender]);

  const openSupply = useCallback(async (s) => {
    supplyRef.current = s;
    const локально = localDoneRef.current;
    workRef.current = s.orders.map((p) => {
      const localDone = Boolean(локально[p.order_id]);
      const entry = {
        posting: p,
        czRequired: hasSgtin(p.required_meta ?? p.requiredMeta),
        czOptional: !hasSgtin(p.required_meta ?? p.requiredMeta) && hasSgtin(p.optional_meta ?? p.optionalMeta),
        serverClosed: false, localDone,
        rows: (p.products || []).map((item) => ({ item, barcodes: productBarcodes(item), need: Number(item.quantity ?? 1), scanned: 0, chz: [] })),
      };
      if (localDone) for (const r of entry.rows) { r.scanned = r.need; if (entry.czRequired || entry.czOptional) r.czSkipped = r.need; }
      return entry;
    });
    setErrorLog([]); lastScannedRef.current = null; setCurrent(null); setPhase('barcode'); activeOrderRef.current = null; pairPendingRef.current = null; setMode('sborka'); setLeaveConfirm(false);
    await loadOtbor(s); await loadTrbx(s);
    setStep('work');
    loadSupplyMeta(); loadCells();
    loadPricing(companyRef.current?.id).then((p) => { pricingRef.current = p; });
    refocus(); rerender();
  }, [loadSupplyMeta, loadCells, refocus, rerender]);

  // ---------- производные ----------
  const orderNeed = (o) => o.rows.reduce((s, r) => s + r.need, 0);
  const orderScanned = (o) => o.rows.reduce((s, r) => s + r.scanned, 0);
  const orderNeedsCz = (o) => o.czRequired || o.czOptional;
  const rowClosedCount = (r, o) => (orderNeedsCz(o) ? r.chz.length + (r.czSkipped || 0) : r.scanned);
  const orderRejected = (o) => o.rows.some((r) => r.czRejected);
  const orderDone = (o) => {
    if (orderRejected(o)) return false;
    if (o.serverClosed) return true;
    if (o.localDone) return true;
    if (orderNeed(o) === 0) return false;
    return o.rows.every((r) => rowClosedCount(r, o) >= r.need);
  };
  const rowOpen = (r, o) => (r.czRejected ? true : rowClosedCount(r, o) < r.need);
  const czState = (o) => {
    if (!orderNeedsCz(o)) return null;
    if (orderRejected(o) || /отклон|ошибка|не ушла/.test(o.sendState || '')) return 'rejected';
    const scannedMarks = o.rows.reduce((s, r) => s + ((r.chz && r.chz.length) || 0), 0);
    if (o.serverClosed || (orderNeed(o) > 0 && scannedMarks >= orderNeed(o))) return 'scanned';
    return 'pending';
  };
  const totalOrders = work.length;
  const doneOrders = work.filter(orderDone).length;
  const totalUnits = work.reduce((s, o) => s + orderNeed(o), 0);
  const scannedUnits = work.reduce((s, o) => s + orderScanned(o), 0);
  const allDone = totalOrders > 0 && doneOrders >= totalOrders;
  const workSorted = work.map((o, i) => ({ o, i })).sort((a, b) => ((orderDone(a.o) ? 1 : 0) - (orderDone(b.o) ? 1 : 0)) || (a.i - b.i)).map((x) => x.o);

  const orderLabel = (o) => stickerValue(o.posting) || o.posting.posting_number;
  const postingNoOf = (o) => String(o?.posting?.posting_number || o?.posting?.order_id || '').trim();

  // ---------- local-done / finished / trbx / otbor persistence ----------
  const markLocalDone = (order) => { const id = order?.posting?.order_id; if (!id) return; localDoneRef.current[id] = Date.now(); lsSet('tsd.fbsDone', JSON.stringify(localDoneRef.current)); };
  const clearLocalDone = (order) => { if (order) order.localDone = false; const id = order?.posting?.order_id; if (!id) return; if (id in localDoneRef.current) { delete localDoneRef.current[id]; lsSet('tsd.fbsDone', JSON.stringify(localDoneRef.current)); } };

  const trbxKey = () => (supplyRef.current?.sid ? `tsd.trbx.${supplyRef.current.sid}` : null);
  const saveTrbx = (nextBoxes, nextMode, nextCur) => { const key = trbxKey(); if (!key) return; lsSet(key, JSON.stringify({ mode: nextMode ?? deliveryMode, boxes: nextBoxes ?? boxes, boxOfOrder: boxOfOrderRef.current, current: nextCur ?? currentBoxN })); };
  const loadTrbx = async (s) => {
    setDeliveryMode('sc'); setBoxes([]); boxOfOrderRef.current = {}; setCurrentBoxN(1);
    const key = s?.sid ? `tsd.trbx.${s.sid}` : null; if (!key) return;
    try {
      const raw = JSON.parse((await lsGet(key)) || 'null');
      if (raw && ['sc', 'pvz'].includes(raw.mode)) {
        setDeliveryMode(raw.mode);
        setBoxes(Array.isArray(raw.boxes) ? raw.boxes : []);
        boxOfOrderRef.current = raw.boxOfOrder && typeof raw.boxOfOrder === 'object' ? raw.boxOfOrder : {};
        setCurrentBoxN(Number(raw.current) || (Array.isArray(raw.boxes) && raw.boxes.length ? raw.boxes[raw.boxes.length - 1].n : 1));
      }
    } catch (_) {}
  };
  const assignToBox = (order) => {
    if (deliveryMode !== 'pvz') return;
    const id = order?.posting?.order_id;
    if (id == null || boxOfOrderRef.current[id] != null) return;
    setBoxes((prev) => {
      let list = prev.length ? prev : [{ n: 1, orders: 0, units: 0 }];
      const box = list.find((b) => b.n === currentBoxN) || list[list.length - 1];
      box.orders += 1; box.units += orderNeed(order);
      boxOfOrderRef.current = { ...boxOfOrderRef.current, [id]: box.n };
      const next = [...list];
      saveTrbx(next);
      return next;
    });
  };

  const otborKey = () => (supplyRef.current?.sid ? `tsd.otbor.${supplyRef.current.sid}` : null);
  const otborTakenKey = () => (supplyRef.current?.sid ? `tsd.otbortaken.${supplyRef.current.sid}` : null);
  const saveOtbor = () => { const k = otborKey(); if (k) lsSet(k, JSON.stringify(otborDoneRef.current)); };
  const saveOtborTaken = () => { const k = otborTakenKey(); if (k) lsSet(k, JSON.stringify(otborTakenRef.current)); };
  const loadOtbor = async (s) => {
    otborDoneRef.current = {}; otborTakenRef.current = {};
    const key = s?.sid ? `tsd.otbor.${s.sid}` : null;
    if (key) { try { const raw = JSON.parse((await lsGet(key)) || 'null'); if (raw && typeof raw === 'object') otborDoneRef.current = raw; } catch (_) {} }
    const tkey = s?.sid ? `tsd.otbortaken.${s.sid}` : null;
    if (tkey) { try { const raw = JSON.parse((await lsGet(tkey)) || 'null'); if (raw && typeof raw === 'object') otborTakenRef.current = raw; } catch (_) {} }
  };

  // ---------- маркировка строк / отклонения ----------
  const markRowsRejected = (order, sgtins) => {
    order.serverClosed = false; clearLocalDone(order);
    const list = (Array.isArray(sgtins) ? sgtins : [sgtins]).filter(Boolean); let hit = false;
    for (const sg of list) { const row = order.rows.find((r) => Array.isArray(r.chz) && r.chz.includes(sg)); if (row) { const i = row.chz.lastIndexOf(sg); if (i >= 0) row.chz.splice(i, 1); row.czRejected = true; row.czSkipped = 0; hit = true; } }
    if (!hit) for (const r of order.rows) if (orderNeedsCz(order)) { r.czRejected = true; r.czSkipped = 0; }
  };
  const clearRowsRejected = (order) => { for (const r of order.rows) r.czRejected = false; };

  // ---------- голос/цель ----------
  const speakCellForRow = (row, suffix = '') => {
    if (!row.places || !row.places.length) return suffix.trim() || null;
    row.cellNodes = pickCells(row.places, row.need, lastCellCodeRef.current);
    row.cells = row.cellNodes.map((pl) => `${pl.code} ×${pl.quantity}`).join(', ');
    const code = row.cellNodes[0]?.code;
    if (code) lastCellCodeRef.current = code;
    if (!getSpeakCellSborka()) return suffix.trim() || null;
    return code ? `${cellSpeech(code)}${suffix}` : (suffix.trim() || null);
  };
  const sayAfterScan = (order, row, fallback, prefix = '') => {
    const say = (line) => sound('ok', prefix ? `${prefix}. ${line}` : line);
    if (allDoneLive()) { say('Поставка собрана'); return; }
    if (row && rowOpen(row, order)) { const left = row.need - rowClosedCount(row, order); const FEM = { 1: 'одна', 2: 'две' }; say(`Ещё ${FEM[left] || left}`); return; }
    const next = order.rows.find((r) => rowOpen(r, order));
    if (next) { setCurrent({ order, row: next }); say(speakCellForRow(next) || fallback); return; }
    say(fallback);
  };
  const allDoneLive = () => { const w = workRef.current; return w.length > 0 && w.filter(orderDone).length >= w.length; };

  const takeOneFromCell = async (order, row) => {
    if (!getTakeFromCell()) return;
    const place = (row.cellNodes || []).find((pl) => Number(pl.quantity) > 0) || (row.cellNodes || [])[0];
    if (!place || !row.productId) { log('error', `${row.item.name || row.barcodes[0]}: не знаю, с какой ячейки снять`); return; }
    try {
      const res = await api('/api/cells/stock/take', { method: 'POST', body: JSON.stringify({ node_id: place.node_id, product_id: row.productId, company_id: place.company_id || 0, quality: 'good', quantity: 1, source: 'tsd' }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); const detail = d?.detail; const msg = typeof detail === 'string' ? detail : (detail?.message || `ошибка ${res.status}`); log('error', `Не снял с ячейки ${place.code}: ${msg}`); return; }
      place.quantity = Math.max(0, Number(place.quantity) - 1);
      row.cells = (row.cellNodes || []).filter((pl) => pl.quantity > 0).map((pl) => `${pl.code} ×${pl.quantity}`).join(', ');
      rerender();
    } catch (e) { log('error', `Не снял с ячейки ${place.code}: ${e.message}`); }
  };

  // ---------- стикер/поиск заказа ----------
  const findOrderBySticker = (code) => {
    const raw = String(code).trim();
    if (/^\d+$/.test(raw)) {
      const needle = raw.replace(/^0+/, '');
      const byNum = workRef.current.find((o) => { const p = o.posting; const short = String(p.sticker_number || '').trim().replace(/^0+/, ''); if (short && short === needle) return true; const full = (String(p.sticker_part_a || '') + String(p.sticker_number || '')).replace(/^0+/, ''); return Boolean(full) && full === needle; });
      if (byNum) return byNum;
    }
    const needle = normSticker(raw); if (!needle) return null;
    return workRef.current.find((o) => normSticker(o.posting.sticker_barcode) === needle) || null;
  };

  // ---------- пик штуки ----------
  const confirmPick = (order, row, via) => {
    const isNewPick = row.scanned < row.need;
    if (isNewPick) row.scanned += 1;
    lastScannedRef.current = { order, row };
    setCurrent({ order, row });
    if (isNewPick) recordPick({ company: companyRef.current?.display_name || '', order: orderLabel(order), barcode: row.barcodes[0] || '', name: row.item.name || '', price: priceForItem(pricingRef.current, row.item.article || row.item.offer_id) });
    if (order.czRequired || order.czOptional) {
      setPhase('sgtin'); activeOrderRef.current = order;
      sound('step', speakCellForRow(row, '. Скан ЧЗ') || 'Скан ЧЗ');
      if (isNewPick) takeOneFromCell(order, row);
      rerender(); return;
    }
    const done = orderDone(order);
    if (done) { markLocalDone(order); assignToBox(order); }
    sayAfterScan(order, row, speakCellForRow(row) || (via === 'стикер' ? 'Ячейка не найдена' : 'Далее'));
    if (isNewPick) takeOneFromCell(order, row);
    rerender();
  };

  const acceptBarcodeSingle = (code) => {
    const candidates = workRef.current.filter((o) => !orderDone(o) && o.rows.some((r) => r.barcodes.includes(code) && rowOpen(r, o)));
    let order = candidates.find((o) => orderScanned(o) > 0) || candidates[0];
    let via = 'ШК';
    if (!order) {
      const bySticker = findOrderBySticker(code);
      if (bySticker && !orderDone(bySticker)) { order = bySticker; via = 'стикер'; }
      else if (bySticker) { log('error', `Стикер ${code}: заказ ${orderLabel(bySticker)} уже пикали`); sound('error', 'Ошибка. Уже пикали'); return; }
    }
    if (!order) { const known = workRef.current.some((o) => o.rows.some((r) => r.barcodes.includes(code))); log('error', known ? `ШК ${code}: по всем таким заказам ЧЗ уже записан` : `${code} — не из этой поставки`); sound('error', known ? 'Ошибка. Уже пикали' : 'Ошибка. Не из поставки'); return; }
    const row = via === 'ШК' ? order.rows.find((r) => r.barcodes.includes(code) && rowOpen(r, order)) : order.rows.find((r) => rowOpen(r, order));
    if (!row) return;
    confirmPick(order, row, via);
  };

  const acceptBarcodePair = (code) => {
    const stickerOrder = findOrderBySticker(code);
    const stickerOk = !!stickerOrder && !orderDone(stickerOrder);
    const barcodeOk = workRef.current.some((o) => !orderDone(o) && o.rows.some((r) => r.barcodes.includes(code) && rowOpen(r, o)));
    const pp = pairPendingRef.current;
    let thisKind;
    if (pp?.kind === 'barcode') thisKind = stickerOk ? 'sticker' : (barcodeOk ? 'barcode' : null);
    else if (pp?.kind === 'sticker') thisKind = barcodeOk ? 'barcode' : (stickerOk ? 'sticker' : null);
    else thisKind = barcodeOk ? 'barcode' : (stickerOk ? 'sticker' : null);

    if (!thisKind) {
      if (stickerOrder && orderDone(stickerOrder)) { log('error', `Стикер ${code}: заказ ${orderLabel(stickerOrder)} уже собран`); sound('error', 'Ошибка. Уже собран'); return; }
      const known = workRef.current.some((o) => o.rows.some((r) => r.barcodes.includes(code)));
      log('error', known ? `ШК ${code}: все такие заказы уже собраны` : `${code} — не из этой поставки`); sound('error', known ? 'Ошибка. Уже собрано' : 'Ошибка. Не из поставки'); return;
    }
    const unverifiableRow = (ord) => { if (!ord || orderDone(ord)) return null; const r = ord.rows.find((x) => rowOpen(x, ord)); return r && (!r.barcodes || r.barcodes.length === 0) ? r : null; };

    if (!pp) {
      if (thisKind === 'sticker') { const r = unverifiableRow(stickerOrder); if (r) { confirmPick(stickerOrder, r, 'стикер'); return; } }
      if (thisKind === 'barcode') {
        const cand = workRef.current.filter((o) => !orderDone(o) && o.rows.some((r) => r.barcodes.includes(code) && rowOpen(r, o)));
        if (cand.length && cand.every((o) => !stickerValue(o.posting) && !o.posting.sticker_barcode)) { const o = cand.find((x) => orderScanned(x) > 0) || cand[0]; const r = o.rows.find((x) => x.barcodes.includes(code) && rowOpen(x, o)); if (r) { confirmPick(o, r, 'ШК'); return; } }
      }
      pairPendingRef.current = { kind: thisKind, code, order: thisKind === 'sticker' ? stickerOrder : null };
      showPending(thisKind, code, stickerOrder);
      if (thisKind === 'barcode') { log('ok', ''); sound('step', 'Скан стикер'); } else { sound('step', 'Скан ШК'); }
      rerender(); return;
    }
    if (pp.kind === thisKind) {
      if (thisKind === 'sticker') { const r = unverifiableRow(stickerOrder); if (r) { pairPendingRef.current = null; confirmPick(stickerOrder, r, 'стикер'); return; } }
      pairPendingRef.current = { kind: thisKind, code, order: thisKind === 'sticker' ? stickerOrder : null };
      showPending(thisKind, code, stickerOrder);
      if (thisKind === 'barcode') { log('error', 'Нужна пара: ШК принят, пикните СТИКЕР'); sound('error', 'Скан стикер'); } else { log('error', 'Нужна пара: стикер принят, пикните ШК'); sound('error', 'Скан ШК'); }
      rerender(); return;
    }
    const barcodeCode = thisKind === 'barcode' ? code : pp.code;
    const ord = thisKind === 'sticker' ? stickerOrder : pp.order;
    const row = ord && !orderDone(ord) ? ord.rows.find((r) => r.barcodes.includes(barcodeCode) && rowOpen(r, ord)) : null;
    if (!row) {
      const r = unverifiableRow(ord); if (r) { pairPendingRef.current = null; confirmPick(ord, r, 'стикер'); return; }
      log('error', `Стикер не от этого товара! Пикните правильный стикер (ШК ${barcodeCode})`); sound('error', 'Стоп. Чужой стикер');
      pairPendingRef.current = { kind: 'barcode', code: barcodeCode, order: null }; rerender(); return;
    }
    pairPendingRef.current = null;
    confirmPick(ord, row, 'ШК+стикер');
  };

  const showPending = (kind, code, stickerOrder) => {
    const order = kind === 'sticker' ? stickerOrder : workRef.current.find((o) => !orderDone(o) && o.rows.some((r) => r.barcodes.includes(code) && rowOpen(r, o)));
    if (!order) return;
    const row = order.rows.find((r) => rowOpen(r, order)) || order.rows[0];
    if (row) setCurrent({ order, row });
  };

  const acceptBarcode = (code) => {
    if (phase === 'sgtin' && activeOrderRef.current) {
      const ao = activeOrderRef.current;
      const sameOrder = findOrderBySticker(code) === ao || ao.rows.some((r) => r.barcodes.includes(code));
      if (sameOrder) { log('error', `Это код того же заказа — наведите на марку ЧЗ`); sound('error', 'Это не марка'); return; }
      if (ao.czRequired) { log('error', `Сначала пикните марку ЧЗ для заказа ${orderLabel(ao)}`); sound('error', 'Стоп. Нет марки'); return; }
      const skipped = ao;
      if (lastScannedRef.current?.row) lastScannedRef.current.row.czSkipped = (lastScannedRef.current.row.czSkipped || 0) + 1;
      setPhase('barcode'); activeOrderRef.current = null;
      if (orderDone(skipped)) { markLocalDone(skipped); assignToBox(skipped); }
    }
    if (getVerifySticker()) acceptBarcodePair(code); else acceptBarcodeSingle(code);
  };

  const acceptChz = (code) => {
    if (phase !== 'sgtin' || !activeOrderRef.current || !lastScannedRef.current) { log('error', 'Сначала пикните ШК товара, потом его марку ЧЗ'); sound('error', 'Ошибка. Сначала товар'); return; }
    const { order, row } = lastScannedRef.current;
    const sgtin = normalizeSgtin(code);
    row.chz.push(sgtin);
    setPhase('barcode'); activeOrderRef.current = null;
    const done = orderDone(order);
    if (done) assignToBox(order);
    sayAfterScan(order, row, 'Далее');
    enqueueSgtin(order, sgtin);
    rerender();
  };

  // ---------- очередь марок ----------
  const enqueueSgtin = (order, sgtin) => {
    sgtinQueue.current.push({ posting_number: order.posting.posting_number, sgtin, order });
    order.sendState = 'в очереди'; order._sentAt = Date.now();
    if (sgtinFlushTimer.current) clearTimeout(sgtinFlushTimer.current);
    sgtinFlushTimer.current = setTimeout(flushSgtinQueue, SGTIN_IDLE_MS);
  };
  const flushSgtinQueue = async () => {
    if (sgtinFlushTimer.current) { clearTimeout(sgtinFlushTimer.current); sgtinFlushTimer.current = null; }
    if (sgtinFlushing.current || !sgtinQueue.current.length) return;
    sgtinFlushing.current = true;
    const batch = sgtinQueue.current.splice(0, SGTIN_BATCH_SIZE);
    batch.forEach((b) => { b.order.sendState = 'отправка'; });
    try {
      const res = await api('/api/wb-fbs/postings/meta/sgtin/bulk', { method: 'POST', body: JSON.stringify({ company_id: companyRef.current.id, shop_index: 0, items: batch.map(({ posting_number, sgtin }) => ({ posting_number, sgtin })) }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.message || `Сервер ответил ${res.status}`);
      const results = Array.isArray(data.results) ? data.results : [];
      for (const b of batch) {
        const r = results.find((x) => String(x.posting_number || '') === b.posting_number && String(x.sgtin || '') === b.sgtin);
        if (r && r.ok === false) revertRejectedChz(b.order, b.sgtin, r.error);
        else {
          b.order.sendState = 'проверяется WB'; b.order.serverClosed = true;
          const rr = b.order.rows.find((x) => Array.isArray(x.chz) && x.chz.includes(b.sgtin)); if (rr) rr.czRejected = false;
          b.order._sentAt = Date.now();
        }
      }
      rerender();
    } catch (e) {
      const retry = []; let lost = 0;
      for (const b of batch) { b.attempts = (b.attempts || 0) + 1; if (b.attempts < 3) retry.push(b); else { b.order.sendState = 'ошибка отправки'; lost += 1; log('error', `${b.posting_number} · марка НЕ отправлена — пикните её ещё раз`); } }
      if (lost) sound('error', lost === 1 ? 'Марка не ушла. Повторите' : `Не ушло марок: ${lost}`);
      if (retry.length) { retry.forEach((b) => { b.order.sendState = 'повтор отправки'; }); sgtinQueue.current.unshift(...retry); sgtinFlushTimer.current = setTimeout(flushSgtinQueue, 5000); }
      rerender();
    } finally {
      sgtinFlushing.current = false;
      if (sgtinQueue.current.length && !sgtinFlushTimer.current) sgtinFlushTimer.current = setTimeout(flushSgtinQueue, SGTIN_IDLE_MS);
    }
  };
  const revertRejectedChz = (order, sgtin, reason) => { markRowsRejected(order, sgtin); order.sendState = 'ЧЗ отклонён'; log('error', `${orderLabel(order)} · ЧЗ отклонён WB (${reason || 'без причины'}) — отсканируйте марку повторно`); sound('error', 'Ошибка марки'); };

  const skipChz = () => {
    if (phase !== 'sgtin' || !activeOrderRef.current) return;
    const order = activeOrderRef.current;
    if (lastScannedRef.current?.row) lastScannedRef.current.row.czSkipped = (lastScannedRef.current.row.czSkipped || 0) + 1;
    if (lastScannedRef.current?.row?.czRejected) { lastScannedRef.current.row.czRejected = false; order.sendState = ''; }
    setPhase('barcode'); activeOrderRef.current = null;
    if (orderDone(order)) { markLocalDone(order); assignToBox(order); }
    sayAfterScan(order, lastScannedRef.current?.row || null, 'Далее', 'Без ЧЗ');
    refocus(); rerender();
  };

  const cancelPending = () => { pairPendingRef.current = null; sound('step', 'Пикните ШК'); refocus(); rerender(); };

  // ---------- отбор ----------
  const pickList = (() => {
    const map = new Map();
    for (const o of work) for (const r of o.rows) {
      const key = r.barcodes[0] || r.item?.article || r.item?.offer_id || r.item?.name;
      if (!key) continue;
      if (!map.has(key)) map.set(key, { key, item: r.item, name: r.item?.name || '', barcodes: r.barcodes || [], need: 0, orders: 0, places: (r.places && r.places.length) ? r.places : null, productId: r.productId || null });
      const e = map.get(key); e.need += Number(r.need) || 0; e.orders += 1;
      if (!e.places && r.places && r.places.length) { e.places = r.places; e.productId = r.productId; }
    }
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

  const planPickTake = (e, want) => {
    const need = Number(want) || 0; if (!e.places || !e.places.length || need <= 0) return [];
    const chosen = pickCells(e.places, need, null); const plan = []; let left = need;
    for (const pl of chosen) { if (left <= 0) break; const take = Math.min(Number(pl.quantity) || 0, left); if (take > 0) { plan.push({ node_id: pl.node_id, company_id: pl.company_id || 0, code: pl.code, qty: take }); left -= take; } }
    return plan;
  };
  const applyPickTake = async (e) => {
    if (otborBusy.current.has(e.key)) return; otborBusy.current.add(e.key);
    try {
      const taken = otborTakenRef.current[e.key] || [];
      const already = taken.reduce((s, t) => s + (Number(t.qty) || 0), 0);
      const want = (Number(e.need) || 0) - already;
      if (want <= 0) return;
      if (!e.places || !e.places.length || !e.productId) return;
      const done = [];
      for (const p of planPickTake(e, want)) {
        try {
          const res = await api('/api/cells/stock/take', { method: 'POST', body: JSON.stringify({ node_id: p.node_id, product_id: e.productId, company_id: p.company_id, quality: 'good', quantity: p.qty, source: 'tsd' }) });
          if (!res.ok) { const d = await res.json().catch(() => ({})); const detail = d?.detail; const msg = typeof detail === 'string' ? detail : (detail?.message || `ошибка ${res.status}`); log('error', `Не снял с ячейки ${p.code}: ${msg}`); continue; }
          done.push({ ...p, product_id: e.productId });
          const pl = (e.places || []).find((x) => x.node_id === p.node_id); if (pl) pl.quantity = Math.max(0, Number(pl.quantity) - p.qty);
        } catch (err) { log('error', `Не снял с ячейки ${p.code}: ${err.message}`); }
      }
      if (done.length) { otborTakenRef.current = { ...otborTakenRef.current, [e.key]: [...taken, ...done] }; saveOtborTaken(); }
    } finally { otborBusy.current.delete(e.key); rerender(); }
  };
  const revertPickTake = async (e) => {
    if (otborBusy.current.has(e.key)) return; otborBusy.current.add(e.key);
    try {
      const taken = otborTakenRef.current[e.key] || []; if (!taken.length) return;
      const stillTaken = []; let back = 0;
      for (const t of taken) {
        try {
          const res = await api('/api/cells/stock/put', { method: 'POST', body: JSON.stringify({ node_id: t.node_id, product_id: t.product_id || e.productId, company_id: t.company_id || 0, quality: 'good', quantity: t.qty, source: 'tsd' }) });
          if (!res.ok) { stillTaken.push(t); continue; }
          back += Number(t.qty) || 0; const pl = (e.places || []).find((x) => x.node_id === t.node_id); if (pl) pl.quantity = Number(pl.quantity || 0) + t.qty;
        } catch (_) { stillTaken.push(t); }
      }
      const next = { ...otborTakenRef.current }; if (stillTaken.length) next[e.key] = stillTaken; else delete next[e.key]; otborTakenRef.current = next; saveOtborTaken();
      if (stillTaken.length) log('error', `Не вернулось в ячейки: ${stillTaken.reduce((s, t) => s + (Number(t.qty) || 0), 0)} шт — повторите`);
    } finally { otborBusy.current.delete(e.key); rerender(); }
  };
  const togglePick = (e) => {
    if (otborBusy.current.has(e.key)) { refocus(); return; }
    const now = !otborDoneRef.current[e.key];
    otborDoneRef.current = { ...otborDoneRef.current, [e.key]: now }; saveOtbor();
    if (now) { applyPickTake(e); if (pickAllDone) sound('ok', 'Отбор завершён'); else speakNextPick(); }
    else revertPickTake(e);
    setDetail(null); rerender(); refocus();
  };
  const otborScan = (code) => {
    const entry = pickList.find((e) => e.barcodes.includes(code));
    if (!entry) { log('error', `${code} — не из этого отбора`); sound('error', 'Не из отбора'); return; }
    openPickDetail(entry);
  };
  const openPickDetail = (e) => { setDetail({ kind: 'pick', e }); const cell = e.cellCode || ''; sound('step', cell ? `Взять ${e.need}. ${cellSpeech(cell)}` : `Взять ${e.need}`); };
  const resetOtbor = () => {
    Alert.alert('Сбросить отбор?', 'Снятое вернётся в ячейки.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Сбросить', style: 'destructive', onPress: async () => {
        const all = otborTakenRef.current; const remainTaken = {}; const remainDone = {};
        for (const key of Object.keys(all)) { const stillTaken = []; for (const t of (all[key] || [])) { try { const res = await api('/api/cells/stock/put', { method: 'POST', body: JSON.stringify({ node_id: t.node_id, product_id: t.product_id, company_id: t.company_id || 0, quality: 'good', quantity: t.qty, source: 'tsd' }) }); if (!res.ok) stillTaken.push(t); } catch (_) { stillTaken.push(t); } } if (stillTaken.length) { remainTaken[key] = stillTaken; remainDone[key] = otborDoneRef.current[key]; } }
        otborDoneRef.current = remainDone; otborTakenRef.current = remainTaken; saveOtbor(); saveOtborTaken();
        if (Object.keys(remainTaken).length) log('error', 'Часть возвратов не прошла — повторите «Сбросить»');
        rerender(); refocus();
      } },
    ]);
  };

  // ---------- общий разбор скана ----------
  const handleCode = (raw) => {
    const trimmed = String(raw || '').trim(); if (!trimmed) return;
    const code = fixKeyboardLayout(trimmed);
    if (isDup(code)) return;
    if (mode === 'otbor') { otborScan(code); return; }
    if (looksLikeChz(code)) acceptChz(code); else acceptBarcode(code);
  };
  const onSubmitScan = () => { const raw = scan; setScan(''); handleCode(raw); };

  const selectOrder = (order) => {
    if (!order) return;
    const row = order.rows.find((r) => rowOpen(r, order)) || order.rows[0];
    if (!row) return;
    setCurrent({ order, row });
    sound('step', speakCellForRow(row) || 'Далее');
    refocus();
  };

  const switchMode = async (m) => { setMode(m); pairPendingRef.current = null; refocus(); rerender(); };

  const finishSession = () => {
    const sid = supplyRef.current?.sid;
    if (sid) { const next = { ...finishedSupplies, [sid]: Date.now() }; setFinishedSupplies(next); lsSet('tsd.fbsSupplyDone', JSON.stringify(next)); }
    sound('ok', 'Поставка собрана'); setStep('supplies'); loadSuppliesProgress();
  };

  const newBox = () => { setBoxes((prev) => { const list = prev.length ? prev : [{ n: 1, orders: 0, units: 0 }]; const n = list.length + 1; const next = [...list, { n, orders: 0, units: 0 }]; setCurrentBoxN(n); saveTrbx(next, undefined, n); return next; }); sound('step', 'Новое грузоместо'); refocus(); };
  const selectBox = (n) => { setCurrentBoxN(n); saveTrbx(undefined, undefined, n); sound('step', `Коробка ${n}`); refocus(); };
  const changeDelivery = (m) => { setDeliveryMode(m); if (m === 'pvz') { setBoxes((prev) => prev.length ? prev : [{ n: 1, orders: 0, units: 0 }]); for (const o of workRef.current) if (orderDone(o)) assignToBox(o); } saveTrbx(undefined, m); refocus(); };

  const refresh = async () => {
    if (loading) return;
    if (step === 'companies') await loadCompanies();
    else if (step === 'supplies') { setLoading(true); try { await openCompany(companyRef.current); } finally { setLoading(false); } }
    else if (step === 'work') { await loadSupplyMeta(); for (const [k, v] of cellsByBarcode.current) if (!v || !v.places || !v.places.length) cellsByBarcode.current.delete(k); loadCells(); }
  };

  const goBack = () => {
    if (step === 'work') {
      if (totalOrders > 0 && !allDone && !leaveConfirm) { setLeaveConfirm(true); return; }
      setLeaveConfirm(false); pairPendingRef.current = null; setStep('supplies'); loadSuppliesProgress();
    } else if (step === 'supplies') setStep('companies');
    else router.back();
    setError('');
  };

  // фоновый опрос вердиктов
  useEffect(() => {
    const t = setInterval(() => {
      if (!companyRef.current || metaLoading) return;
      if (step === 'work') loadSupplyMeta(true);
      else if (step === 'supplies') loadSuppliesProgress();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [step, metaLoading, loadSupplyMeta, loadSuppliesProgress]);

  const filteredCompanies = (() => { const q = companyQuery.toLowerCase().trim(); if (!q) return companies; return companies.filter((c) => String(c.display_name || '').toLowerCase().includes(q)); })();
  const suppliesSorted = [...supplies].sort((a, b) => (finishedSupplies[a.sid] ? 1 : 0) - (finishedSupplies[b.sid] ? 1 : 0));

  const money = (n) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;
  const itemPrice = (row) => priceForItem(pricingRef.current, row?.item?.article || row?.item?.offer_id);

  // ================= UI =================
  const headerTitle = step === 'companies' ? 'ФБС' : step === 'supplies' ? (companyRef.current?.display_name || 'Поставки') : (supplyRef.current?.multi ? ('Мульти ' + (supplyRef.current?.label || '')) : (supplyRef.current?.name || supplyRef.current?.sid));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={headerTitle} subtitle={step === 'companies' ? (mod?.subtitle || 'WB · сборка') : undefined} onBack={goBack}
        right={<Pressable onPress={refresh} hitSlop={8} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: '#ffffff22', alignItems: 'center', justifyContent: 'center' }}>{loading ? <ActivityIndicator color={colors.onDark} size="small" /> : <Text style={{ color: colors.onDark, fontSize: 18 }}>↻</Text>}</Pressable>} />

      {error ? <View style={{ paddingHorizontal: 12, paddingTop: 8 }}><Banner kind="error" text={error} /></View> : null}

      {step === 'companies' ? (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 24, gap: 8 }}>
          <View style={segWrap}>
            <View style={[segBtn, segOn]}><Text style={[segTxt, segTxtOn]}>WB</Text></View>
            <Pressable style={segBtn} onPress={() => Alert.alert('Ozon ФБС', 'Переносится на React Native следующим шагом.')}><Text style={segTxt}>Ozon</Text></Pressable>
            <Pressable style={segBtn} onPress={() => Alert.alert('Яндекс ФБС', 'Переносится на React Native следующим шагом.')}><Text style={segTxt}>Яндекс</Text></Pressable>
          </View>
          <TextInput value={companyQuery} onChangeText={setCompanyQuery} placeholder="Поиск по имени…" placeholderTextColor={colors.muted} style={fieldStyle} />
          {filteredCompanies.map((c) => (
            <Pressable key={c.id} onPress={() => openCompany(c)} style={[rowCard, shadow.card]}>
              <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 14, color: colors.ink }} numberOfLines={1}>{c.display_name || ('Компания #' + c.id)}</Text>
              <Badge text={`${c.assembly_count} пост.`} />
            </Pressable>
          ))}
          {!loading && companies.length && !filteredCompanies.length ? <Text style={hintTxt}>Никого не нашлось по «{companyQuery}»</Text> : null}
          {!loading && !companies.length && !error ? <Text style={hintTxt}>Сейчас ни у кого нет заказов на сборке</Text> : null}
        </ScrollView>
      ) : step === 'supplies' ? (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 24, gap: 8 }}>
          {suppliesSorted.map((s) => (
            <Pressable key={s.sid} onPress={() => openSupply(s)} style={[rowCard, shadow.card, finishedSupplies[s.sid] && { opacity: 0.6 }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: font.semibold, fontSize: 14, color: colors.ink }} numberOfLines={1}>
                  {s.multi ? <Text style={{ color: colors.accent }}>МУЛЬТИ </Text> : null}{s.multi ? (s.label || 'Мультипоставка') : (s.name || s.sid)}
                </Text>
                <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.muted }} numberOfLines={1}>{s.multi ? `${s.supplyCount} поставок · ${s.orders.length} заказов` : (s.warehouse || 'WB склад')}</Text>
              </View>
              {s.rejected ? <Badge text={`⚠ ЧЗ ${s.rejected}`} kind="err" /> : null}
              {finishedSupplies[s.sid] ? <Badge text="✓" kind="full" /> : <Badge text={s.done != null ? `${s.done}/${s.orders.length}` : `${s.orders.length} зак.`} kind={s.done != null && s.done >= s.orders.length ? 'full' : 'muted'} />}
            </Pressable>
          ))}
          {!loading && skippedCancelled ? <Text style={hintTxt}>Скрыто отменённых: {skippedCancelled} — собирать нечего.</Text> : null}
          {!loading && !supplies.length && !error ? <Text style={hintTxt}>На сборке пусто.</Text> : null}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          {leaveConfirm ? (
            <View style={{ padding: 12, gap: 8 }}>
              <Banner kind="error" text={`Собрано ${doneOrders} из ${totalOrders}. Остальные не собраны. Выйти?`} />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable onPress={() => setLeaveConfirm(false)} style={[outlineBtn, { flex: 1 }]}><Text style={outlineTxt}>Отмена</Text></Pressable>
                <Pressable onPress={goBack} style={[submitBtn, { flex: 1, backgroundColor: colors.danger }]}><Text style={submitTxt}>Выйти</Text></Pressable>
              </View>
            </View>
          ) : null}

          <View style={[segWrap, { margin: 12, marginBottom: 4 }]}>
            <Pressable style={[segBtn, mode === 'otbor' && segOn]} onPress={() => switchMode('otbor')}><Text style={[segTxt, mode === 'otbor' && segTxtOn]}>🛒 Отбор</Text></Pressable>
            <Pressable style={[segBtn, mode === 'sborka' && segOn]} onPress={() => switchMode('sborka')}><Text style={[segTxt, mode === 'sborka' && segTxtOn]}>📦 Сборка</Text></Pressable>
          </View>

          {mode === 'sborka' ? (
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 24, gap: 10 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Counter n={totalOrders} label="всего" />
                <Counter n={doneOrders} label="готово" />
                <Counter n={`${scannedUnits}/${totalUnits}`} label="штук" />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontFamily: font.semibold, fontSize: 12, color: colors.muted }}>Доставка</Text>
                <View style={[segWrap, { flex: 1 }]}>
                  <Pressable style={[segBtn, deliveryMode === 'sc' && segOn]} onPress={() => changeDelivery('sc')}><Text style={[segTxt, deliveryMode === 'sc' && segTxtOn]}>СЦ</Text></Pressable>
                  <Pressable style={[segBtn, deliveryMode === 'pvz' && segOn]} onPress={() => changeDelivery('pvz')}><Text style={[segTxt, deliveryMode === 'pvz' && segTxtOn]}>ПВЗ</Text></Pressable>
                </View>
              </View>

              {metaLoading ? <Text style={hintTxt}>Сверяю записанные ЧЗ с сервером…</Text> : null}

              {allDone ? (
                <View style={{ backgroundColor: colors.success + '18', borderRadius: radius.md, padding: 12, gap: 6 }}>
                  <Text style={{ fontFamily: font.semibold, color: colors.primary }}>✓ Все заказы собраны</Text>
                  <Pressable onPress={finishSession} style={submitBtn}><Text style={submitTxt}>Готово — к списку поставок</Text></Pressable>
                  <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.muted }}>Передать поставку в доставку — на сайте</Text>
                </View>
              ) : null}

              {current ? <TargetCard current={current} face={targetFace} setFace={setTargetFace} cellsLoading={cellsLoading} onPhoto={() => photoOf(current.row.item) && setLightbox({ src: photoOf(current.row.item), name: current.row.item.name })} phase={phase} price={itemPrice(current.row)} money={money} /> : null}

              <View style={{ backgroundColor: phase === 'sgtin' ? colors.accent + '22' : colors.bg, borderRadius: radius.md, padding: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 13, color: phase === 'sgtin' ? colors.primary : colors.ink }}>
                  {phase === 'sgtin' ? 'Возьмите товар и пикните марку ЧЗ' : allDone ? 'Всё собрано — жмите «Готово»' : pairPendingRef.current?.kind === 'barcode' ? 'ШК принят — пикните СТИКЕР' : pairPendingRef.current ? 'Стикер принят — пикните ШК' : (getVerifySticker() ? 'Пикните ШК товара и его стикер' : 'Пикните стикер или ШК')}
                </Text>
                {phase === 'sgtin' && (activeOrderRef.current?.czRequired || activeOrderRef.current?.czOptional) ? <Pressable onPress={skipChz} style={ghostBtn}><Text style={ghostBtnTxt}>Пропустить ЧЗ</Text></Pressable> : null}
              </View>

              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <View style={{ flex: 1 }}><ScanField ref={scanRef} value={scan} onChangeText={setScan} onSubmit={onSubmitScan} showKeyboard={showKb} onToggleKeyboard={() => setShowKb((s) => !s)} placeholder={phase === 'sgtin' ? 'Пикните марку ЧЗ…' : (pairPendingRef.current ? (pairPendingRef.current.kind === 'barcode' ? 'Пикните стикер…' : 'Пикните ШК…') : 'Пикайте ШК или стикер…')} /></View>
                {pairPendingRef.current ? <Pressable onPress={cancelPending} style={{ width: 44, height: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontFamily: font.bold, color: colors.muted }}>✕</Text></Pressable> : null}
              </View>

              {errorLog.length ? <View style={{ gap: 4 }}>{errorLog.map((e) => <Text key={e.t} style={{ fontFamily: font.medium, fontSize: 12, color: colors.danger }}>{e.text}</Text>)}</View> : null}

              {deliveryMode === 'pvz' ? (
                <View style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={sectionTxt}>Грузоместа</Text>
                    <Pressable onPress={newBox} style={ghostBtn}><Text style={ghostBtnTxt}>+ Новое</Text></Pressable>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {boxes.map((b) => (
                      <Pressable key={b.n} onPress={() => selectBox(b.n)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: b.n === currentBoxN ? colors.primary : colors.border, backgroundColor: b.n === currentBoxN ? colors.primary + '14' : colors.surface }}>
                        <Text style={{ fontFamily: font.bold, fontSize: 13, color: colors.ink }}>Коробка {b.n}</Text>
                        <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.muted }}>{b.units} шт · {b.orders} зак.{b.n === currentBoxN ? ' ●' : ''}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}

              <Text style={sectionTxt}>Заказы поставки</Text>
              {workSorted.map((o) => {
                const cz = czState(o); const done = orderDone(o); const boxN = boxOfOrderRef.current[o.posting.order_id];
                return (
                  <Pressable key={o.posting.posting_number} onPress={() => selectOrder(o)} onLongPress={() => setDetail({ kind: 'order', o })} style={[planRow, done && { opacity: 0.55 }, current?.order === o && { borderColor: colors.primary }]}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <Text style={{ fontFamily: font.bold, fontSize: 15, color: colors.ink }}>{stickerHead(o.posting)}<Text style={{ color: colors.primary }}>{stickerTail(o.posting)}</Text></Text>
                      <Text style={{ fontFamily: font.semibold, fontSize: 12, color: done ? colors.success : colors.muted }}>{orderScanned(o)}/{orderNeed(o)}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                      {photoOf(o.rows[0]?.item) ? <Image source={{ uri: photoOf(o.rows[0].item) }} style={thumb} /> : null}
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: font.semibold, fontSize: 13, color: colors.ink }} numberOfLines={2}>{o.rows[0]?.item?.name || '—'}</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                          {cz ? <Chip text="ЧЗ" kind={cz} /> : null}
                          {o.rows[0]?.cells ? <Chip text={`📍 ${firstCellLabel(o.rows[0].cells)}`} kind="cell" /> : null}
                          {boxN ? <Chip text={`📦 ${boxN}`} kind="box" /> : null}
                        </View>
                      </View>
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
              {pickList.map((e) => {
                const picked = !!otborDoneRef.current[e.key];
                return (
                  <View key={e.key} style={[planRow, picked && { opacity: 0.55 }]}>
                    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                      {photoOf(e.item) ? <Pressable onPress={() => setLightbox({ src: photoOf(e.item), name: e.name })}><Image source={{ uri: photoOf(e.item) }} style={thumb} /></Pressable> : null}
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: font.semibold, fontSize: 13, color: colors.ink }} numberOfLines={2}>{e.name || '—'}</Text>
                        <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.muted }}>{e.cellsText ? `📍 ${e.cellsText}` : 'нет ячейки'} · ×{e.need}</Text>
                      </View>
                      <Pressable onPress={() => togglePick(e)} style={[picked ? outlineBtn : submitBtn, { paddingHorizontal: 14, minHeight: 44 }]}>
                        <Text style={picked ? outlineTxt : submitTxt}>{picked ? 'Снять' : `Собрал ✓`}</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
              {pickList.length ? <Pressable onPress={resetOtbor} style={{ padding: 10, alignItems: 'center' }}><Text style={{ fontFamily: font.medium, color: colors.danger }}>Сбросить отбор</Text></Pressable> : null}
              {!pickList.length ? <Text style={hintTxt}>В поставке нет позиций для отбора.</Text> : null}
            </ScrollView>
          )}
        </View>
      )}

      {/* деталь (long-press заказа / скан отбора) */}
      <Modal visible={!!detail} transparent animationType="slide" onRequestClose={() => setDetail(null)}>
        <Pressable style={sheetBackdrop} onPress={() => setDetail(null)}>
          <Pressable style={[sheetBody, { paddingBottom: insets.bottom + 14 }]} onPress={() => {}}>
            {detail ? (() => {
              const d = detail.kind === 'order' ? detailForOrder(detail.o) : detailForPick(detail.e);
              return (
                <>
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    {d.photo ? <Pressable onPress={() => setLightbox({ src: d.photo, name: d.name })}><Image source={{ uri: d.photo }} style={{ width: 70, height: 70, borderRadius: 10, backgroundColor: colors.bg }} /></Pressable> : null}
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: font.bold, fontSize: 15, color: colors.ink }} numberOfLines={3}>{d.name}</Text>
                      {d.cell ? <Text style={{ fontFamily: font.semibold, fontSize: 13, color: colors.primary, marginTop: 2 }}>📍 {d.cell}</Text> : null}
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {d.sticker ? <Text style={detLine}>Стикер <Text style={{ fontFamily: font.bold, color: colors.ink }}>{d.sticker}</Text></Text> : null}
                    {d.shk ? <Text style={detLine}>ШК {shkHead(d.shk)}<Text style={{ fontFamily: font.bold, color: colors.ink }}>{shkTail(d.shk)}</Text></Text> : null}
                    {d.size ? <Text style={detLine}>Размер {d.size}</Text> : null}
                    {d.art ? <Text style={detLine}>арт {d.art}</Text> : null}
                    <Text style={detLine}>{d.qtyText}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable onPress={() => Alert.alert('Печать', 'Печать по Bluetooth доступна только в dev-build (не в Expo Go).')} style={[outlineBtn, { flex: 1 }]}><Text style={outlineTxt}>Печать ШК</Text></Pressable>
                    {d.sticker ? <Pressable onPress={() => Alert.alert('Печать', 'Печать по Bluetooth доступна только в dev-build (не в Expo Go).')} style={[outlineBtn, { flex: 1 }]}><Text style={outlineTxt}>Печать стикера</Text></Pressable> : null}
                  </View>
                  {d.action ? <Pressable onPress={() => { d.action.run(); }} style={submitBtn}><Text style={submitTxt}>{d.action.label}</Text></Pressable> : null}
                </>
              );
            })() : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* фото */}
      <Modal visible={!!lightbox} transparent animationType="fade" onRequestClose={() => setLightbox(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(10,20,20,0.92)', alignItems: 'center', justifyContent: 'center', padding: 16, gap: 12 }} onPress={() => setLightbox(null)}>
          {lightbox ? <Image source={{ uri: lightbox.src }} style={{ width: '100%', height: '70%' }} resizeMode="contain" /> : null}
          {lightbox?.name ? <Text style={{ color: '#fff', fontFamily: font.regular, textAlign: 'center' }}>{lightbox.name}</Text> : null}
        </Pressable>
      </Modal>
    </View>
  );

  // детали для sheet
  function detailForOrder(order) {
    const row = order.rows.find((r) => rowOpen(r, order)) || order.rows[0];
    const needsMarkOnly = !!row && (order.czRequired || order.czOptional) && row.scanned >= row.need && rowClosedCount(row, order) < row.need;
    return {
      photo: photoOf(row?.item), name: row?.item?.name || '', cell: row?.cells || '',
      shk: String(row?.item?.barcode || row?.item?.barcode_wb || '').trim(), art: itemArt(row?.item), size: itemSize(row?.item),
      sticker: stickerValue(order.posting), qtyText: orderScanned(order) + '/' + orderNeed(order),
      action: (row && rowOpen(row, order)) ? { label: needsMarkOnly ? 'Пересканировать ЧЗ (на поле)' : 'Отметить пик', run: () => { if (!needsMarkOnly) { pairPendingRef.current = null; confirmPick(order, row, 'вручную'); } setDetail(null); refocus(); } } : null,
    };
  }
  function detailForPick(e) {
    return {
      photo: photoOf(e.item), name: e.name || e.key || '', cell: e.cellsText || e.cellCode || '',
      shk: (Array.isArray(e.barcodes) && e.barcodes[0]) || '', art: itemArt(e.item), size: itemSize(e.item),
      sticker: '', qtyText: '×' + e.need,
      action: { label: otborDoneRef.current[e.key] ? 'Снять отметку' : 'Собрал ✓', run: () => togglePick(e) },
    };
  }
}

function TargetCard({ current, face, setFace, cellsLoading, onPhoto, phase, price, money }) {
  const row = current.row; const cells = row.cells;
  return (
    <View style={{ backgroundColor: colors.surface, borderWidth: 2, borderColor: phase === 'sgtin' ? colors.accent : colors.primary, borderRadius: radius.lg, padding: 12, flexDirection: 'row', gap: 12 }}>
      <Pressable onPress={() => (face === 'cell' ? setFace('photo') : setFace('cell'))} style={{ width: 92, height: 92, borderRadius: radius.md, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {face === 'photo' ? (
          photoOf(row.item) ? <Image source={{ uri: photoOf(row.item) }} style={{ width: '100%', height: '100%' }} /> : <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.muted }}>нет фото</Text>
        ) : cells ? (
          <>
            <Text style={{ fontFamily: font.medium, fontSize: 9, color: colors.muted }}>СТЕЛЛАЖ</Text>
            <Text style={{ fontFamily: font.bold, fontSize: 34, color: colors.primary }}>{cellRack(cells)}</Text>
            {cellNums(cells) ? <Text style={{ fontFamily: font.semibold, fontSize: 12, color: colors.ink }}>{cellNums(cells)}</Text> : null}
            {cellQty(cells) ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.muted }}>×{cellQty(cells)}</Text> : null}
          </>
        ) : (
          <><Text style={{ fontFamily: font.medium, fontSize: 9, color: colors.muted }}>{cellsLoading ? 'ИЩУ' : 'ЯЧЕЙКА'}</Text><Text style={{ fontFamily: font.bold, fontSize: 30, color: colors.muted }}>{cellsLoading ? '…' : '—'}</Text></>
        )}
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: font.semibold, fontSize: 14, color: colors.ink }} numberOfLines={2}>{row.item.name || '—'}</Text>
        {cells ? <Text style={{ fontFamily: font.medium, fontSize: 12, color: colors.primary, marginTop: 2 }}>{cellSpeech(firstCellLabel(cells))}</Text> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4, alignItems: 'center' }}>
          <Text style={{ fontFamily: font.bold, fontSize: 13, color: colors.ink }}>{stickerHead(current.order.posting)}<Text style={{ color: colors.primary }}>{stickerTail(current.order.posting)}</Text></Text>
          {itemSize(row.item) ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.muted }}>р.{itemSize(row.item)}</Text> : null}
          {row.barcodes[0] ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.muted }}>{shkHead(row.barcodes[0])}<Text style={{ fontFamily: font.bold, color: colors.ink }}>{shkTail(row.barcodes[0])}</Text></Text> : null}
          {price != null ? <Text style={{ fontFamily: font.semibold, fontSize: 11, color: colors.accent }}>{money(price)}</Text> : null}
        </View>
      </View>
    </View>
  );
}

function Counter({ n, label, ok }) {
  return (
    <View style={[{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: ok ? colors.success : colors.border, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center' }, shadow.card]}>
      <Text style={{ fontFamily: font.bold, fontSize: 17, color: ok ? colors.success : colors.ink }}>{n}</Text>
      <Text style={{ fontFamily: font.medium, fontSize: 11, color: colors.muted }}>{label}</Text>
    </View>
  );
}
function Badge({ text, kind }) {
  const map = { err: [colors.danger + '22', colors.danger], full: [colors.success + '22', colors.primary], muted: [colors.border, colors.muted] };
  const [bg, fg] = map[kind] || [colors.primary + '18', colors.primary];
  return <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}><Text style={{ fontFamily: font.bold, fontSize: 11, color: fg }}>{text}</Text></View>;
}
function Chip({ text, kind }) {
  const map = { pending: [colors.accent + '22', colors.primary], scanned: [colors.success + '22', colors.primary], rejected: [colors.danger + '22', colors.danger], cell: [colors.primary + '14', colors.primary], box: [colors.warning + '22', colors.warning] };
  const [bg, fg] = map[kind] || [colors.border, colors.muted];
  return <View style={{ backgroundColor: bg, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}><Text style={{ fontFamily: font.semibold, fontSize: 10, color: fg }}>{text}</Text></View>;
}
function Banner({ kind, text }) {
  const err = kind === 'error';
  return <View style={{ backgroundColor: err ? colors.danger + '15' : colors.success + '18', borderWidth: 1, borderColor: err ? colors.danger + '40' : colors.success + '55', borderRadius: radius.md, padding: 11 }}><Text style={{ fontFamily: font.medium, fontSize: 13, color: err ? colors.danger : colors.primary }}>{text}</Text></View>;
}

const fieldStyle = { paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, fontFamily: font.regular, fontSize: 15, color: colors.ink, backgroundColor: colors.surface };
const hintTxt = { fontFamily: font.regular, fontSize: 13, color: colors.muted, paddingVertical: 6, lineHeight: 18 };
const sectionTxt = { fontFamily: font.semibold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.muted };
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
