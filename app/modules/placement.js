import { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Modal, Image, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenHeader from '../../components/ScreenHeader';
import ScanField from '../../components/ScanField';
import QtyPad from '../../components/QtyPad';
import BasketList from '../../components/BasketList';
import MoveScreen from './move';
import { api } from '../../lib/api';
import { speak, formatCellSpeech } from '../../lib/cells';
import { useScanDedup } from '../../lib/scanner';
import { useScanBasket } from '../../lib/basket';
import { colors, font, radius, shadow } from '../../theme';

// Размещение по ячейкам (порт PlacementModule.vue). Вкладки: Положить / Забрать /
// Переместить / Посмотреть. Поток Положить/Забрать: набрать ТОВАРЫ в корзину →
// «Готово» → пикнуть ЯЧЕЙКУ → отправка пачкой на /api/cells/stock/{put|take}.
const sound = (kind, text) => { if (text) speak(String(text)); };
const withSize = (name, size) => { const s = String(size || '').trim(); return s ? `${name} · ${s}` : name; };
const shkTail = (c) => String(c || '').slice(-4);
const shkHead = (c) => { const s = String(c || ''); return s.length > 4 ? s.slice(0, -4) : ''; };
const UNPLACED_CAP = 200;

function cellCmp(a, b) {
  const pa = String(a || '').split('-'), pb = String(b || '').split('-');
  const ra = (pa[0] || '').toUpperCase(), rb = (pb[0] || '').toUpperCase();
  if (ra !== rb) return ra < rb ? -1 : 1;
  const n = Math.max(pa.length, pb.length);
  for (let i = 1; i < n; i++) { const da = Number(pa[i]) || 0, db = Number(pb[i]) || 0; if (da !== db) return da - db; }
  return 0;
}

export default function PlacementScreen({ mod }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scanRef = useRef(null);
  const isDup = useScanDedup();
  const basket = useScanBasket();

  const [tab, setTab] = useState('place'); // 'place' | 'move' | 'look'
  const [mode, setMode] = useState('put'); // 'put' | 'take'
  const [phase, setPhase] = useState('scan'); // 'scan' | 'cell'
  const [shelf, setShelf] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [scan, setScan] = useState('');
  const [showKb, setShowKb] = useState(false);

  // склад/ячейки
  const [warehouseId, setWarehouseId] = useState(null);
  const [shelves, setShelves] = useState([]);
  const [shelvesLoading, setShelvesLoading] = useState(true);
  const whRef = useRef(null);

  // QtyPad
  const [activeLineId, setActiveLineId] = useState(null);
  const activeLine = activeLineId != null ? basket.line(activeLineId) : null;

  // sheets
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchDone, setSearchDone] = useState(false);
  const [shelfPickerOpen, setShelfPickerOpen] = useState(false);
  const [shelfQuery, setShelfQuery] = useState('');
  const [unplacedOpen, setUnplacedOpen] = useState(false);
  const [unplacedItems, setUnplacedItems] = useState([]);
  const [unplacedLoading, setUnplacedLoading] = useState(false);
  const [unplacedError, setUnplacedError] = useState('');
  const [unplacedLoaded, setUnplacedLoaded] = useState(false);
  const [unplacedQuery, setUnplacedQuery] = useState('');

  // look
  const [lookBusy, setLookBusy] = useState(false);
  const [lookError, setLookError] = useState('');
  const [lookResult, setLookResult] = useState(null);

  const [lightbox, setLightbox] = useState(null);

  const refocus = useCallback(() => { setTimeout(() => scanRef.current?.focus(), 250); }, []);

  // --- склад/ячейки ---
  const loadShelves = useCallback(async () => {
    setShelvesLoading(true);
    try {
      let wid = whRef.current;
      const wr = await api('/api/cells/warehouses');
      if (wr.ok) {
        const list = (await wr.json())?.items || [];
        wid = (list.find((w) => w.is_default) || list[0])?.id || null;
        whRef.current = wid;
        setWarehouseId(wid);
      }
      const res = await api(`/api/cells/nodes${wid ? `?warehouse_id=${wid}` : ''}`);
      if (!res.ok) throw new Error(`Сервер ответил ${res.status}`);
      const data = await res.json();
      setShelves((data?.items || [])
        .filter((n) => n.is_storable || n.node_type === 'box' || n.children_count === 0)
        .map((n) => ({ id: n.id, label: String(n.code || ''), code: String(n.code || '') })));
    } catch (e) {
      setError('Не удалось загрузить ячейки: ' + e.message);
    } finally {
      setShelvesLoading(false);
    }
  }, []);

  useEffect(() => { loadShelves(); sound('step', 'Пикните штрихкод товара'); }, [loadShelves]);

  const whq = (prefix) => (whRef.current ? `${prefix}warehouse_id=${whRef.current}` : '');

  // --- потолок «Положить» = непомещённое на складе ---
  const fetchUnplacedQty = useCallback(async (pid) => {
    try {
      const res = await api(`/api/cells/products/${pid}/summary${whq('?')}`);
      if (!res.ok) return null;
      const d = await res.json();
      return Math.max(0, Number(d?.unplaced_quantity) || 0);
    } catch (_) { return null; }
  }, []);

  const addPutProduct = useCallback(async (prod, places, knownMax) => {
    const id = prod.product_id ?? prod.id;
    const existing = basket.line(id);
    if (existing) {
      if (existing.max != null && Number(existing.qty) >= existing.max) {
        setError(`Больше нельзя: не размещено ${existing.max}`);
        sound('error', 'Больше нельзя');
        return;
      }
      const { line } = basket.addProduct(prod, places);
      setNote(`${line.product_name}: ${line.qty} шт`);
      sound('ok', String(line.qty));
      return;
    }
    const cap = knownMax != null ? knownMax : await fetchUnplacedQty(id);
    if (cap != null && cap <= 0) {
      setError('Класть нечего: всё уже размещено на складе');
      sound('error', 'Всё размещено');
      return;
    }
    const { line } = basket.addProduct(prod, places, cap);
    setNote(line.product_name);
    sound('ok', String(line.qty));
  }, [basket, fetchUnplacedQty]);

  const addTakeProduct = useCallback((prod, places) => {
    const { line } = basket.addProduct(prod, places);
    setNote(`${line.product_name}: ${line.qty} шт`);
    sound('ok', String(line.qty));
  }, [basket]);

  // --- разбор скана ---
  const handleCode = useCallback(async (raw) => {
    const code = String(raw || '').trim();
    if (!code || isDup(code)) return;
    setError(''); setNote(''); setBusy(true);
    try {
      const res = await api(`/api/cells/scan?code=${encodeURIComponent(code)}${whq('&')}`);
      if (!res.ok) throw new Error(`Сервер ответил ${res.status}`);
      const d = await res.json();
      if (!d?.found) { setError(`Код «${code}» не найден: ни место, ни товар`); sound('error', 'Не найдено'); return; }

      if (d.kind === 'product') {
        const prod = {
          product_id: d.product.id,
          product_name: withSize(d.product.name, d.product.size),
          article: d.product.article,
          photo_url: d.product.photo_url,
          barcode: d.product.barcode || code,
        };
        if (mode === 'put') await addPutProduct(prod, d.places || []);
        else addTakeProduct(prod, d.places || []);
        setSearchOpen(false);
        return;
      }

      if (d.kind === 'place') {
        if (d.node?.is_storable === false && !(d.items || []).length) {
          setError(`«${d.node.code}» — это не место хранения, а часть стеллажа`);
          sound('error', 'Не место хранения');
          return;
        }
        if (!basket.count) { setError('Сначала пикните товары, потом ячейку'); sound('error', 'Ошибка. Сначала товар'); return; }
        setShelf({ id: d.node.id, label: d.node.code, code: d.node.code });
        setPhase('cell');
        setShelfPickerOpen(false);
        setNote(`Ячейка ${d.node.code}`);
        sound('ok', 'Ячейка');
        return;
      }
    } catch (e) {
      setError('Не удалось разобрать код: ' + e.message);
      sound('error', 'Ошибка');
    } finally {
      setBusy(false);
      refocus();
    }
  }, [isDup, mode, basket, addPutProduct, addTakeProduct, refocus]);

  // --- Посмотреть ---
  const lookScan = useCallback(async (code) => {
    const c = String(code || '').trim();
    if (!c) return;
    setLookBusy(true); setLookError('');
    try {
      const res = await api(`/api/cells/scan?code=${encodeURIComponent(c)}${whq('&')}`);
      const d = res.ok ? await res.json() : {};
      if (!d?.found) { setLookError(`Код «${c}» не найден: ни товар, ни ячейка`); setLookResult(null); sound('error', 'Не найдено'); return; }
      if (d.kind === 'product') {
        const byCell = new Map();
        for (const p of (d.places || [])) { const q = Number(p.quantity) || 0; if (q) byCell.set(p.code, (byCell.get(p.code) || 0) + q); }
        const places = Array.from(byCell, ([cell, qty]) => ({ cell, qty }));
        let acc = null, placed = null, unpl = null;
        try {
          const sr = await api(`/api/cells/products/${d.product.id}/summary${whq('?')}`);
          if (sr.ok) { const sd = await sr.json(); acc = sd.accounting_quantity; placed = sd.placed_quantity; unpl = sd.unplaced_quantity; }
        } catch (_) {}
        setLookResult({ kind: 'product', name: withSize(d.product.name, d.product.size), barcode: d.product.barcode || c, places, accounting: acc, placed, unplaced: unpl });
        speak(places[0]?.cell ? formatCellSpeech(places[0].cell) : 'Товар');
      } else if (d.kind === 'place') {
        const items = (d.items || []).map((it) => ({
          name: withSize(it.product_name || it.name || '', it.product_size),
          barcode: it.barcode || '',
          qty: Number(it.quantity) || 0,
          defect: it.quality === 'defect',
        })).filter((x) => x.name || x.qty);
        setLookResult({ kind: 'place', code: d.node?.code || c, items, total: items.reduce((s, x) => s + (x.qty || 0), 0) });
        sound('ok', 'Ячейка');
      } else { setLookResult(null); setLookError('Неизвестный тип кода'); }
    } catch (e) {
      setLookError('Ошибка: ' + (e.message || e)); sound('error', 'Ошибка');
    } finally { setLookBusy(false); refocus(); }
  }, [refocus]);

  const onSubmitScan = useCallback(() => {
    const raw = scan; setScan('');
    if (tab === 'look') lookScan(raw);
    else handleCode(raw);
  }, [scan, tab, lookScan, handleCode]);

  // --- ручной поиск ---
  const runSearch = useCallback(async (q) => {
    if (String(q || '').trim().length < 1) return;
    setBusy(true);
    try {
      const res = await api(`/api/shelf-ops/product-search?q=${encodeURIComponent(q.trim())}&limit=30`);
      const items = res.ok ? ((await res.json())?.items || []) : [];
      setSearchResults(items); setSearchDone(true);
      if (!items.length) sound('error', 'Не найдено');
    } catch (_) {} finally { setBusy(false); }
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    const s = String(searchQuery || '').trim();
    if (s.length < 2) { setSearchResults([]); setSearchDone(false); return; }
    const t = setTimeout(() => runSearch(s), 300);
    return () => clearTimeout(t);
  }, [searchQuery, searchOpen, runSearch]);

  const fetchPlacesFor = useCallback(async (barcode) => {
    if (!barcode) return [];
    try {
      const res = await api(`/api/cells/scan?code=${encodeURIComponent(barcode)}${whq('&')}`);
      if (!res.ok) return [];
      const d = await res.json();
      return (d?.found && d.kind === 'product') ? (d.places || []) : [];
    } catch (_) { return []; }
  }, []);

  const pickProduct = useCallback(async (p) => {
    setSearchOpen(false); setSearchResults([]);
    const prod = { ...p, product_name: withSize(p.product_name, p.size || p.product_size) };
    const places = (p.places && p.places.length) ? p.places : await fetchPlacesFor(p.barcode);
    if (mode === 'put') addPutProduct(prod, places); else addTakeProduct(prod, places);
    refocus();
  }, [mode, fetchPlacesFor, addPutProduct, addTakeProduct, refocus]);

  // --- неразмещённые ---
  const normalizeUnplaced = (x) => ({
    product_id: x.product_id ?? x.id ?? null,
    barcode: x.barcode || x.sku || x.article || '',
    name: x.product_name || x.name || '',
    company: x.company_name || x.company || x.owner_name || x.ip || '',
    qty: Number(x.unplaced_quantity ?? x.unplaced ?? x.quantity ?? x.qty ?? 0),
  });

  const fetchUnplaced = useCallback(async () => {
    setUnplacedLoading(true); setUnplacedError('');
    try {
      const res = await api(`/api/cells/unplaced${whq('?')}`);
      if (res.status === 404) { setUnplacedError('Список ещё не подключён на сервере'); return; }
      if (!res.ok) throw new Error(`сервер ответил ${res.status}`);
      const data = await res.json();
      const items = Array.isArray(data) ? data : (data?.items || []);
      setUnplacedItems(items.map(normalizeUnplaced).filter((x) => x.qty > 0));
      setUnplacedLoaded(true);
    } catch (e) {
      setUnplacedError('Не удалось загрузить: ' + e.message);
    } finally { setUnplacedLoading(false); }
  }, []);

  const openUnplaced = () => { setUnplacedOpen(true); setUnplacedQuery(''); if (!unplacedLoaded) fetchUnplaced(); };

  const pickUnplaced = async (u) => {
    setUnplacedOpen(false);
    if (mode !== 'put') switchMode('put');
    if (u.barcode) { await handleCode(u.barcode); return; }
    await addPutProduct({ product_id: u.product_id, product_name: u.name, barcode: '' }, [], u.qty);
    refocus();
  };

  const unplacedMatches = (() => {
    const q = unplacedQuery.trim().toLowerCase();
    if (!q) return unplacedItems;
    return unplacedItems.filter((x) =>
      String(x.name || '').toLowerCase().includes(q) ||
      String(x.barcode || '').toLowerCase().includes(q) ||
      String(x.company || '').toLowerCase().includes(q));
  })();
  const unplacedShown = unplacedMatches.slice(0, UNPLACED_CAP);
  const unplacedTotalUnits = unplacedItems.reduce((s, x) => s + (Number(x.qty) || 0), 0);

  // --- выбор ячейки вручную ---
  const pickerCells = (() => {
    const q = shelfQuery.trim().toUpperCase();
    return (q ? shelves.filter((s) => s.label.toUpperCase().includes(q)) : shelves)
      .slice().sort((a, b) => cellCmp(a.label, b.label)).slice(0, 60);
  })();

  const pickShelf = (s) => {
    setShelf({ id: s.id, label: s.label, code: s.code });
    setShelfPickerOpen(false);
    setPhase('cell');
    sound('ok', 'Ячейка');
    refocus();
  };
  const pickShelfByQuery = () => {
    const q = shelfQuery.trim().toUpperCase();
    if (!q) return;
    const hit = shelves.find((s) => s.label.toUpperCase() === q) || (pickerCells.length === 1 ? pickerCells[0] : null);
    if (hit) pickShelf(hit); else sound('error', 'Ячейка не найдена');
  };

  // --- переходы фаз ---
  const commonTakeCell = () => {
    const sets = basket.lines.map((l) => new Set((l.places || []).filter((p) => Number(p.quantity) > 0).map((p) => p.node_id)));
    if (!sets.length) return null;
    let inter = [...sets[0]];
    for (const s of sets.slice(1)) inter = inter.filter((id) => s.has(id));
    if (inter.length !== 1) return null;
    const nodeId = inter[0];
    for (const l of basket.lines) { const p = (l.places || []).find((x) => x.node_id === nodeId); if (p) return { id: nodeId, label: p.code, code: p.code }; }
    return null;
  };

  const goDone = () => {
    if (!basket.count) { sound('error', 'Ошибка. Сначала товар'); return; }
    setPhase('cell'); setShelf(null); setError(''); setNote('');
    if (mode === 'take') {
      const auto = commonTakeCell();
      if (auto) { setShelf(auto); setNote(`Ячейка ${auto.label}`); sound('ok', 'Ячейка'); refocus(); return; }
    }
    sound('step', 'Пикните ячейку'); refocus();
  };
  const backToScan = () => { setPhase('scan'); setShelf(null); basket.clearErrors(); setError(''); setNote(''); refocus(); };

  // --- отправка ---
  const canSubmit = phase === 'cell' && !!shelf && basket.count > 0;

  const validatePut = async () => {
    basket.clearErrors();
    for (const l of basket.lines) {
      try {
        const res = await api(`/api/cells/products/${l.product_id}/summary${whq('?')}`);
        if (!res.ok) continue;
        const d = await res.json();
        const avail = Math.max(0, Number(d?.unplaced_quantity) || 0);
        if (Number(l.qty) > avail) l.err = `не размещено: ${avail}`;
      } catch (_) {}
    }
  };

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true); setError(''); setNote('');
    try {
      if (mode === 'put') {
        await validatePut();
        if (basket.hasErrors) { setError('Где перебор — уменьшите: столько не размещено'); sound('error', 'Больше нельзя'); return; }
      }
      let okCount = 0, okUnits = 0, fail = 0;
      for (const l of basket.lines.slice()) {
        const owner = (l.places || []).find((pl) => pl.company_id)?.company_id || 0;
        try {
          const res = await api(`/api/cells/stock/${mode}`, {
            method: 'POST',
            body: JSON.stringify({ node_id: shelf.id, product_id: l.product_id, company_id: owner, quality: 'good', quantity: Number(l.qty), source: 'tsd' }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            const detail = data?.detail;
            l.err = (typeof detail === 'string' ? detail : (detail?.message || data?.message)) || `сервер ${res.status}`;
            fail++;
          } else { okCount++; okUnits += Number(l.qty || 0); basket.remove(l.product_id); }
        } catch (e) { l.err = e.message; fail++; }
      }
      if (okCount) { setNote(`${mode === 'put' ? 'Положено' : 'Забрано'}: ${okCount} поз. / ${okUnits} шт в ${shelf.label}`); sound('ok', mode === 'put' ? 'Положено' : 'Забрано'); }
      if (fail) { setError(`Не прошло строк: ${fail} — см. подсвеченные`); if (!okCount) sound('error', 'Ошибка'); }
      if (!basket.count) { setShelf(null); setPhase('scan'); refocus(); }
    } finally { setBusy(false); }
  };

  const switchMode = (m) => {
    setTab('place');
    if (mode === m && tab === 'place') return;
    setMode(m); basket.clear(); setShelf(null); setPhase('scan'); setError(''); setNote('');
    sound('step', 'Пикните штрихкод товара'); refocus();
  };
  const reset = () => { basket.clear(); setShelf(null); setPhase('scan'); setActiveLineId(null); setError(''); setNote(''); sound('step', 'Пикните штрихкод товара'); refocus(); };

  const fillLine = (id) => { const l = basket.line(id); if (!l || l.max == null) return; basket.setQty(id, l.max); if (l.max <= 100) sound('ok', String(l.max)); };

  const scanPlaceholder = tab === 'look'
    ? 'Пикните товар или ячейку…'
    : phase === 'cell'
      ? (shelf ? 'Пикните другую ячейку…' : 'Пикните этикетку ячейки…')
      : (basket.count ? 'Пикайте ещё товар…' : 'Пикните штрихкод товара…');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader
        title={mod?.title || 'Товары и ячейки'}
        subtitle={tab === 'move' ? 'перемещение' : tab === 'look' ? 'посмотреть' : mode === 'put' ? 'положить' : 'забрать'}
        onBack={() => router.back()}
        right={tab === 'place' && mode === 'put' ? (
          <Pressable onPress={openUnplaced} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#ffffff22' }}>
            <Text style={{ fontFamily: font.semibold, color: colors.onDark, fontSize: 12 }}>Неразмещённые</Text>
          </Pressable>
        ) : null}
      />

      {/* переключатель вкладок */}
      <View style={{ flexDirection: 'row', gap: 4, padding: 6, margin: 12, marginBottom: 4, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 999 }}>
        {[
          { k: 'put', label: 'Положить', on: tab === 'place' && mode === 'put', act: () => switchMode('put') },
          { k: 'take', label: 'Забрать', on: tab === 'place' && mode === 'take', act: () => switchMode('take') },
          { k: 'move', label: 'Переместить', on: tab === 'move', act: () => setTab('move') },
          { k: 'look', label: 'Посмотреть', on: tab === 'look', act: () => setTab('look') },
        ].map((t) => (
          <Pressable key={t.k} onPress={t.act} style={{ flex: 1, paddingVertical: 10, borderRadius: 999, backgroundColor: t.on ? colors.surface : 'transparent', alignItems: 'center', ...(t.on ? shadow.card : null) }}>
            <Text style={{ fontFamily: font.bold, fontSize: 11.5, color: t.on ? colors.primary : colors.muted }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'move' ? (
        <MoveScreen embedded />
      ) : tab === 'look' ? (
        <LookTab
          scan={scan} setScan={setScan} showKb={showKb} setShowKb={setShowKb} scanRef={scanRef}
          onSubmit={onSubmitScan} placeholder={scanPlaceholder} busy={lookBusy} error={lookError} result={lookResult} insets={insets}
        />
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 12, paddingTop: 8, paddingBottom: insets.bottom + 24, gap: 10 }}>
          {error ? <Banner kind="error" text={error} /> : null}
          {note ? <Banner kind="note" text={note} /> : null}

          <ScanField ref={scanRef} value={scan} onChangeText={setScan} onSubmit={onSubmitScan} showKeyboard={showKb} onToggleKeyboard={() => setShowKb((s) => !s)} placeholder={scanPlaceholder} />

          {phase === 'scan' ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontFamily: font.semibold, fontSize: 13, color: colors.muted }}>
                  {basket.count ? `В корзине: ${basket.count} поз. · ${basket.totalUnits} шт` : 'Корзина пуста — пикайте товары'}
                </Text>
                <Pressable onPress={() => { setSearchOpen(true); setSearchQuery(''); setSearchResults([]); setSearchDone(false); }} style={ghostBtn}>
                  <Text style={ghostBtnTxt}>Найти</Text>
                </Pressable>
              </View>
              <BasketList lines={basket.lines} editable showPlaces={mode === 'take'} onInc={basket.inc} onDec={basket.dec} onRemove={basket.remove} onEdit={setActiveLineId} onFill={fillLine} onPhoto={(l) => l.photo_url && setLightbox({ src: l.photo_url, name: l.product_name })} />
              <View style={{ gap: 8, marginTop: 4 }}>
                <Pressable onPress={goDone} disabled={!basket.count} style={[submitBtn, !basket.count && { opacity: 0.45 }]}>
                  <Text style={submitTxt}>Готово · {mode === 'put' ? 'положить' : 'забрать'} ({basket.totalUnits})</Text>
                </Pressable>
                {basket.count ? <Pressable onPress={reset} style={{ padding: 10, alignItems: 'center' }}><Text style={{ fontFamily: font.medium, color: colors.muted }}>Очистить корзину</Text></Pressable> : null}
              </View>
            </>
          ) : (
            <>
              <View style={[{ backgroundColor: colors.surface, borderWidth: 1, borderColor: shelf ? colors.primary : colors.border, borderRadius: radius.lg, padding: 12 }, shadow.card]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <Text style={{ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.muted }}>{mode === 'put' ? 'Куда положить' : 'Откуда забрать'}</Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {shelf ? <Pressable onPress={() => { setShelfPickerOpen(true); setShelfQuery(''); }} style={ghostBtn}><Text style={ghostBtnTxt}>Вручную</Text></Pressable> : null}
                    <Pressable onPress={() => (shelf ? setShelf(null) : (setShelfPickerOpen(true), setShelfQuery('')))} style={primBtn}><Text style={primBtnTxt}>{shelf ? 'Сменить' : 'Выбрать'}</Text></Pressable>
                  </View>
                </View>
                {shelf ? <Text style={{ fontFamily: font.bold, fontSize: 22, color: colors.primary }}>{shelf.label}</Text> : <Text style={{ fontFamily: font.regular, color: colors.muted }}>{shelvesLoading ? 'загрузка…' : 'пикните ячейку'}</Text>}
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontFamily: font.semibold, fontSize: 12, color: colors.muted }}>{mode === 'put' ? 'Отправим' : 'Заберём'}: {basket.count} поз. · {basket.totalUnits} шт</Text>
                <Pressable onPress={backToScan} style={ghostBtn}><Text style={ghostBtnTxt}>Изменить</Text></Pressable>
              </View>
              <BasketList lines={basket.lines} editable={false} showPlaces={mode === 'take'} onPhoto={(l) => l.photo_url && setLightbox({ src: l.photo_url, name: l.product_name })} />
              <View style={{ gap: 8, marginTop: 4 }}>
                <Pressable onPress={submit} disabled={!canSubmit || busy} style={[submitBtn, (!canSubmit || busy) && { opacity: 0.45 }]}>
                  <Text style={submitTxt}>{busy ? 'Отправляю…' : (mode === 'put' ? `Положить в ячейку (${basket.totalUnits})` : `Забрать из ячейки (${basket.totalUnits})`)}</Text>
                </Pressable>
                <Pressable onPress={backToScan} style={{ padding: 10, alignItems: 'center' }}><Text style={{ fontFamily: font.medium, color: colors.muted }}>← К сканам</Text></Pressable>
              </View>
            </>
          )}
        </ScrollView>
      )}

      {/* QtyPad: ручной ввод количества строки */}
      <Modal visible={activeLineId != null && !!activeLine} transparent animationType="slide" onRequestClose={() => setActiveLineId(null)}>
        <Pressable style={sheetBackdrop} onPress={() => setActiveLineId(null)}>
          <Pressable style={[sheetBody, { paddingBottom: insets.bottom + 14 }]} onPress={() => {}}>
            {activeLine ? (
              <>
                <Text style={{ fontFamily: font.bold, fontSize: 15, color: colors.ink }} numberOfLines={1}>{activeLine.product_name}</Text>
                <QtyPad value={activeLine.qty} onChange={(v) => basket.setQty(activeLineId, v)} limit={activeLine.max} onOver={() => speak('Больше нельзя')} />
                <Pressable onPress={() => setActiveLineId(null)} style={[submitBtn, { marginTop: 4 }]}><Text style={submitTxt}>Готово</Text></Pressable>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Поиск товара */}
      <Modal visible={searchOpen} transparent animationType="slide" onRequestClose={() => setSearchOpen(false)}>
        <Pressable style={sheetBackdrop} onPress={() => setSearchOpen(false)}>
          <Pressable style={[sheetBody, { paddingBottom: insets.bottom + 14, maxHeight: '82%' }]} onPress={() => {}}>
            <TextInput value={searchQuery} onChangeText={setSearchQuery} autoFocus placeholder="Название, артикул или ШК…" placeholderTextColor={colors.muted} style={fieldStyle} />
            {busy ? <Text style={hintTxt}>Ищу…</Text> : null}
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 6 }}>
              {searchResults.map((p) => (
                <Pressable key={String(p.product_id)} onPress={() => pickProduct(p)} style={pickRow}>
                  {p.image_url || p.photo_url ? <Image source={{ uri: p.image_url || p.photo_url }} style={{ width: 38, height: 38, borderRadius: 8, backgroundColor: colors.bg }} /> : null}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: font.semibold, fontSize: 13, color: colors.ink }} numberOfLines={1}>{p.product_name || '—'}</Text>
                    {p.company_name || p.company ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.muted }} numberOfLines={1}>{p.company_name || p.company}</Text> : null}
                    {p.barcode ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.muted }}>ШК {shkHead(p.barcode)}<Text style={{ fontFamily: font.bold, color: colors.ink }}>{shkTail(p.barcode)}</Text></Text> : null}
                  </View>
                </Pressable>
              ))}
              {!busy && !searchResults.length ? <Text style={hintTxt}>{searchDone ? `Ничего не найдено по «${searchQuery}»` : 'Начните вводить — покажу совпадения'}</Text> : null}
            </ScrollView>
            <Pressable onPress={() => setSearchOpen(false)} style={{ padding: 12, alignItems: 'center' }}><Text style={{ fontFamily: font.medium, color: colors.muted }}>Закрыть</Text></Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Неразмещённые */}
      <Modal visible={unplacedOpen} transparent animationType="slide" onRequestClose={() => setUnplacedOpen(false)}>
        <Pressable style={sheetBackdrop} onPress={() => setUnplacedOpen(false)}>
          <Pressable style={[sheetBody, { paddingBottom: insets.bottom + 14, maxHeight: '85%' }]} onPress={() => {}}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontFamily: font.bold, fontSize: 16, color: colors.ink }}>Неразмещённые</Text>
              <Pressable onPress={() => { setUnplacedLoaded(false); fetchUnplaced(); }} disabled={unplacedLoading} style={ghostBtn}><Text style={ghostBtnTxt}>Обновить</Text></Pressable>
            </View>
            {!unplacedLoading && !unplacedError ? (
              <View style={{ backgroundColor: colors.primary + '14', borderRadius: radius.md, padding: 10 }}>
                <Text style={{ fontFamily: font.semibold, fontSize: 13, color: colors.primary, textAlign: 'center' }}>Всего не размещено: {unplacedItems.length} поз · {unplacedTotalUnits} шт</Text>
              </View>
            ) : null}
            {!unplacedLoading && !unplacedError && unplacedItems.length ? (
              <TextInput value={unplacedQuery} onChangeText={setUnplacedQuery} placeholder="Фильтр: название, ШК, компания…" placeholderTextColor={colors.muted} style={fieldStyle} />
            ) : null}
            {unplacedLoading ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} /> : unplacedError ? <Text style={hintTxt}>{unplacedError}</Text> : (
              <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 6 }}>
                {unplacedShown.map((u) => (
                  <Pressable key={String(u.product_id ?? u.barcode)} onPress={() => pickUnplaced(u)} style={[pickRow, { flexDirection: 'column', alignItems: 'stretch', gap: 4 }]}>
                    <Text style={{ fontFamily: font.bold, fontSize: 14, color: colors.primary }}>Не размещено ×{u.qty}</Text>
                    <Text style={{ fontFamily: font.semibold, fontSize: 13, color: colors.ink }} numberOfLines={1}>{u.name || u.barcode || '—'}</Text>
                    {u.company ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.muted }} numberOfLines={1}>{u.company}</Text> : null}
                    {u.barcode ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.muted }}>ШК {shkHead(u.barcode)}<Text style={{ fontFamily: font.bold, color: colors.ink }}>{shkTail(u.barcode)}</Text></Text> : null}
                  </Pressable>
                ))}
                {unplacedItems.length && !unplacedMatches.length ? <Text style={hintTxt}>Ничего не найдено по «{unplacedQuery}»</Text> : null}
                {unplacedMatches.length > unplacedShown.length ? <Text style={hintTxt}>Показаны первые {unplacedShown.length} из {unplacedMatches.length} — уточните фильтр</Text> : null}
                {!unplacedItems.length ? <Text style={hintTxt}>Все товары разложены по ячейкам 🎉</Text> : null}
              </ScrollView>
            )}
            <Pressable onPress={() => setUnplacedOpen(false)} style={{ padding: 12, alignItems: 'center' }}><Text style={{ fontFamily: font.medium, color: colors.muted }}>Закрыть</Text></Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Выбор ячейки вручную */}
      <Modal visible={shelfPickerOpen} transparent animationType="slide" onRequestClose={() => setShelfPickerOpen(false)}>
        <Pressable style={sheetBackdrop} onPress={() => setShelfPickerOpen(false)}>
          <Pressable style={[sheetBody, { paddingBottom: insets.bottom + 14, maxHeight: '80%' }]} onPress={() => {}}>
            <Text style={{ fontFamily: font.semibold, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.muted }}>{mode === 'take' ? 'Откуда забрать' : 'Куда положить'}</Text>
            <TextInput value={shelfQuery} onChangeText={setShelfQuery} autoFocus placeholder="Например, G-1" placeholderTextColor={colors.muted} onSubmitEditing={pickShelfByQuery} style={fieldStyle} />
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 360 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {pickerCells.map((s) => (
                <Pressable key={String(s.id)} onPress={() => pickShelf(s)} style={{ minWidth: 72, paddingHorizontal: 14, paddingVertical: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
                  <Text style={{ fontFamily: font.bold, fontSize: 15, color: colors.primary }}>{s.label}</Text>
                </Pressable>
              ))}
              {!pickerCells.length ? <Text style={hintTxt}>{shelvesLoading ? 'Загрузка ячеек…' : 'Ничего не найдено'}</Text> : null}
            </ScrollView>
            <Pressable onPress={() => setShelfPickerOpen(false)} style={{ padding: 12, alignItems: 'center' }}><Text style={{ fontFamily: font.medium, color: colors.muted }}>Закрыть</Text></Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Фото во весь экран */}
      <Modal visible={!!lightbox} transparent animationType="fade" onRequestClose={() => setLightbox(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(10,20,20,0.92)', alignItems: 'center', justifyContent: 'center', padding: 16, gap: 12 }} onPress={() => setLightbox(null)}>
          {lightbox ? <Image source={{ uri: lightbox.src }} style={{ width: '100%', height: '70%' }} resizeMode="contain" /> : null}
          {lightbox?.name ? <Text style={{ color: '#fff', fontFamily: font.regular, textAlign: 'center' }}>{lightbox.name}</Text> : null}
        </Pressable>
      </Modal>
    </View>
  );
}

function LookTab({ scan, setScan, showKb, setShowKb, scanRef, onSubmit, placeholder, busy, error, result, insets }) {
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 24, gap: 10 }}>
      {error ? <Banner kind="error" text={error} /> : null}
      <ScanField ref={scanRef} value={scan} onChangeText={setScan} onSubmit={onSubmit} showKeyboard={showKb} onToggleKeyboard={() => setShowKb((s) => !s)} placeholder={placeholder} />
      <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.muted }}>Товар — покажу где лежит. Ячейка — что в ней. ТСД поймёт сам.</Text>
      {busy ? <Text style={hintTxt}>Смотрю…</Text> : null}

      {!busy && result && result.kind === 'product' ? (
        <View style={[{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 14 }, shadow.card]}>
          <Text style={{ fontFamily: font.bold, fontSize: 15, color: colors.ink }}>{result.name}</Text>
          {result.barcode ? <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.muted, marginTop: 2 }}>ШК …<Text style={{ fontFamily: font.bold, color: colors.ink }}>{shkTail(result.barcode)}</Text></Text> : null}
          {result.accounting != null ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
              <Text style={statTxt}>Остаток <Text style={statNum}>{result.accounting}</Text></Text>
              <Text style={statTxt}>Размещено <Text style={statNum}>{result.placed}</Text></Text>
              <Text style={[statTxt, Number(result.unplaced) > 0 && { color: colors.warning }]}>Не размещено <Text style={[statNum, Number(result.unplaced) > 0 && { color: colors.warning }]}>{result.unplaced}</Text></Text>
            </View>
          ) : null}
          <Text style={{ fontFamily: font.semibold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.muted, marginTop: 12, marginBottom: 4 }}>Где лежит</Text>
          {result.places.length ? result.places.map((p) => (
            <View key={p.cell} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={{ fontFamily: font.bold, fontSize: 15, color: colors.primary }}>{p.cell}</Text>
              <Text style={{ fontFamily: font.bold, color: colors.ink }}>×{p.qty}</Text>
            </View>
          )) : <Text style={hintTxt}>Нигде не размещён</Text>}
        </View>
      ) : !busy && result && result.kind === 'place' ? (
        <View style={[{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 14 }, shadow.card]}>
          <Text style={{ fontFamily: font.bold, fontSize: 17, color: colors.primary }}>Ячейка {result.code}</Text>
          <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.muted, marginBottom: 6 }}>{result.items.length} поз. · {result.total} шт</Text>
          {result.items.length ? result.items.map((it, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.ink }} numberOfLines={1}>{it.name}{it.defect ? <Text style={{ color: colors.danger }}> · брак</Text> : null}</Text>
                {it.barcode ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.muted }}>ШК {shkHead(it.barcode)}<Text style={{ fontFamily: font.bold, color: colors.ink }}>{shkTail(it.barcode)}</Text></Text> : null}
              </View>
              <Text style={{ fontFamily: font.bold, color: colors.ink }}>×{it.qty}</Text>
            </View>
          )) : <Text style={hintTxt}>Ячейка пустая</Text>}
        </View>
      ) : !busy && !error ? (
        <Text style={hintTxt}>Пикни товар или ячейку — покажу подробности.</Text>
      ) : null}
    </ScrollView>
  );
}

