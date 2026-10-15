import { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Modal, Image, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenHeader from '../../components/ScreenHeader';
import ScanField from '../../components/ScanField';
import QtyPad from '../../components/QtyPad';
import { api, getUserName, getEmail } from '../../lib/api';
import { speak, formatCellSpeech, getCellVoiceMode } from '../../lib/cells';
import { useScanDedup } from '../../lib/scanner';
import { lsGet, lsSet, lsRemove } from '../../lib/storage';
import { colors, font, radius, shadow } from '../../theme';

// Приёмка (порт PriemkaModule.vue). Три шага: список заявок (канбан, стадия
// «Приемка» column_id=4) / работа по заявке (приём + размещение) / приём без
// заявки. Главное правило по заявке — принимаем ТОЛЬКО заявленное. Приход один на
// заявку и только в конце (POST /api/sklad/prikhod/batch на разницу), плюс запись
// «Принято» qty_p в саму заявку (PATCH /api/forms/supply/{id}/items/{linkId}).
const ACCEPTANCE_COLUMN = 4;
const PRIEMKA_DRAFT_KEY = 'tsd.priemkaDraft';
const sound = (kind, text) => { if (text) speak(String(text)); };
const cellSpeech = (code) => formatCellSpeech(code, getCellVoiceMode());
const shkTail = (c) => String(c || '').slice(-4);
const shkHead = (c) => { const s = String(c || ''); return s.length > 4 ? s.slice(0, -4) : ''; };
const photoOf = (it) => it?.photo || it?.photo_url || it?.image_url || it?.image || '';
const itemSize = (it) => String(it?.size || it?.tech_size || it?.wb_size || '').trim();
const itemArt = (it) => String(it?.article || it?.offer_id || '').trim();
const pad2 = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
const fmtDateTime = (d) => `${fmtDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

export default function PriemkaScreen({ mod }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scanRef = useRef(null);
  const isDup = useScanDedup();

  const [step, setStep] = useState('list'); // 'list' | 'work' | 'noreq'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastMsg, setLastMsg] = useState(null); // { kind, text }
  const [requests, setRequests] = useState([]);
  const [scan, setScan] = useState('');
  const [showKb, setShowKb] = useState(false);
  const whRef = useRef(null);
  const [, force] = useState(0);
  const rerender = () => force((n) => (n + 1) % 1e9);

  // по заявке
  const requestRef = useRef(null);
  const rowsRef = useRef([]);
  const [screenMode, setScreenMode] = useState('accept'); // 'accept' | 'place'
  const [submitted, setSubmitted] = useState(false);
  const [cell, setCell] = useState(null);
  const [pending, setPending] = useState(null); // { row, qty, manual, mode, max, free }
  const [overConfirm, setOverConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);

  // режим подсчёта (общий для заявки и без-заявки)
  const [countMode, setCountMode] = useState('qty'); // 'qty' | 'each'

  // без заявки
  const [nrQuality, setNrQuality] = useState('good');
  const [nrItems, setNrItems] = useState([]);
  const [nrCell, setNrCell] = useState(null);
  const [nrEdit, setNrEdit] = useState(null); // { row, field }
  const [nrConfirm, setNrConfirm] = useState(false);
  const [nrSubmitting, setNrSubmitting] = useState(false);
  const [nrFlashId, setNrFlashId] = useState(null);
  const [nrDelArm, setNrDelArm] = useState(null);
  const nrDelTimer = useRef(null);

  const [lightbox, setLightbox] = useState('');

  const rows = rowsRef.current;
  const request = requestRef.current;

  const refocus = useCallback(() => { setTimeout(() => scanRef.current?.focus(), 250); }, []);
  const log = (kind, text) => setLastMsg({ kind, text });
  const whq = (prefix) => (whRef.current ? `${prefix}warehouse_id=${whRef.current}` : '');

  // ---------- загрузка ----------
  const loadRequests = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api(`/api/requests/kanban?column_id=${ACCEPTANCE_COLUMN}`);
      if (!res.ok) throw new Error(`Сервер ответил ${res.status}`);
      const data = await res.json();
      const byRequest = new Map();
      for (const s of (data?.supply || [])) {
        const rid = s.request_id; if (!rid) continue;
        const list = byRequest.get(rid) || [];
        for (const it of (s.items || [])) list.push(it);
        byRequest.set(rid, list);
      }
      setRequests((data?.requests || []).map((r) => {
        const items = byRequest.get(r.id) || [];
        return {
          id: r.id,
          client: r.full_name || r.custom_title || `Заявка №${r.id}`,
          companyId: r.company_id || null,
          companyName: (r.company_name || r.full_name || '').split(' / ')[0].trim() || 'Без компании',
          createdAt: r.created_at || null,
          positions: items.length,
          units: items.reduce((s, i) => s + (Number(i.quantity) || 0), 0),
          items,
        };
      }).filter((r) => r.positions > 0).sort((a, b) => b.id - a.id));
    } catch (e) { setError('Не удалось загрузить заявки: ' + e.message); }
    finally { setLoading(false); }
  }, []);

  const loadShelves = useCallback(async () => {
    try {
      const wr = await api('/api/cells/warehouses');
      if (!wr.ok) return;
      const list = (await wr.json())?.items || [];
      whRef.current = (list.find((w) => w.is_default) || list[0])?.id || null;
    } catch (_) {}
  }, []);

  useEffect(() => {
    loadRequests(); loadShelves();
    (async () => { const v = await lsGet('tsd.nrCountMode'); if (v === 'qty' || v === 'each') setCountMode(v); })();
  }, [loadRequests, loadShelves]);

  // чистим панели при смене шага (инвариант фокуса/клавиатуры)
  useEffect(() => { setPending(null); setOverConfirm(false); setNrEdit(null); setNrConfirm(false); }, [step]);

  // ---------- работа по заявке ----------
  const recompute = () => rerender();

  const openRequest = (r) => {
    requestRef.current = r;
    rowsRef.current = r.items.map((it) => {
      const already = Number(it.qty_p) || 0;
      return {
        barcode: String(it.barcode || '').trim(),
        productId: it.product_id,
        supplyId: it.supply_id,
        linkId: it.supply_products_link_id || it.item_id || null,
        name: it.product_name || '',
        photo: it.photo_url || '',
        size: it.size || '',
        article: it.article || it.offer_id || '',
        color: it.color || '',
        need: Number(it.quantity) || 0,
        accepted: already,
        base: already,
        placed: 0,
      };
    });
    setPending(null); setOverConfirm(false); setSubmitted(false); setCell(null);
    const allAcc = rowsRef.current.every((r2) => r2.accepted >= r2.need) && rowsRef.current.length;
    setScreenMode(allAcc ? 'place' : 'accept');
    setLastMsg(null);
    setStep('work');
    refocus();
    sound('step', allAcc ? 'Всё принято. Пикните ячейку, затем товар' : `Позиций ${rowsRef.current.length}. Пикните товар`);
  };

  // производные (по текущему rowsRef)
  const donePositions = rows.filter((r) => r.accepted >= r.need && r.need > 0).length;
  const totalNeed = rows.reduce((s, r) => s + r.need, 0);
  const totalAccepted = rows.reduce((s, r) => s + r.accepted, 0);
  const pendingUnits = rows.reduce((s, r) => s + Math.max(0, r.accepted - r.base), 0);
  const shortUnits = rows.reduce((s, r) => s + Math.max(0, r.need - r.accepted), 0);
  const totalPlaced = rows.reduce((s, r) => s + r.placed, 0);
  const allPlaced = rows.length > 0 && rows.every((r) => r.placed >= r.accepted);
  const allDone = rows.length > 0 && donePositions >= rows.length;
  const sortedRows = [...rows].sort((a, b) => (a.accepted >= a.need ? 1 : 0) - (b.accepted >= b.need ? 1 : 0));

  const resolvePlace = async (code) => {
    try {
      const res = await api(`/api/cells/scan?code=${encodeURIComponent(code)}${whq('&')}`);
      if (!res.ok) return null;
      const d = await res.json();
      if (!d?.found || d.kind !== 'place') return null;
      if (d.node?.is_storable === false && !(d.items || []).length) { log('error', `«${d.node.code}» — не место хранения`); sound('error', 'Не место хранения'); return null; }
      return { id: d.node.id, label: d.node.code };
    } catch (_) { return null; }
  };

  const loadUnplaced = async (row) => {
    try {
      const res = await api(`/api/cells/products/${row.productId}/summary${whq('?')}`);
      if (!res.ok) return null;
      const d = await res.json();
      const myReq = request?.id;
      if (myReq) {
        const mine = (d?.places || []).filter((pl) => Number(pl.request_id) === Number(myReq)).reduce((s, pl) => s + (Number(pl.quantity) || 0), 0);
        if (mine > row.placed) row.placed = mine;
      }
      const n = Number(d?.unplaced_quantity);
      return Number.isFinite(n) ? n : null;
    } catch (_) { return null; }
  };

  const openRow = async (row, manual) => {
    const mode = screenMode;
    let left, freeOnStock = null;
    if (mode === 'place') {
      const free = await loadUnplaced(row);
      freeOnStock = free;
      const byRequest = Math.max(0, row.accepted - row.placed);
      left = free == null ? byRequest : Math.min(free, byRequest);
      if (left <= 0) { log('ok', `${row.name}: по этой заявке всё разложено`); sound('ok', 'По заявке всё разложено'); recompute(); return; }
    } else {
      left = Math.max(0, row.need - row.accepted);
    }
    setPending({ row, qty: left > 0 ? left : 1, manual, mode, max: mode === 'place' ? left : null, free: mode === 'place' ? freeOnStock : null });
    setOverConfirm(false);
    if (mode === 'place') sound('step', cell ? `Положить ${left}` : `Положить ${left}. Сначала ячейка`);
    else sound('step', left > 0 ? `Надо ${left}` : 'Позиция закрыта');
  };

  const eachAcceptScan = (row) => {
    row.accepted += 1;
    if (row.accepted > row.need) { log('error', `${row.name}: перебор ${row.accepted} из ${row.need}`); sound('error', `Перебор. Заявлено ${row.need}`); }
    else { log('done', `${row.name}: ${row.accepted} из ${row.need}`); sound('ok', String(row.accepted)); }
    recompute(); refocus();
  };

  const applyQty = async () => {
    if (!pending) return;
    if (pending.mode === 'place') { await placeRow(); return; }
    const { row, qty } = pending;
    const willBe = row.accepted + qty;
    if (willBe > row.need && !overConfirm) { setOverConfirm(true); log('error', `Перебор: станет ${willBe} при заявленных ${row.need}`); sound('error', `Перебор. Заявлено ${row.need}`); return; }
    row.accepted = willBe;
    setPending(null); setOverConfirm(false);
    log('done', `${row.name}: внесено ${qty} (${row.accepted} из ${row.need})`);
    sayAfterAccept(row);
    recompute(); refocus();
  };

  const resetRow = () => {
    if (!pending || pending.mode !== 'accept') return;
    const { row } = pending;
    if (row.accepted <= row.base) return;
    row.accepted = row.base;
    setPending((p) => ({ ...p, qty: Math.max(1, row.need - row.accepted) }));
    setOverConfirm(false);
    log('ok', `${row.name}: сброшено до ${row.base} из ${row.need}`);
    sound('ok', `Сброшено. Надо ${Math.max(0, row.need - row.accepted)}`);
    recompute();
  };

  const placeRow = async () => {
    const { row, max } = pending;
    const qty = max ? Math.min(pending.qty, max) : pending.qty;
    if (!cell) { log('error', 'Сначала пикните этикетку ячейки'); sound('error', 'Сначала ячейка'); return; }
    if (placing) return;
    setPlacing(true);
    try {
      const res = await api('/api/cells/stock/put', {
        method: 'POST',
        body: JSON.stringify({ node_id: cell.id, product_id: row.productId, company_id: request?.companyId || 0, quality: 'good', quantity: qty, request_id: request?.id || null, source: 'tsd' }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.detail || d.message || `Сервер ответил ${res.status}`);
      row.placed += qty;
      setPending(null);
      log('done', `${row.name}: ${qty} шт → ячейка ${cell.label} (разложено ${row.placed} из ${row.accepted})`);
      const after = rows.length > 0 && rows.every((r) => r.placed >= r.accepted);
      sound('ok', after ? 'Всё размещено' : `${cellSpeech(cell.label)}. Размещено`);
      recompute();
    } catch (e) { log('error', `${row.name}: не положено в ${cell.label} — ${e.message}`); sound('error', 'Ошибка размещения'); }
    finally { setPlacing(false); refocus(); }
  };

  const arrivalDate = () => { const raw = request?.createdAt; const d = raw ? new Date(raw) : new Date(); return fmtDate(isNaN(d) ? new Date() : d); };
  const nrEmp = () => getUserName() || getEmail() || '';

  const sayAfterAccept = (row) => {
    if (allDone) { sound('ok', 'Заявка принята полностью'); return; }
    if (row.accepted >= row.need) {
      const left = rows.length - rows.filter((r) => r.accepted >= r.need && r.need > 0).length;
      sound('ok', left === 1 ? 'Позиция закрыта. Осталась одна' : `Позиция закрыта. Осталось ${left}`);
      return;
    }
    sound('ok', `Принято. Недобрано ${row.need - row.accepted}`);
  };

  const setMode = (m) => {
    if (screenMode === m) return;
    setScreenMode(m); setPending(null); setOverConfirm(false);
    log('ok', m === 'place' ? 'Режим размещения: пикните ячейку, затем товар' : 'Режим приёмки: пикните товар');
    sound('step', m === 'place' ? 'Ячейка, затем товар' : 'Пикните товар');
    refocus();
  };

  const saveAccepted = async (changed) => {
    for (const r of changed) {
      if (!r.supplyId || !r.linkId) { log('error', `${r.name}: нет идентификатора позиции — «Принято» не записано`); continue; }
      try {
        const res = await api(`/api/forms/supply/${r.supplyId}/items/${r.linkId}`, { method: 'PATCH', body: JSON.stringify({ qty_p: r.accepted }) });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.detail || `Сервер ответил ${res.status}`);
        if (!(d.updated || []).includes('qty_p')) throw new Error('сервер не подтвердил запись');
      } catch (e) { log('error', `${r.name}: «Принято» в заявке не записалось — ${e.message}`); }
    }
  };

  const syncCache = () => {
    const items = request?.items || [];
    for (const it of items) { const row = rows.find((r) => r.barcode === String(it.barcode || '').trim()); if (row) it.qty_p = row.accepted; }
  };

  const submitReceipt = async () => {
    if (submitting) return;
    const filled = rows.filter((r) => r.accepted > r.base);
    const changed = rows.filter((r) => r.accepted !== r.base);
    if (!changed.length) return;
    setSubmitting(true); setError('');
    try {
      if (filled.length) {
        const res = await api('/api/sklad/prikhod/batch', {
          method: 'POST',
          body: JSON.stringify({
            request_id: request?.id || null,
            company_id: request?.companyId || undefined,
            company_name: request?.companyName || undefined,
            arrival_name: `Заявка #${request?.id}`,
            arrival_title: `Заявка №${request?.id} от ${arrivalDate()}`,
            items: filled.map((r) => ({ product_id: r.productId, product_name: r.name, barcode: r.barcode, quantity: r.accepted - r.base, defect_quantity: 0 })),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || data.message || `Сервер ответил ${res.status}`);
        log('done', `Приход создан: позиций ${filled.length}, штук ${filled.reduce((s, r) => s + (r.accepted - r.base), 0)}`);
      }
      await saveAccepted(changed);
      setSubmitted(true); setScreenMode('place');
      for (const r of rows) r.base = r.accepted;
      syncCache(); recompute();
      sound('ok', 'Приход создан. Пикните ячейку, затем товар');
    } catch (e) { setError('Приход не создан: ' + e.message); log('error', `Приход не создан — ${e.message}`); sound('error', 'Ошибка прихода'); }
    finally { setSubmitting(false); }
  };

  // ---------- без заявки ----------
  const openNoReq = () => {
    setStep('noreq'); setLastMsg(null); setNrEdit(null); setNrCell(null); setNrConfirm(false);
    maybeOfferDraft();
    refocus();
  };

  const maybeOfferDraft = async () => {
    if (nrItems.length) return;
    try {
      const d = JSON.parse((await lsGet(PRIEMKA_DRAFT_KEY)) || 'null');
      if (!d || !Array.isArray(d.items) || !d.items.length) return;
      Alert.alert('Незавершённая приёмка', `Найдена незавершённая приёмка без заявки: ${d.items.length} поз. Восстановить?`, [
        { text: 'Нет', style: 'cancel', onPress: () => lsRemove(PRIEMKA_DRAFT_KEY) },
        { text: 'Восстановить', onPress: () => setNrItems(d.items) },
      ]);
    } catch (_) {}
  };

  // автосейв черновика без-заявки (дебаунс 1.5с)
  useEffect(() => {
    const t = setTimeout(() => {
      if (!nrItems.length) { lsRemove(PRIEMKA_DRAFT_KEY); return; }
      lsSet(PRIEMKA_DRAFT_KEY, JSON.stringify({ v: 1, savedAt: Date.now(), items: nrItems }));
    }, 1500);
    return () => clearTimeout(t);
  }, [nrItems]);

  const nrGoodTotal = nrItems.reduce((s, x) => s + x.good, 0);
  const nrDefectTotal = nrItems.reduce((s, x) => s + x.defect, 0);
  const nrPlaceCount = nrItems.filter((x) => x.cell && x.good > 0).length;

  const nrMerge = (list) => {
    const seen = new Map(); const out = [];
    for (const it of list) {
      const key = `${it.productId}|${it.cell?.id ?? ''}`;
      const prev = seen.get(key);
      if (prev) { prev.good += it.good; prev.defect += it.defect; } else { seen.set(key, it); out.push(it); }
    }
    return out;
  };

  const nrSetCell = (place) => {
    setNrCell(place);
    setNrItems((prev) => nrMerge(prev.map((it) => (it.cell ? it : { ...it, cell: place }))));
    setNrEdit(null); setNrConfirm(false);
    log('ok', `Ячейка ${place.label}`); sound('ok', cellSpeech(place.label)); refocus();
  };

  const nrBump = (pr, code, quality, delta) => {
    setNrItems((prev) => {
      const cellId = nrCell?.id ?? null;
      const idx = prev.findIndex((x) => x.productId === pr.id && (x.cell?.id ?? null) === cellId);
      let next, it;
      if (idx >= 0) {
        it = { ...prev[idx] };
        if (quality === 'defect') it.defect += delta; else it.good += delta;
        next = prev.slice(); next[idx] = it;
      } else {
        it = { productId: pr.id, name: pr.name || '', barcode: code, photo: pr.photo_url || '', companyId: pr.company_id ?? pr.companyId ?? null, cell: nrCell || null, good: 0, defect: 0 };
        if (quality === 'defect') it.defect += delta; else it.good += delta;
        next = [it, ...prev];
      }
      const n = quality === 'defect' ? it.defect : it.good;
      log('ok', `${it.name || it.barcode}: ${quality === 'defect' ? 'брак' : 'хор'} ${n}` + (it.cell ? ` → ${it.cell.label}` : ''));
      sound('ok', quality === 'defect' ? `брак ${n}` : String(n));
      setNrFlashId(it.productId + '|' + (it.cell?.id ?? ''));
      return next;
    });
    setNrConfirm(false); setNrDelArm(null);
  };

  const nrScan = async (code) => {
    let d = null;
    try { const res = await api(`/api/cells/scan?code=${encodeURIComponent(code)}${whq('&')}`); if (res.ok) d = await res.json(); } catch (_) {}
    if (d?.found && d.kind === 'place') {
      if (d.node?.is_storable === false && !(d.items || []).length) { log('error', `«${d.node.code}» — не место хранения`); sound('error', 'Не место хранения'); refocus(); return; }
      nrSetCell({ id: d.node.id, label: d.node.code }); return;
    }
    if (!d?.found || d.kind !== 'product' || !d.product?.id) { log('error', `${code} — товар не найден на складе`); sound('error', 'Товар не найден'); refocus(); return; }
    nrBump(d.product, code, nrQuality, 1); refocus();
  };

  const setCountModePersist = (m) => { setCountMode(m); lsSet('tsd.nrCountMode', m); if (m === 'each') { setNrEdit(null); setPending(null); } refocus(); };

  const nrEditDone = () => {
    const edit = nrEdit; setNrEdit(null);
    if (edit?.row) setNrItems((prev) => prev.filter((x) => !(x === edit.row && x.good <= 0 && x.defect <= 0)));
    refocus();
  };

  const nrRemove = (it) => {
    if (nrDelArm !== it) {
      setNrDelArm(it);
      clearTimeout(nrDelTimer.current);
      nrDelTimer.current = setTimeout(() => setNrDelArm((cur) => (cur === it ? null : cur)), 3500);
      sound('error', 'Убрать строку? Нажмите ещё раз');
      return;
    }
    clearTimeout(nrDelTimer.current); setNrDelArm(null);
    setNrItems((prev) => prev.filter((x) => x !== it));
    if (nrEdit?.row === it) setNrEdit(null);
    setNrConfirm(false);
  };

  const nrSubmit = async () => {
    if (nrSubmitting) return;
    const items = nrItems.filter((x) => x.good > 0 || x.defect > 0);
    if (!items.length) return;
    if (!nrConfirm) { setNrConfirm(true); log('ok', 'Нажмите ещё раз для подтверждения'); sound('step', 'Подтвердите'); return; }
    setNrConfirm(false); setNrSubmitting(true); setError('');
    try {
      const now = new Date();
      const res = await api('/api/sklad/prikhod/batch', {
        method: 'POST',
        body: JSON.stringify({
          request_id: null,
          arrival_name: `Приход по ТСД ${now.getTime()}`,
          arrival_title: `Приход по ТСД${nrEmp() ? ' · ' + nrEmp() : ''} · ${fmtDateTime(now)}`,
          items: items.map((x) => ({ product_id: x.productId, product_name: x.name, barcode: x.barcode, quantity: x.good, defect_quantity: x.defect })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.message || `Сервер ответил ${res.status}`);
      const toPlace = items.filter((x) => x.cell && x.good > 0);
      let placed = 0;
      for (const it of toPlace) {
        try {
          const pr = await api('/api/cells/stock/put', { method: 'POST', body: JSON.stringify({ node_id: it.cell.id, product_id: it.productId, company_id: it.companyId || 0, quality: 'good', quantity: it.good, request_id: null, source: 'tsd' }) });
          const pd = await pr.json().catch(() => ({}));
          if (!pr.ok) throw new Error(pd.detail || pd.message || `Сервер ответил ${pr.status}`);
          placed++; log('ok', `${it.name || it.barcode} → ячейка ${it.cell.label} (${it.good})`);
        } catch (e) { log('error', `${it.name || it.barcode}: в ячейку ${it.cell.label} не положено — ${e.message}`); }
      }
      log('done', `Приход по ТСД: позиций ${items.length}, хороших ${nrGoodTotal}, брак ${nrDefectTotal}` + (toPlace.length ? `, размещено ${placed} из ${toPlace.length}` : ''));
      setNrItems([]); lsRemove(PRIEMKA_DRAFT_KEY); setNrCell(null); setNrEdit(null);
      sound('ok', 'Приход создан');
      setStep('list'); loadRequests();
    } catch (e) { setError('Приход не создан: ' + e.message); log('error', `Приход не создан — ${e.message}`); sound('error', 'Ошибка прихода'); }
    finally { setNrSubmitting(false); }
  };

  // ---------- общий разбор скана ----------
  const handleCode = async (raw) => {
    const code = String(raw || '').trim();
    if (!code || isDup(code)) return;
    if (step === 'noreq') { await nrScan(code); return; }
    const place = await resolvePlace(code);
    if (place) { setCell(place); log('ok', `Ячейка ${place.label}`); sound('ok', cellSpeech(place.label)); refocus(); return; }
    const row = rows.find((r) => r.barcode && r.barcode === code);
    if (!row) {
      if (/^(lwc:|shelf:)/i.test(code) || /^[A-Za-zА-Яа-я]+-\d+/.test(code)) { log('error', `Ячейка не найдена: ${code}`); sound('error', 'Не найдено'); refocus(); return; }
      log('error', `${code} — этого товара нет в заявке`); sound('error', 'Товара нет в заявке'); refocus(); return;
    }
    if (screenMode === 'accept' && countMode === 'each') { eachAcceptScan(row); return; }
    openRow(row, false);
  };

  const onSubmitScan = () => { const raw = scan; setScan(''); handleCode(raw); };

  // ---------- выход ----------
  const goBack = () => {
    if (step === 'work') {
      if (pendingUnits > 0 && !leaveConfirm) {
        setLeaveConfirm(true);
        sound('error', `Приход не создан. Внесено ${pendingUnits}. Назад ещё раз — выйти без прихода`);
        setTimeout(() => setLeaveConfirm(false), 6000);
        return;
      }
      setLeaveConfirm(false); setStep('list'); setPending(null); setError('');
    } else if (step === 'noreq') { setStep('list'); setError(''); }
    else router.back();
  };

  const scanPlaceholder = step === 'noreq'
    ? (nrQuality === 'defect' ? 'Пикните ШК бракованного…' : 'Пикните товар или ячейку…')
    : screenMode === 'place'
      ? (cell ? `В ячейку ${cell.label}: пикните товар…` : 'Пикните этикетку ячейки…')
      : 'Пикните штрихкод товара…';

  const headerTitle = step === 'list' ? (mod?.title || 'Приёмка') : step === 'noreq' ? 'Приёмка · без заявки' : `№${request?.id}`;
  const headerSub = step === 'work' ? request?.client : step === 'noreq' ? 'приём на склад' : mod?.subtitle;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader
        title={headerTitle} subtitle={headerSub} onBack={goBack}
        right={step === 'list' ? (
          <Pressable onPress={loadRequests} hitSlop={8} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: '#ffffff22', alignItems: 'center', justifyContent: 'center' }}>
            {loading ? <ActivityIndicator color={colors.onDark} size="small" /> : <Text style={{ color: colors.onDark, fontSize: 18 }}>↻</Text>}
          </Pressable>
        ) : null}
      />

      {error ? <View style={{ paddingHorizontal: 12, paddingTop: 8 }}><Banner kind="error" text={error} /></View> : null}
      {leaveConfirm ? <View style={{ paddingHorizontal: 12, paddingTop: 8 }}><Banner kind="error" text={`Внесено ${pendingUnits} шт, приход не создан. Нажмите ‹ ещё раз, чтобы выйти.`} /></View> : null}

      {step === 'list' ? (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 24, gap: 8 }}>
          <SrcModes active="req" onReq={() => {}} onNoReq={openNoReq} />
          {requests.map((r) => {
            const accepted = (r.items || []).reduce((s, i) => s + (Number(i.qty_p) || 0), 0);
            return (
              <Pressable key={r.id} onPress={() => openRequest(r)} style={[rowCard, shadow.card]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: font.bold, fontSize: 15, color: colors.ink }}>№{r.id}</Text>
                  <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.muted }} numberOfLines={1}>{r.client}</Text>
                </View>
                <Text style={{ fontFamily: font.semibold, fontSize: 12, color: accepted >= r.units ? colors.success : colors.muted }}>{r.positions} поз · {accepted}/{r.units} шт</Text>
              </Pressable>
            );
          })}
          {!loading && !requests.length ? <Text style={hintTxt}>В приёмке нет заявок с товаром. Заявки берутся из канбана, стадия «Приемка».</Text> : null}
        </ScrollView>
      ) : step === 'noreq' ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 12, paddingTop: 8, paddingBottom: insets.bottom + 24, gap: 10 }}>
          <SrcModes active="noreq" onReq={() => setStep('list')} onNoReq={() => {}} />
          <SegRow options={[{ k: 'good', label: '✓ Хороший' }, { k: 'defect', label: '✗ Брак' }]} value={nrQuality} onChange={setNrQuality} />
          <SegRow sub options={[{ k: 'qty', label: 'Ввод количества' }, { k: 'each', label: 'По 1 шт за пик' }]} value={countMode} onChange={setCountModePersist} />
          <ScanField ref={scanRef} value={scan} onChangeText={setScan} onSubmit={onSubmitScan} showKeyboard={showKb} onToggleKeyboard={() => setShowKb((s) => !s)} placeholder={scanPlaceholder} />
          <CellRow cell={nrCell} onClear={() => setNrCell(null)} placeholder="не выбрана — пикни ячейку (необязательно)" />
          {lastMsg ? <LastLine msg={lastMsg} /> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Counter n={nrGoodTotal} label="хороших" /><Counter n={nrDefectTotal} label="брак" /><Counter n={nrItems.length} label="позиций" />
          </View>
          {!nrItems.length ? <Text style={hintTxt}>Пикайте товары — каждый ложится отдельной строкой, повтор суммируется. Пикните ячейку — товары уйдут в неё. «Оприходовать» создаст приход и разложит по ячейкам.</Text> : null}
          {nrItems.map((it) => {
            const fid = it.productId + '|' + (it.cell?.id ?? '');
            return (
              <View key={fid} style={[posCard, { borderColor: nrFlashId === fid ? colors.accent : colors.border }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Pressable disabled={countMode === 'each'} onPress={() => countMode !== 'each' && setNrEdit({ row: it, field: 'good' })} style={[chip, { backgroundColor: colors.success + '22' }]}><Text style={{ fontFamily: font.bold, color: colors.primary }}>{it.good}</Text></Pressable>
                    {it.defect ? <Pressable disabled={countMode === 'each'} onPress={() => countMode !== 'each' && setNrEdit({ row: it, field: 'defect' })} style={[chip, { backgroundColor: colors.danger + '22' }]}><Text style={{ fontFamily: font.bold, color: colors.danger }}>{it.defect}</Text></Pressable> : null}
                  </View>
                  <Pressable onPress={() => nrRemove(it)} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: nrDelArm === it ? colors.danger : 'transparent' }}>
                    <Text style={{ fontFamily: font.bold, fontSize: 13, color: nrDelArm === it ? '#fff' : colors.muted }}>{nrDelArm === it ? 'Убрать?' : '✕'}</Text>
                  </Pressable>
                </View>
                <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                  {photoOf(it) ? <Pressable onPress={() => setLightbox(photoOf(it))}><Image source={{ uri: photoOf(it) }} style={thumb} /></Pressable> : null}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: font.semibold, fontSize: 14, color: colors.ink }} numberOfLines={1}>{it.name || it.barcode || '—'}</Text>
                    <Text style={{ fontFamily: font.medium, fontSize: 11, color: it.cell ? colors.primary : colors.muted }}>{it.cell ? `📍 ${it.cell.label}` : 'без ячейки'}</Text>
                  </View>
                  {it.barcode ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.muted }}>ШК {shkHead(it.barcode)}<Text style={{ fontFamily: font.bold, color: colors.ink }}>{shkTail(it.barcode)}</Text></Text> : null}
                </View>
              </View>
            );
          })}
          {nrConfirm ? <Banner kind="over" text={`Оприходовать: ${nrGoodTotal} хороших и ${nrDefectTotal} брак${nrPlaceCount ? `, разложить ${nrPlaceCount} поз.` : ''}. Нажмите ещё раз.`} /> : null}
          <Pressable onPress={nrSubmit} disabled={nrSubmitting || !(nrGoodTotal + nrDefectTotal)} style={[submitBtn, nrConfirm && { backgroundColor: colors.warning }, (nrSubmitting || !(nrGoodTotal + nrDefectTotal)) && { opacity: 0.45 }]}>
            <Text style={submitTxt}>{nrSubmitting ? 'Оприходую…' : nrConfirm ? `Подтвердить · ${nrGoodTotal + nrDefectTotal} шт` : `${nrPlaceCount ? 'Оприходовать и разместить' : 'Оприходовать'} · ${nrGoodTotal + nrDefectTotal} шт`}</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 12, paddingTop: 8, paddingBottom: insets.bottom + 24, gap: 10 }}>
          <SegRow options={[{ k: 'accept', label: 'Приёмка' }, { k: 'place', label: 'Разместить в ячейку' }]} value={screenMode} onChange={setMode} />
          {screenMode === 'accept' ? <SegRow sub options={[{ k: 'qty', label: 'Ввод количества' }, { k: 'each', label: 'По 1 шт за пик' }]} value={countMode} onChange={setCountModePersist} /> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Counter n={`${donePositions}/${rows.length}`} label="позиций" />
            <Counter n={`${totalAccepted}/${totalNeed}`} label="штук" ok={allDone} />
          </View>
          {allDone ? <Banner kind="note" text="Заявка принята полностью" /> : null}
          {screenMode === 'place' || cell ? <CellRow cell={cell} onClear={() => setCell(null)} placeholder="не выбрана — пикните этикетку" /> : null}
          <ScanField ref={scanRef} value={scan} onChangeText={setScan} onSubmit={onSubmitScan} showKeyboard={showKb} onToggleKeyboard={() => setShowKb((s) => !s)} placeholder={scanPlaceholder} />
          {lastMsg ? <LastLine msg={lastMsg} /> : null}

          <Text style={{ fontFamily: font.semibold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.muted, marginTop: 4 }}>
            Позиции заявки <Text style={{ fontFamily: font.regular, textTransform: 'none' }}>— {screenMode === 'place' ? 'нажмите товар, чтобы положить' : 'без ШК — выбирайте нажатием'}</Text>
          </Text>
          {sortedRows.map((r) => {
            const full = r.accepted >= r.need;
            return (
              <Pressable key={`${r.linkId ?? ''}-${r.productId ?? ''}-${r.barcode}`} onPress={() => openRow(r, true)} style={[posCard, full && { opacity: 0.6 }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={{ fontFamily: font.bold, fontSize: 14, color: full ? colors.success : colors.ink }}>{r.accepted}/{r.need} шт{submitted || r.placed ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.muted }}> · в ячейках {r.placed}</Text> : null}</Text>
                  <Text style={{ fontSize: 16, color: full ? colors.success : colors.muted }}>{full ? '✓' : '○'}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                  {photoOf(r) ? <Pressable onPress={() => setLightbox(photoOf(r))}><Image source={{ uri: photoOf(r) }} style={thumb} /></Pressable> : null}
                  <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 14, color: colors.ink }} numberOfLines={2}>{r.name || '—'}</Text>
                  <View style={{ alignItems: 'flex-end' }}>
                    {itemSize(r) ? <Text style={{ fontFamily: font.medium, fontSize: 11, color: colors.muted }}>Размер {itemSize(r)}</Text> : null}
                    {r.barcode ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.muted }}>ШК {shkHead(r.barcode)}<Text style={{ fontFamily: font.bold, color: colors.ink }}>{shkTail(r.barcode)}</Text></Text> : null}
                    {itemArt(r) ? <Text style={{ fontFamily: font.regular, fontSize: 10, color: colors.muted }}>арт {itemArt(r)}</Text> : null}
                  </View>
                </View>
              </Pressable>
            );
          })}

          {submitted ? (
            <View style={{ gap: 2 }}>
              <Text style={{ fontFamily: font.semibold, fontSize: 13, color: colors.primary }}>Приход создан, количество изменить нельзя.</Text>
              <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.muted }}>{allPlaced ? 'Всё разложено по ячейкам.' : `Разложено ${totalPlaced} из ${totalAccepted}: пикните ячейку, затем товар.`}</Text>
            </View>
          ) : (
            <>
              {screenMode === 'accept' || pendingUnits ? (
                <Pressable onPress={submitReceipt} disabled={submitting || !pendingUnits} style={[submitBtn, (submitting || !pendingUnits) && { opacity: 0.45 }]}>
                  <Text style={submitTxt}>{submitting ? 'Создаю приход…' : `Создать приход · ${pendingUnits} шт`}</Text>
                </Pressable>
              ) : null}
              {pendingUnits && shortUnits ? <Text style={hintTxt}>Недобрано {shortUnits} шт — приход будет частичным. Пока не нажали — на сервер ничего не ушло.</Text>
                : pendingUnits ? <Text style={hintTxt}>Пока не нажали — на сервер ничего не ушло, цифры можно править.</Text>
                : totalAccepted && screenMode === 'place' ? <Text style={hintTxt}>Принято {totalAccepted} шт. Пикните ячейку, затем товар.</Text>
                : totalAccepted ? <Text style={hintTxt}>Уже принято {totalAccepted} шт. Новых позиций нет.</Text> : null}
            </>
          )}
        </ScrollView>
      )}

      {/* ввод количества по заявке (pending) */}
      <Modal visible={!!pending} transparent animationType="slide" onRequestClose={() => { setPending(null); setOverConfirm(false); }}>
        <Pressable style={sheetBackdrop} onPress={() => { setPending(null); setOverConfirm(false); }}>
          <Pressable style={[sheetBody, { paddingBottom: insets.bottom + 14 }]} onPress={() => {}}>
            {pending ? (
              <>
                <Text style={{ fontFamily: font.bold, fontSize: 15, color: colors.ink }} numberOfLines={1}>{pending.row.name}</Text>
                <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.muted }}>
                  принято {pending.row.accepted} из {pending.row.need}{pending.mode === 'place' ? ` · положить не больше ${pending.max}${pending.free != null ? `, не размещено ${pending.free}` : ''}` : ''}
                </Text>
                <QtyPad value={pending.qty} onChange={(v) => { setPending((p) => ({ ...p, qty: v })); setOverConfirm(false); }} limit={pending.max || null} onOver={() => sound('error', 'Больше нельзя')} />
                {overConfirm ? <Banner kind="over" text={`Станет ${pending.row.accepted + pending.qty} при заявленных ${pending.row.need}. Нажмите ещё раз.`} /> : null}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Pressable onPress={() => { setPending(null); setOverConfirm(false); refocus(); }} style={[outlineBtn, { flex: 1 }]}><Text style={outlineTxt}>Отмена</Text></Pressable>
                  <Pressable onPress={applyQty} disabled={placing} style={[submitBtn, { flex: 1 }, overConfirm && { backgroundColor: colors.warning }]}>
                    <Text style={submitTxt}>{pending.mode === 'place' ? (placing ? 'Кладу…' : (cell ? `Положить в ${cell.label}` : 'Пикните ячейку')) : (overConfirm ? 'Всё равно внести' : 'Внести')}</Text>
                  </Pressable>
                </View>
                {pending.mode === 'accept' && pending.row.accepted > pending.row.base ? (
                  <Pressable onPress={resetRow} style={{ padding: 8, alignItems: 'center' }}><Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.danger }}>Убрать внесённое сейчас (−{pending.row.accepted - pending.row.base} шт)</Text></Pressable>
                ) : null}
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* правка количества без заявки (nrEdit) */}
      <Modal visible={!!nrEdit} transparent animationType="slide" onRequestClose={() => setNrEdit(null)}>
        <Pressable style={sheetBackdrop} onPress={nrEditDone}>
          <Pressable style={[sheetBody, { paddingBottom: insets.bottom + 14 }]} onPress={() => {}}>
            {nrEdit ? (
              <>
                <Text style={{ fontFamily: font.bold, fontSize: 15, color: colors.ink }} numberOfLines={1}>{nrEdit.row.name || nrEdit.row.barcode}</Text>
                <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.muted }}>{nrEdit.field === 'defect' ? 'Брак' : 'Хороший'}{nrEdit.row.cell ? ` · 📍 ${nrEdit.row.cell.label}` : ''}</Text>
                <QtyPad value={nrEdit.row[nrEdit.field]} onChange={(v) => { setNrItems((prev) => prev.map((x) => (x === nrEdit.row ? { ...x, [nrEdit.field]: Math.max(0, Math.floor(Number(v) || 0)) } : x))); setNrEdit((e) => ({ ...e, row: { ...e.row, [e.field]: Math.max(0, Math.floor(Number(v) || 0)) } })); }} />
                <Pressable onPress={nrEditDone} style={submitBtn}><Text style={submitTxt}>Готово · {nrEdit.row[nrEdit.field]} {nrEdit.field === 'defect' ? 'брак' : 'хор'}</Text></Pressable>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* фото */}
      <Modal visible={!!lightbox} transparent animationType="fade" onRequestClose={() => setLightbox('')}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(10,20,20,0.92)', alignItems: 'center', justifyContent: 'center', padding: 16 }} onPress={() => setLightbox('')}>
          {lightbox ? <Image source={{ uri: lightbox }} style={{ width: '100%', height: '80%' }} resizeMode="contain" /> : null}
        </Pressable>
      </Modal>
    </View>
  );
}

