import { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, Modal, Image, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenHeader from '../../components/ScreenHeader';
import ScanField from '../../components/ScanField';
import QtyPad from '../../components/QtyPad';
import { api } from '../../lib/api';
import { speak, formatCellSpeech, getCellVoiceMode } from '../../lib/cells';
import { useScanDedup } from '../../lib/scanner';
import { colors, font, radius, shadow } from '../../theme';

// Распределение по коробам (порт DistributionView.vue). Заявка стадии 13: по
// городам (ВБ — склад+поставка, Озон — distribution) собираем короба. Создание
// короба — /api/boxes/next/{prefix}; пик/QtyPad кладёт товар; опц. снятие с ячейки
// (/cells/stock/take). Сохранение — POST /api/manual-distribution/draft/save-full
// (форма короба как у редактора сайта). Финализация — на сайте (тут только черновик).
const sound = (kind, text) => { if (text) speak(String(text)); };
const cellSpeech = (code) => formatCellSpeech(code, getCellVoiceMode());
const shkTail = (c) => String(c || '').slice(-4);
const shkHead = (c) => { const s = String(c || ''); return s.length > 4 ? s.slice(0, -4) : ''; };
const photoOf = (p) => p?.photo_url || p?.image_url || p?.image || '';

function warehouseNameOf(lg) {
  const arr = lg?.warehouses || lg?.wareHouses || [];
  for (const w of (Array.isArray(arr) ? arr : [])) { const n = (w?.warehouse_name || w?.marketplace_warehouse || w?.mp_warehouse || w?.warehouse || '').toString().trim(); if (n) return n; }
  for (const w of (Array.isArray(arr) ? arr : [])) { const t = (w?.warehouse_name_t || w?.transit_warehouse || '').toString().trim(); if (t) return t; }
  return (lg?.warehouse_name || lg?.warehouse || '').toString().trim();
}
function supplyOf(lg) { const arr = lg?.warehouses || []; const w = Array.isArray(arr) ? arr.find((x) => x?.wb_supply_number || x?.supply_number) : null; return String((w?.wb_supply_number || w?.supply_number) || lg?.wb_supply_number || lg?.supply_number || '').trim(); }
function mapPlanItem(it) {
  return { product_id: it.product_id ?? it.id, name: it.name || it.product_name || '', article: it.vendor_code || it.article || '', barcodes: [it.barcode, it.barcode_wb, it.barcode_ozon].filter(Boolean), size: it.size || it.tech_size || it.wb_size || '', requested_qty: Number(it.qty ?? it.quantity ?? it.requested_qty ?? 0), photo_url: it.photo_url || it.photo || '' };
}

export default function DistributionView({ request, onBack }) {
  const insets = useSafeAreaInsets();
  const scanRef = useRef(null);
  const isDup = useScanDedup();
  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => (n + 1) % 1e9), []);

  const citiesRef = useRef([]);
  const cityStateRef = useRef({});
  const placesRef = useRef({});
  const prefixesRef = useRef([]);
  const [activeKey, setActiveKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [finalized, setFinalized] = useState(false);
  const [fullBt, setFullBt] = useState(String(request?.barcode_type || '').toLowerCase());
  const [scan, setScan] = useState('');
  const [showKb, setShowKb] = useState(false);
  const [lastMsg, setLastMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState('');
  const [showCell, setShowCell] = useState(false);
  const [takeFromCell, setTakeFromCell] = useState(false);
  const [placesLoaded, setPlacesLoaded] = useState(false);
  const [pad, setPad] = useState(null); // { pid, qty }
  const [lightbox, setLightbox] = useState(null);

  const isOzon = fullBt === 'ozon';
  const owner = request?.company_name || request?.owner || '';
  const cities = citiesRef.current;
  const activeCity = cities.find((c) => c.key === activeKey) || null;
  const state = (activeKey && cityStateRef.current[activeKey]) || null;
  const plan = activeCity?.plan || [];
  const current = (state?.boxes || []).find((b) => !b.closed) || null;
  const cityClosed = !!state?.closed;

  const logLine = (kind, text) => setLastMsg({ kind, text });
  const refocus = useCallback(() => { setTimeout(() => scanRef.current?.focus(), 250); }, []);

  // ---------- загрузка ----------
  const ensureCityStates = () => { for (const c of citiesRef.current) if (!cityStateRef.current[c.key]) cityStateRef.current[c.key] = { boxes: [], selectedPrefix: prefixesRef.current[0]?.prefix || '', closed: false }; };

  const buildCitiesWb = (logistics) => {
    const byCity = new Map();
    for (const lg of logistics) {
      const wh = warehouseNameOf(lg); if (!wh) continue;
      const supply = String(lg.wb_supply_number || supplyOf(lg) || '').trim();
      const key = supply ? `${wh} (${supply})` : wh;
      if (!byCity.has(key)) byCity.set(key, { key, warehouse: wh, logistics_id: lg.id ?? lg.logistics_id ?? null, supply, _plan: new Map() });
      const city = byCity.get(key);
      for (const it of (Array.isArray(lg.parsed_products) ? lg.parsed_products : [])) { const p = mapPlanItem(it); if (!p.product_id) continue; const k = String(p.product_id); const cur = city._plan.get(k); if (cur) { cur.requested_qty += p.requested_qty; if (!cur.barcodes.length) cur.barcodes = p.barcodes; } else city._plan.set(k, p); }
    }
    return [...byCity.values()].map((c) => ({ key: c.key, warehouse: c.warehouse, logistics_id: c.logistics_id, supply: c.supply, plan: [...c._plan.values()] }));
  };
  const buildCitiesOzon = (logistics) => {
    const byCity = new Map();
    for (const lg of logistics) {
      const pp = Array.isArray(lg.parsed_products) ? lg.parsed_products : [];
      const ppById = new Map(pp.map((x) => [String(x.product_id), x]));
      for (const d of (Array.isArray(lg.distribution) ? lg.distribution : [])) {
        const wh = String(d.warehouse_name || '').trim(); const pid = d.product_id; if (!wh || pid == null) continue;
        const supply = String(d.delivery_number || '').trim(); const key = supply ? `${wh} (${supply})` : wh;
        if (!byCity.has(key)) byCity.set(key, { key, warehouse: wh, logistics_id: lg.id ?? lg.logistics_id ?? null, supply, _plan: new Map() });
        const city = byCity.get(key); const info = ppById.get(String(pid)) || {};
        const cur = city._plan.get(String(pid)) || { product_id: pid, name: info.name || '', article: info.vendor_code || d.article || '', barcodes: [info.barcode, info.barcode_ozon].filter(Boolean), size: info.size || '', requested_qty: 0, photo_url: info.photo_url || '' };
        cur.requested_qty += Number(d.quantity) || 0; city._plan.set(String(pid), cur);
      }
    }
    return [...byCity.values()].map((c) => ({ key: c.key, warehouse: c.warehouse, logistics_id: c.logistics_id, supply: c.supply, plan: [...c._plan.values()] }));
  };
  const buildCities = (full, ozon) => {
    const logistics = Array.isArray(full?.logistics) ? full.logistics : [];
    let list = ozon ? buildCitiesOzon(logistics) : buildCitiesWb(logistics);
    if (!list.length) { const pl = logistics.flatMap((lg) => (Array.isArray(lg.parsed_products) ? lg.parsed_products : [])).map(mapPlanItem).filter((p) => p.product_id); const nm = request?.company_name || 'Склад'; if (pl.length) list = [{ key: nm, warehouse: nm, logistics_id: null, supply: '', plan: pl }]; }
    citiesRef.current = list;
    setActiveKey(list[0]?.key || '');
    ensureCityStates();
  };

  const loadPrefixes = async () => { try { const res = await api('/api/box-prefixes'); if (!res.ok) return; const d = await res.json(); prefixesRef.current = d?.prefixes || []; } catch (_) {} };
  const loadFullRequest = async (id) => {
    try {
      const res = await api(`/api/requests/full/${id}`);
      if (res.status === 404 || res.status === 403) { setError('Нет доступа к заявке на этом аккаунте. Откройте её на ПК или попросите доступ к «Заявкам».'); return null; }
      if (!res.ok) { setError(`Не удалось загрузить заявку (сервер ${res.status}).`); return null; }
      return await res.json();
    } catch (e) { setError('Сеть недоступна: ' + (e?.message || e)); return null; }
  };
  const loadDraft = async () => {
    try {
      const res = await api(`/api/manual-distribution/draft/${request.id}`);
      if (!res.ok) return; const d = await res.json(); if (!d?.exists || !d.draft) return;
      const wh = d.draft.warehouses || {};
      for (const c of citiesRef.current) {
        const st = wh[c.key]; if (!st) continue;
        const boxes = (st.boxes || []).map((b) => ({ article: b.article, box_number: b.box_number ?? null, box_id: b.box_id ?? null, prefix: b.prefix || (String(b.article || '').split('_')[0]) || '', closed: true, items: Object.fromEntries((b.products || []).map((pp) => [pp.product?.product_id ?? pp.product?.id ?? pp.product_id ?? pp.id, Number(pp.quantity) || 0]).filter(([pid]) => pid != null)), codes: [], cellTaken: [] }));
        cityStateRef.current[c.key] = { boxes, selectedPrefix: st.selectedPrefix || prefixesRef.current[0]?.prefix || '', closed: (d.draft.closedWarehouses || []).includes(c.key) };
      }
    } catch (_) {}
  };
  const loadPlaces = useCallback(async () => {
    const map = {}; const seen = new Set(); const queue = [];
    for (const c of citiesRef.current) for (const p of c.plan) { if (seen.has(p.product_id)) continue; seen.add(p.product_id); if (p.barcodes[0]) queue.push({ pid: p.product_id, code: p.barcodes[0] }); }
    const worker = async () => { while (queue.length) { const { pid, code } = queue.shift(); try { const res = await api(`/api/cells/scan?code=${encodeURIComponent(code)}`); if (res.ok) { const d = await res.json(); if (d?.found && d.kind === 'product') map[pid] = (d.places || []).filter((pl) => Number(pl.quantity) > 0); } } catch (_) {} } };
    await Promise.all([worker(), worker(), worker(), worker()]);
    placesRef.current = map; setPlacesLoaded(true); rerender();
  }, [rerender]);

  const open = useCallback(async () => {
    setLoading(true); setError(''); citiesRef.current = []; cityStateRef.current = {}; setActiveKey(''); setLastMsg(null); setSavedNote(''); placesRef.current = {}; setPlacesLoaded(false);
    try {
      await loadPrefixes();
      const full = await loadFullRequest(request.id);
      const bt = String(full?.barcode_type || request?.barcode_type || '').toLowerCase(); setFullBt(bt);
      setFinalized((full?.logistics || []).some((lg) => Array.isArray(lg.box_warehouse_distribution) && lg.box_warehouse_distribution.length > 0));
      buildCities(full || request, bt === 'ozon');
      await loadDraft();
    } finally { setLoading(false); rerender(); }
    if (showCell || takeFromCell) loadPlaces();
    refocus();
  }, [request, loadPlaces, refocus, rerender]);

  useEffect(() => { open(); }, [open]);

  // ---------- счётчики ----------
  const sessionQty = (pid) => (state?.boxes || []).reduce((s, b) => s + (b.items[pid] || 0), 0);
  const doneQty = (p) => sessionQty(p.product_id);
  const leftQty = (p) => Math.max(0, p.requested_qty - doneQty(p));
  const totalLeft = plan.reduce((s, p) => s + leftQty(p), 0);
  const productByCode = (code) => { const c = String(code || '').trim(); return plan.find((p) => p.barcodes.includes(c)) || null; };
  const cellsText = (pid) => (placesRef.current[pid] || []).filter((pl) => Number(pl.quantity) > 0).map((pl) => `${pl.code} ×${pl.quantity}`).join(', ');
  const firstCell = (pid) => (placesRef.current[pid] || []).find((pl) => Number(pl.quantity) > 0)?.code || (placesRef.current[pid] || [])[0]?.code || '';

  // ---------- снятие с ячейки ----------
  const takeOneFromCell = (p) => {
    const pls = placesRef.current[p.product_id] || []; const place = pls.find((pl) => Number(pl.quantity) > 0) || pls[0]; const box = current;
    if (!place || !place.node_id) { logLine('error', `${p.name}: не знаю, с какой ячейки снять`); return; }
    (async () => {
      try {
        const res = await api('/api/cells/stock/take', { method: 'POST', body: JSON.stringify({ node_id: place.node_id, product_id: p.product_id, company_id: place.company_id || 0, quality: 'good', quantity: 1, source: 'tsd' }) });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) { logLine('error', `${p.name}: снятие — ${d.detail?.message || d.detail || d.message || ('ошибка ' + res.status)}`); return; }
        place.quantity = Math.max(0, Number(place.quantity) - 1);
        if (box) (box.cellTaken ||= []).push({ node_id: place.node_id, company_id: place.company_id || 0, product_id: p.product_id, qty: 1 });
        logLine('ok', `${p.name}: снято с ячейки ${place.code}`); rerender();
      } catch (_) { logLine('error', `${p.name}: снятие не прошло`); }
    })();
  };
  const takeQtyFromCell = async (p, n) => {
    let need = Math.floor(Number(n) || 0); const pls = placesRef.current[p.product_id] || []; const box = current;
    for (const place of pls) {
      if (need <= 0) break; if (!place?.node_id) continue; const avail = Number(place.quantity) || 0; if (avail <= 0) continue; const take = Math.min(need, avail);
      try {
        const res = await api('/api/cells/stock/take', { method: 'POST', body: JSON.stringify({ node_id: place.node_id, product_id: p.product_id, company_id: place.company_id || 0, quality: 'good', quantity: take, source: 'tsd' }) });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) { logLine('error', `${p.name}: снятие — ${d.detail?.message || d.detail || d.message || ('ошибка ' + res.status)}`); continue; }
        place.quantity = Math.max(0, avail - take); if (box) (box.cellTaken ||= []).push({ node_id: place.node_id, company_id: place.company_id || 0, product_id: p.product_id, qty: take }); need -= take;
      } catch (_) { logLine('error', `${p.name}: снятие не прошло`); }
    }
    if (need > 0) logLine('error', `${p.name}: в ячейках не хватило — ${need} не снято`);
    rerender();
  };

  // ---------- коробки ----------
  const createBox = async () => {
    if (finalized) { logLine('error', 'Распределение завершено — отмените на сайте'); sound('error', 'Завершено'); return; }
    if (cityClosed) { logLine('error', 'Город закрыт — откройте его'); return; }
    const pfx = state?.selectedPrefix; if (!pfx) { logLine('error', 'Сначала выберите префикс'); sound('error', 'Нет префикса'); return; }
    if (current) { logLine('error', 'Сначала закройте текущую коробку'); return; }
    let article, box_id = null;
    try { const res = await api(`/api/boxes/next/${encodeURIComponent(pfx)}?owner=${encodeURIComponent(owner)}`); const d = await res.json().catch(() => ({})); if (!res.ok || d.error || !d.next) throw new Error(d.error || `Сервер ответил ${res.status}`); article = d.next; box_id = d.box_id ?? null; }
    catch (e) { logLine('error', 'Не удалось создать коробку: ' + e.message); sound('error', 'Ошибка коробки'); return; }
    state.boxes.unshift({ article, box_number: null, box_id, prefix: pfx, closed: false, items: {}, codes: [], cellTaken: [] });
    logLine('ok', `Коробка ${article} создана — пикайте товар`); sound('step', 'Коробка создана'); rerender(); refocus();
  };
  const boxUnits = current ? Object.values(current.items).reduce((s, n) => s + n, 0) : 0;
  const closeBox = () => { const box = current; if (!box) return; const units = Object.values(box.items).reduce((s, n) => s + n, 0); if (units === 0) { logLine('error', 'Коробка пустая — сначала пикните товар'); sound('error', 'Коробка пустая'); return; } box.closed = true; logLine('ok', `Коробка ${box.article} закрыта (${units} шт)`); sound('ok', 'Коробка закрыта'); rerender(); refocus(); };
  const removeBox = async (box) => {
    const had = (box.cellTaken || []).length > 0; const still = [];
    for (const t of (box.cellTaken || [])) { let ok = true; try { const res = await api('/api/cells/stock/put', { method: 'POST', body: JSON.stringify({ node_id: t.node_id, product_id: t.product_id, company_id: t.company_id || 0, quality: 'good', quantity: t.qty, source: 'tsd' }) }); ok = res.ok; } catch (_) { ok = false; } if (ok) { const pls = placesRef.current[t.product_id] || []; const pl = pls.find((x) => x.node_id === t.node_id); if (pl) pl.quantity += t.qty; } else still.push(t); }
    if (still.length) { box.cellTaken = still; logLine('error', `${box.article}: не удалось вернуть в ячейку — коробка не удалена`); sound('error', 'Ошибка возврата'); rerender(); return; }
    box.cellTaken = []; let delOk = true;
    try { const res = await api(`/api/boxes/by-article/${encodeURIComponent(box.article)}`, { method: 'DELETE' }); delOk = res.ok || res.status === 404; } catch (_) { delOk = false; }
    state.boxes = state.boxes.filter((b) => b !== box);
    logLine(delOk ? 'ok' : 'error', `Коробка ${box.article} удалена${had ? ' (ячейки возвращены)' : ''}${delOk ? '' : ' — номер на сервере не снят'}`); rerender();
  };
  const cityBoxes = (state?.boxes || []).filter((b) => b.closed);
  const boxQty = (b) => Object.values(b.items).reduce((s, n) => s + n, 0);

  const toggleCity = () => { if (!state) return; if (!state.closed && current) { logLine('error', 'Закройте текущую коробку перед закрытием города'); return; } state.closed = !state.closed; sound('ok', state.closed ? 'Город закрыт' : 'Город открыт'); rerender(); };

  // ---------- скан / QtyPad ----------
  const handleScan = () => {
    const c = scan.trim(); setScan(''); if (!c) return; if (isDup(c)) return;
    if (!current) { logLine('error', 'Сначала создайте коробку'); sound('error', 'Нет коробки'); refocus(); return; }
    const p = productByCode(c); if (!p) { logLine('error', `ШК ${c} — нет в заявке`); sound('error', 'Нет в заявке'); refocus(); return; }
    if (leftQty(p) <= 0) { logLine('error', `${p.name}: план закрыт (${doneQty(p)}/${p.requested_qty})`); sound('error', 'План закрыт'); refocus(); return; }
    current.items[p.product_id] = (current.items[p.product_id] || 0) + 1; current.codes.push({ sh: c });
    if (takeFromCell) takeOneFromCell(p);
    logLine('ok', `${p.name}: в коробке ${current.items[p.product_id]} · осталось ${leftQty(p)}`);
    if (showCell) { const cell = firstCell(p.product_id); sound(cell ? 'step' : 'ok', cell ? cellSpeech(cell) : 'Ячейка неизвестна'); } else sound('ok', `Осталось ${leftQty(p)}`);
    rerender(); refocus();
  };
  const openQtyPad = (p) => {
    if (finalized) { logLine('error', 'Распределение завершено — отмените на сайте'); sound('error', 'Завершено'); return; }
    if (cityClosed) { logLine('error', 'Город закрыт — откройте его'); sound('error', 'Город закрыт'); return; }
    if (!current) { logLine('error', 'Сначала создайте коробку'); sound('error', 'Нет коробки'); return; }
    if (leftQty(p) <= 0) { logLine('error', `${p.name}: план закрыт`); sound('error', 'План закрыт'); return; }
    setPad({ pid: p.product_id, qty: 0 });
  };
  const confirmQtyPad = () => { const p = plan.find((x) => String(x.product_id) === String(pad?.pid)); const n = pad?.qty || 0; setPad(null); if (p && n > 0) addQtyToBox(p, n); refocus(); };
  const addQtyToBox = (p, n) => {
    if (!current) return; const add = Math.min(Math.max(0, Math.floor(Number(n) || 0)), leftQty(p)); if (add <= 0) return;
    current.items[p.product_id] = (current.items[p.product_id] || 0) + add; current.codes.push({ sh: `+${add}` });
    if (takeFromCell) takeQtyFromCell(p, add);
    logLine('ok', `${p.name}: добавлено ${add} · в коробке ${current.items[p.product_id]} · осталось ${leftQty(p)}`); sound('ok', leftQty(p) ? `Осталось ${leftQty(p)}` : 'План закрыт'); rerender();
  };

  // ---------- сохранение ----------
  const boxNumberOf = (b) => b.box_number || (Number(String(b.article || '').split('_').pop()) || null);
  const buildBoxProduct = (p, qty, cityKey, supply, ozon) => {
    const bc = (p.barcodes && p.barcodes[0]) || '';
    if (ozon) return { _unique_key: `${cityKey}__${p.product_id}__${p.article || ''}`, product_id: Number(p.product_id), vendor_code: p.article || '', product_name: p.name || '', name: p.name || '', size: p.size || '', quantity: Number(qty) || 0, max_quantity: p.requested_qty || 0, quantity_in_supply: p.requested_qty || 0, barcode: bc, product_barcode: bc, photo_url: p.photo_url || '', supply_number: supply || '' };
    return { product: { product_id: Number(p.product_id), id: Number(p.product_id), name: p.name || '', product_name: p.name || '', vendor_code: p.article || '', article: p.article || '', size: p.size || '', barcode: bc, photo_url: p.photo_url || '', requested_qty: p.requested_qty || 0 }, quantity: Number(qty) || 0 };
  };
  const buildDraftPayload = () => {
    const ozon = isOzon; const warehouses = {};
    for (const c of citiesRef.current) {
      const st = cityStateRef.current[c.key]; if (!st) continue;
      const boxes = (st.boxes || []).filter((b) => Object.keys(b.items).length).map((b) => {
        const products = Object.entries(b.items).map(([pid, qty]) => { const p = c.plan.find((x) => String(x.product_id) === String(pid)) || { product_id: pid, name: '', article: '', barcodes: [], size: '', requested_qty: 0, photo_url: '' }; return buildBoxProduct(p, qty, c.key, c.supply, ozon); });
        const box = { article: b.article, box_number: boxNumberOf(b), box_id: b.box_id, prefix: b.prefix, reserved: true, pending: false, completed: false, products };
        if (ozon) { box.warehouse = c.warehouse; box.supply_number = c.supply || ''; }
        return box;
      });
      warehouses[c.key] = { boxes, selectedPrefix: st.selectedPrefix || '', isSaved: !!st.closed };
    }
    return { request_id: request.id, warehouses, closed_warehouses: citiesRef.current.filter((c) => cityStateRef.current[c.key]?.closed).map((c) => c.key), selected_warehouse: activeKey || null };
  };
  const totalBoxes = citiesRef.current.reduce((s, c) => s + ((cityStateRef.current[c.key]?.boxes || []).filter((b) => Object.keys(b.items).length).length), 0);
  const doSave = async () => {
    setSaving(true); setSavedNote('');
    try {
      const res = await api('/api/manual-distribution/draft/save-full', { method: 'POST', body: JSON.stringify(buildDraftPayload()) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.success === false) throw new Error(d.detail || d.error || `Сервер ответил ${res.status}`);
      setSavedNote('Сохранено — раскладка видна на сайте. Завершите распределение на сайте.'); sound('ok', 'Сохранено');
    } catch (e) { logLine('error', 'Не сохранилось: ' + e.message); sound('error', 'Ошибка сохранения'); }
    finally { setSaving(false); }
  };
  const saveAll = () => {
    if (saving) return;
    if (finalized) { logLine('error', 'Распределение завершено — отмените на сайте'); sound('error', 'Завершено'); return; }
    if (current) { logLine('error', 'Закройте текущую коробку перед сохранением'); sound('error', 'Закройте коробку'); return; }
    if (!totalBoxes) { logLine('error', 'Нет ни одной коробки с товаром'); sound('error', 'Нечего сохранять'); return; }
    Alert.alert('Сохранить распределение?', 'Раскладка появится на сайте. Завершение — на сайте.', [{ text: 'Отмена', style: 'cancel' }, { text: 'Сохранить', onPress: doSave }]);
  };
  const goBack = () => { if (totalBoxes && !savedNote) { Alert.alert('Выйти?', 'Несохранённая раскладка потеряется (нажмите «Сохранить всё»).', [{ text: 'Остаться', style: 'cancel' }, { text: 'Выйти', style: 'destructive', onPress: onBack }]); return; } onBack(); };

  const setPrefix = (pfx) => { if (state) { state.selectedPrefix = pfx; rerender(); } };
  const toggleShowCell = () => { const v = !showCell; setShowCell(v); if (v && !placesLoaded) loadPlaces(); };
  const toggleTake = () => { const v = !takeFromCell; setTakeFromCell(v); if (v && !placesLoaded) loadPlaces(); };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={`Распределение · №${request?.id}`} subtitle={owner} onBack={goBack}
        right={<Pressable onPress={open} hitSlop={8} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: '#ffffff22', alignItems: 'center', justifyContent: 'center' }}>{loading ? <ActivityIndicator color={colors.onDark} size="small" /> : <Text style={{ color: colors.onDark, fontSize: 18 }}>↻</Text>}</Pressable>} />

      {loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} /> : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 24, gap: 10 }}>
          {error ? <Banner kind="error" text={error} /> : null}
          {finalized ? <Banner kind="note" text="Распределение завершено на сайте — правка с ТСД запрещена." /> : null}
          {savedNote ? <Banner kind="note" text={savedNote} /> : null}

          {/* города */}
          {cities.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {cities.map((c) => (
                <Pressable key={c.key} onPress={() => setActiveKey(c.key)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: c.key === activeKey ? colors.primary : colors.border, backgroundColor: c.key === activeKey ? colors.primary + '14' : colors.surface }}>
                  <Text style={{ fontFamily: font.semibold, fontSize: 12, color: c.key === activeKey ? colors.primary : colors.muted }}>{c.warehouse}{cityStateRef.current[c.key]?.closed ? ' ✓' : ''}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          {activeCity ? <Text style={{ fontFamily: font.bold, fontSize: 15, color: colors.ink }}>{activeCity.key}</Text> : null}

          {/* короб */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <Text style={{ fontFamily: font.semibold, fontSize: 12, color: colors.muted }}>Префикс:</Text>
            {prefixesRef.current.map((pf) => (
              <Pressable key={pf.prefix} onPress={() => setPrefix(pf.prefix)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: state?.selectedPrefix === pf.prefix ? colors.primary : colors.border, backgroundColor: state?.selectedPrefix === pf.prefix ? colors.primary + '14' : colors.surface }}>
                <Text style={{ fontFamily: font.semibold, fontSize: 12, color: state?.selectedPrefix === pf.prefix ? colors.primary : colors.muted }}>{pf.prefix}</Text>
              </Pressable>
            ))}
          </View>

          {current ? (
            <View style={{ backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.primary, borderRadius: radius.md, padding: 12, gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontFamily: font.bold, fontSize: 14, color: colors.ink }}>Коробка {current.article}</Text>
                <Text style={{ fontFamily: font.semibold, fontSize: 12, color: colors.muted }}>{boxUnits} шт</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable onPress={closeBox} style={[submitBtn, { flex: 1, minHeight: 44 }]}><Text style={submitTxt}>Закрыть коробку</Text></Pressable>
                <Pressable onPress={() => removeBox(current)} style={[outlineBtn, { minHeight: 44, paddingHorizontal: 14 }]}><Text style={[outlineTxt, { color: colors.danger }]}>Удалить</Text></Pressable>
              </View>
            </View>
          ) : (
            <Pressable onPress={createBox} disabled={finalized || cityClosed} style={[submitBtn, (finalized || cityClosed) && { opacity: 0.5 }]}><Text style={submitTxt}>+ Создать коробку</Text></Pressable>
          )}

          <ScanField ref={scanRef} value={scan} onChangeText={setScan} onSubmit={handleScan} showKeyboard={showKb} onToggleKeyboard={() => setShowKb((s) => !s)} placeholder={current ? 'Пикните ШК товара в коробку…' : 'Сначала создайте коробку'} />
          {lastMsg ? <Text style={{ fontFamily: font.medium, fontSize: 13, color: lastMsg.kind === 'error' ? colors.danger : colors.primary }}>{lastMsg.text}</Text> : null}

          <View style={{ flexDirection: 'row', gap: 14 }}>
            <Toggle on={showCell} label="Ячейка" onPress={toggleShowCell} />
            <Toggle on={takeFromCell} label="Снимать с ячейки" onPress={toggleTake} />
          </View>

          {/* план */}
          <Text style={sectionTxt}>План города · осталось {totalLeft}</Text>
          {plan.map((p) => { const left = leftQty(p); const done = doneQty(p); return (
            <View key={String(p.product_id)} style={[planRow, left === 0 && { opacity: 0.55 }]}>
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                {photoOf(p) ? <Pressable onPress={() => setLightbox({ src: photoOf(p), name: p.name })}><Image source={{ uri: photoOf(p) }} style={thumb} /></Pressable> : null}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: font.semibold, fontSize: 13, color: colors.ink }} numberOfLines={2}>{p.name || '—'}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {p.size ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.muted }}>р.{p.size}</Text> : null}
                    {p.barcodes[0] ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.muted }}>{shkHead(p.barcodes[0])}<Text style={{ fontFamily: font.bold, color: colors.ink }}>{shkTail(p.barcodes[0])}</Text></Text> : null}
                    {showCell && cellsText(p.product_id) ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.primary }}>📍 {cellsText(p.product_id)}</Text> : null}
                  </View>
                </View>
                <Pressable onPress={() => openQtyPad(p)} style={{ alignItems: 'center', minWidth: 56, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: colors.bg }}>
                  <Text style={{ fontFamily: font.bold, fontSize: 16, color: left === 0 ? colors.success : colors.ink }}>{done}/{p.requested_qty}</Text>
                  <Text style={{ fontFamily: font.medium, fontSize: 10, color: colors.muted }}>{left === 0 ? 'готово' : `ост. ${left}`}</Text>
                </Pressable>
              </View>
            </View>
          ); })}

          {/* закрытые коробки города */}
          {cityBoxes.length ? (
            <View style={{ gap: 6 }}>
              <Text style={sectionTxt}>Коробки города ({cityBoxes.length})</Text>
              {cityBoxes.map((b) => (
                <View key={b.article} style={[planRow, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
                  <Text style={{ fontFamily: font.semibold, fontSize: 13, color: colors.ink }}>{b.article}</Text>
                  <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                    <Text style={{ fontFamily: font.semibold, fontSize: 12, color: colors.muted }}>{boxQty(b)} шт</Text>
                    {!finalized ? <Pressable onPress={() => removeBox(b)} hitSlop={6}><Text style={{ fontFamily: font.bold, color: colors.danger }}>✕</Text></Pressable> : null}
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            <Pressable onPress={toggleCity} style={[outlineBtn, { flex: 1, minHeight: 46 }]}><Text style={outlineTxt}>{cityClosed ? 'Открыть город' : 'Закрыть город'}</Text></Pressable>
            <Pressable onPress={saveAll} disabled={saving || finalized} style={[submitBtn, { flex: 1, minHeight: 46 }, (saving || finalized) && { opacity: 0.5 }]}><Text style={submitTxt}>{saving ? 'Сохраняю…' : 'Сохранить всё'}</Text></Pressable>
          </View>
        </ScrollView>
      )}

      {/* QtyPad */}
      <Modal visible={!!pad} transparent animationType="slide" onRequestClose={() => setPad(null)}>
        <Pressable style={sheetBackdrop} onPress={() => setPad(null)}>
          <Pressable style={[sheetBody, { paddingBottom: insets.bottom + 14 }]} onPress={() => {}}>
            {pad ? (() => { const p = plan.find((x) => String(x.product_id) === String(pad.pid)); if (!p) return null; const max = leftQty(p); return (
              <>
                <Text style={{ fontFamily: font.bold, fontSize: 15, color: colors.ink }} numberOfLines={1}>{p.name}</Text>
                <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.muted }}>в коробку · осталось по плану {max}</Text>
                <QtyPad value={pad.qty} onChange={(v) => setPad((s) => ({ ...s, qty: v }))} limit={max} onOver={() => sound('error', 'Больше плана нельзя')} />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Pressable onPress={() => setPad(null)} style={[outlineBtn, { flex: 1 }]}><Text style={outlineTxt}>Отмена</Text></Pressable>
                  <Pressable onPress={confirmQtyPad} style={[submitBtn, { flex: 1 }]}><Text style={submitTxt}>Добавить {pad.qty || 0}</Text></Pressable>
                </View>
              </>
            ); })() : null}
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

function Toggle({ on, label, onPress }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{on ? <Text style={{ color: '#fff', fontSize: 13 }}>✓</Text> : null}</View>
      <Text style={{ fontFamily: font.medium, fontSize: 12, color: colors.muted }}>{label}</Text>
    </Pressable>
  );
}
function Banner({ kind, text }) { const err = kind === 'error'; return <View style={{ backgroundColor: err ? colors.danger + '15' : colors.success + '18', borderWidth: 1, borderColor: err ? colors.danger + '40' : colors.success + '55', borderRadius: radius.md, padding: 11 }}><Text style={{ fontFamily: font.medium, fontSize: 13, color: err ? colors.danger : colors.primary }}>{text}</Text></View>; }

const sectionTxt = { fontFamily: font.semibold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.muted, marginTop: 4 };
const planRow = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10 };
const thumb = { width: 46, height: 46, borderRadius: 8, backgroundColor: colors.bg };
const submitBtn = { minHeight: 50, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 };
const submitTxt = { fontFamily: font.bold, fontSize: 15, color: '#fff' };
const outlineBtn = { minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' };
const outlineTxt = { fontFamily: font.semibold, fontSize: 14, color: colors.ink };
const sheetBackdrop = { flex: 1, backgroundColor: 'rgba(10,20,20,0.45)', justifyContent: 'flex-end' };
const sheetBody = { backgroundColor: colors.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, gap: 10 };