function Banner({ kind, text }) {
  const err = kind === 'error';
  return (
    <View style={{ backgroundColor: err ? colors.danger + '15' : colors.success + '18', borderWidth: 1, borderColor: err ? colors.danger + '40' : colors.success + '55', borderRadius: radius.md, padding: 11 }}>
      <Text style={{ fontFamily: font.medium, fontSize: 13, color: err ? colors.danger : colors.primary }}>{text}</Text>
    </View>
  );
}

const fieldStyle = { paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, fontFamily: font.regular, fontSize: 15, color: colors.ink, backgroundColor: colors.surface };
const hintTxt = { fontFamily: font.regular, fontSize: 13, color: colors.muted, paddingVertical: 6 };
const ghostBtn = { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border };
const ghostBtnTxt = { fontFamily: font.semibold, fontSize: 12, color: colors.muted };
const primBtn = { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.sm, backgroundColor: colors.primary + '1A' };
const primBtnTxt = { fontFamily: font.semibold, fontSize: 12, color: colors.primary };
const submitBtn = { minHeight: 52, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, shadowColor: '#006666', shadowOpacity: 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 };
const submitTxt = { fontFamily: font.bold, fontSize: 16, color: '#fff' };
const sheetBackdrop = { flex: 1, backgroundColor: 'rgba(10,20,20,0.45)', justifyContent: 'flex-end' };
const sheetBody = { backgroundColor: colors.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, gap: 10 };
const pickRow = { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10 };
const statTxt = { fontFamily: font.regular, fontSize: 12, color: colors.muted };
const statNum = { fontFamily: font.bold, color: colors.ink };