function SrcModes({ active, onReq, onNoReq }) {
  return (
    <View style={segWrap}>
      <Pressable onPress={onReq} style={[segBtn, active === 'req' && segOn]}><Text style={[segTxt, active === 'req' && segTxtOn]}>По заявке</Text></Pressable>
      <Pressable onPress={onNoReq} style={[segBtn, active === 'noreq' && segOn]}><Text style={[segTxt, active === 'noreq' && segTxtOn]}>Без заявки</Text></Pressable>
    </View>
  );
}
function SegRow({ options, value, onChange, sub }) {
  return (
    <View style={segWrap}>
      {options.map((o) => (
        <Pressable key={o.k} onPress={() => onChange(o.k)} style={[segBtn, value === o.k && segOn]}>
          <Text style={[sub ? segTxtSub : segTxt, value === o.k && segTxtOn]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
function Counter({ n, label, ok }) {
  return (
    <View style={[{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: ok ? colors.success : colors.border, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center' }, shadow.card]}>
      <Text style={{ fontFamily: font.bold, fontSize: 18, color: ok ? colors.success : colors.ink }}>{n}</Text>
      <Text style={{ fontFamily: font.medium, fontSize: 11, color: colors.muted }}>{label}</Text>
    </View>
  );
}
function CellRow({ cell, onClear, placeholder }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: cell ? colors.primary : colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10 }}>
      <Text style={{ fontFamily: font.semibold, fontSize: 10, letterSpacing: 0.5, color: colors.muted }}>ЯЧЕЙКА</Text>
      {cell ? <Text style={{ flex: 1, fontFamily: font.bold, fontSize: 16, color: colors.primary }}>{cell.label}</Text> : <Text style={{ flex: 1, fontFamily: font.regular, fontSize: 12, color: colors.muted }}>{placeholder}</Text>}
      {cell ? <Pressable onPress={onClear}><Text style={{ fontFamily: font.medium, fontSize: 12, color: colors.danger }}>убрать</Text></Pressable> : null}
    </View>
  );
}
function LastLine({ msg }) {
  const c = msg.kind === 'error' ? colors.danger : msg.kind === 'done' ? colors.primary : colors.muted;
  return <Text style={{ fontFamily: font.medium, fontSize: 13, color: c }}>{msg.text}</Text>;
}
function Banner({ kind, text }) {
  const map = { error: [colors.danger + '15', colors.danger + '40', colors.danger], note: [colors.success + '18', colors.success + '55', colors.primary], over: [colors.warning + '1E', colors.warning + '55', colors.warning] };
  const [bg, bd, fg] = map[kind] || map.note;
  return <View style={{ backgroundColor: bg, borderWidth: 1, borderColor: bd, borderRadius: radius.md, padding: 11 }}><Text style={{ fontFamily: font.medium, fontSize: 13, color: fg }}>{text}</Text></View>;
}

const rowCard = { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 14 };
const posCard = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10 };
const thumb = { width: 44, height: 44, borderRadius: 8, backgroundColor: colors.bg };
const chip = { minWidth: 36, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.sm, alignItems: 'center' };
const hintTxt = { fontFamily: font.regular, fontSize: 13, color: colors.muted, lineHeight: 18 };
const segWrap = { flexDirection: 'row', gap: 4, padding: 4, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 999 };
const segBtn = { flex: 1, paddingVertical: 10, borderRadius: 999, alignItems: 'center' };
const segOn = { backgroundColor: colors.surface, ...shadow.card };
const segTxt = { fontFamily: font.bold, fontSize: 13, color: colors.muted };
const segTxtSub = { fontFamily: font.semibold, fontSize: 12, color: colors.muted };
const segTxtOn = { color: colors.primary };
const submitBtn = { minHeight: 52, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 };
const submitTxt = { fontFamily: font.bold, fontSize: 16, color: '#fff' };
const outlineBtn = { minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' };
const outlineTxt = { fontFamily: font.semibold, fontSize: 15, color: colors.ink };
const sheetBackdrop = { flex: 1, backgroundColor: 'rgba(10,20,20,0.45)', justifyContent: 'flex-end' };
const sheetBody = { backgroundColor: colors.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, gap: 10 };
