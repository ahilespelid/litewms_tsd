import { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Modal, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenHeader from '../../components/ScreenHeader';
import ScanField from '../../components/ScanField';
import QtyPad from '../../components/QtyPad';
import BasketList from '../../components/BasketList';
import { api } from '../../lib/api';
import { speak } from '../../lib/cells';
import { useScanDedup } from '../../lib/scanner';
import { useScanBasket } from '../../lib/basket';
import { colors, font, radius, shadow } from '../../theme';

// Перемещение товара между ячейками (порт MoveModule.vue). Поток: набрать товары в
// корзину → «Готово» → пикнуть «Откуда» (источник) и «Куда» (приёмник) → пачкой.
// По каждой строке НЕ атомарно: /take из «откуда», затем /put в «куда». Если take
// упал — строку не двигаем; если put упал ПОСЛЕ take — товар повис неразмещённым.
// embedded=true — встроен вкладкой в «Размещение» (свою шапку не рисуем).
const sound = (kind, text) => { if (text) speak(String(text)); };
const shkTail = (c) => String(c || '').slice(-4);
const shkHead = (c) => { const s = String(c || ''); return s.length > 4 ? s.slice(0, -4) : ''; };
const errMsg = (data) => { const d = data?.detail; return typeof d === 'string' ? d : (d?.message || data?.message || ''); };

function cellCmp(a, b) {
  const pa = String(a || '').split('-'), pb = String(b || '').split('-');
  const ra = (pa[0] || '').toUpperCase(), rb = (pb[0] || '').toUpperCase();
  if (ra !== rb) return ra < rb ? -1 : 1;
  const n = Math.max(pa.length, pb.length);
  for (let i = 1; i < n; i++) { const da = Number(pa[i]) || 0, db = Number(pb[i]) || 0; if (da !== db) return da - db; }
  return 0;
}

export default function MoveScreen({ mod, embedded = false }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scanRef = useRef(null);
  const isDup = useScanDedup();
  const basket = useScanBasket();

  const [phase, setPhase] = useState('scan'); // 'scan' | 'cells'
  const [fromShelf, setFromShelf] = useState(null);
  const [toShelf, setToShelf] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [scan, setScan] = useState('');
  const [showKb, setShowKb] = useState(false);

  const [shelves, setShelves] = useState([]);
  const [shelvesLoading, setShelvesLoading] = useState(true);
  const whRef = useRef(null);

  const [activeLineId, setActiveLineId] = useState(null);
  const activeLine = activeLineId != null ? basket.line(activeLineId) : null;

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchDone, setSearchDone] = useState(false);
  const [shelfPickerOpen, setShelfPickerOpen] = useState(false);
  const [shelfQuery, setShelfQuery] = useState('');
  const [pickerTarget, setPickerTarget] = useState('from'); // 'from' | 'to'
  const [lightbox, setLightbox] = useState(null);

  const refocus = useCallback(() => { setTimeout(() => scanRef.current?.focus(), 250); }, []);
  const whq = (prefix) => (whRef.current ? `${prefix}warehouse_id=${whRef.current}` : '');

  const loadShelves = useCallback(async () => {
    setShelvesLoading(true);
    try {
      let wid = whRef.current;
      const wr = await api('/api/cells/warehouses');
      if (wr.ok) { const list = (await wr.json())?.items || []; wid = (list.find((w) => w.is_default) || list[0])?.id || null; whRef.current = wid; }
      const res = await api(`/api/cells/nodes${wid ? `?warehouse_id=${wid}` : ''}`);
      if (!res.ok) throw new Error(`Сервер ответил ${res.status}`);
      const data = await res.json();
      setShelves((data?.items || [])
        .filter((n) => n.is_storable || n.node_type === 'box' || n.children_count === 0)
        .map((n) => ({ id: n.id, label: String(n.code || ''), code: String(n.code || '') })));
    } catch (e) { setError('Не удалось загрузить ячейки: ' + e.message); }
    finally { setShelvesLoading(false); }
  }, []);

  useEffect(() => { loadShelves(); sound('step', 'Пикните штрихкод товара'); }, [loadShelves]);

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
        const { line, incremented } = basket.addProduct({
          product_id: d.product.id, product_name: d.product.name, article: d.product.article, photo_url: d.product.photo_url, barcode: d.product.barcode || code,
        }, d.places || []);
        setNote(incremented ? `${line.product_name}: ${line.qty} шт` : line.product_name);
        sound('ok', String(line.qty));
        setSearchOpen(false);
        return;
      }

      if (d.kind === 'place') {
        if (d.node?.is_storable === false && !(d.items || []).length) { setError(`«${d.node.code}» — это не место хранения, а часть стеллажа`); sound('error', 'Не место хранения'); return; }
        if (!basket.count) { setError('Сначала пикните товары, потом ячейку'); sound('error', 'Ошибка. Сначала товар'); return; }
        setPhase('cells');
        const node = { id: d.node.id, label: d.node.code, code: d.node.code };
        if (!fromShelf) {
          setFromShelf(node);
          if (toShelf && toShelf.id === node.id) setToShelf(null);
          setNote(`Откуда: ${d.node.code}`); sound('step', 'Пикните ячейку');
        } else if (node.id === fromShelf.id) {
          setError('Та же ячейка'); sound('error', 'Ошибка');
        } else {
          setToShelf(node); setNote(`Куда: ${d.node.code}`); sound('ok', 'Ячейка');
        }
        setShelfPickerOpen(false);
        return;
      }
    } catch (e) { setError('Не удалось разобрать код: ' + e.message); sound('error', 'Ошибка'); }
    finally { setBusy(false); refocus(); }
  }, [isDup, basket, fromShelf, toShelf, refocus]);

  const onSubmitScan = useCallback(() => { const raw = scan; setScan(''); handleCode(raw); }, [scan, handleCode]);

  // --- поиск ---
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
    const places = (p.places && p.places.length) ? p.places : await fetchPlacesFor(p.barcode);
    const { line, incremented } = basket.addProduct(p, places);
    setNote(incremented ? `${line.product_name}: ${line.qty} шт` : line.product_name);
    sound('ok', String(line.qty));
    refocus();
  }, [basket, fetchPlacesFor, refocus]);

  // --- ячейки ---
  const fromLiesCells = (() => {
    const map = new Map();
    for (const l of basket.lines) for (const pl of (l.places || [])) {
      if (Number(pl.quantity) > 0 && !map.has(pl.node_id)) map.set(pl.node_id, { id: pl.node_id, label: pl.code, code: pl.code, lies: true });
    }
    return [...map.values()].sort((a, b) => cellCmp(a.code, b.code));
  })();

  const pickerCells = (() => {
    const q = shelfQuery.trim().toUpperCase();
    if (pickerTarget === 'from') { const lies = fromLiesCells; return q ? lies.filter((s) => s.label.toUpperCase().includes(q)) : lies; }
    return (q ? shelves.filter((s) => s.label.toUpperCase().includes(q)) : shelves)
      .filter((s) => !(fromShelf && s.id === fromShelf.id))
      .slice().sort((a, b) => cellCmp(a.label, b.label)).slice(0, 60);
  })();

  const openFromPicker = () => { setPickerTarget('from'); setShelfPickerOpen(true); setShelfQuery(''); };
  const openToPicker = () => { setPickerTarget('to'); setShelfPickerOpen(true); setShelfQuery(''); };

  const pickShelf = (s) => {
    const node = { id: s.id, label: s.label, code: s.code };
    setPhase('cells');
    if (pickerTarget === 'from') {
      setFromShelf(node);
      if (toShelf && toShelf.id === node.id) setToShelf(null);
      sound('step', 'Пикните ячейку');
    } else {
      if (fromShelf && node.id === fromShelf.id) { setError('Та же ячейка'); sound('error', 'Ошибка'); return; }
      setToShelf(node); sound('ok', 'Ячейка');
    }
    setShelfPickerOpen(false); refocus();
  };
  const pickShelfByQuery = () => {
    const q = shelfQuery.trim().toUpperCase();
    if (!q) return;
    const exact = shelves.find((s) => s.label.toUpperCase() === q);
    const hit = exact || (pickerCells.length === 1 ? pickerCells[0] : null);
    if (hit) pickShelf(hit); else sound('error', 'Ячейка не найдена');
  };
  const changeFrom = () => { setFromShelf(null); sound('step', 'Пикните ячейку'); refocus(); };
  const changeTo = () => { setToShelf(null); sound('step', 'Пикните ячейку'); refocus(); };

  const commonFromCell = () => {
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
    setPhase('cells'); setToShelf(null); setError(''); setNote('');
    const auto = commonFromCell();
    if (auto) { setFromShelf(auto); setNote(`Откуда: ${auto.label}`); } else setFromShelf(null);
    sound('step', 'Пикните ячейку'); refocus();
  };
  const backToScan = () => { setPhase('scan'); setFromShelf(null); setToShelf(null); basket.clearErrors(); setError(''); setNote(''); refocus(); };

  const canSubmit = phase === 'cells' && fromShelf && toShelf && fromShelf.id !== toShelf.id && basket.count > 0;

  const validateFrom = async () => {
    basket.clearErrors();
    for (const l of basket.lines) {
      try {
        const res = await api(`/api/cells/products/${l.product_id}/summary${whq('?')}`);
        if (!res.ok) continue;
        const d = await res.json();
        const here = (d?.places || []).find((c) => c.node_id === fromShelf.id);
        const avail = Math.max(0, Number(here?.quantity) || 0);
        if (Number(l.qty) > avail) l.err = `в ячейке: ${avail}`;
      } catch (_) {}
    }
  };

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true); setError(''); setNote('');
    try {
      await validateFrom();
      if (basket.hasErrors) { setError('Где перебор — уменьшите: столько нет в ячейке «откуда»'); sound('error', 'Больше нельзя'); return; }
      const fromLabel = fromShelf.label, toLabel = toShelf.label;
      let okCount = 0, okUnits = 0, fail = 0, stranded = 0;
      for (const l of basket.lines.slice()) {
        const owner = (l.places || []).find((pl) => pl.node_id === fromShelf.id)?.company_id
          ?? (l.places || []).find((pl) => pl.company_id)?.company_id ?? 0;
        const base = { product_id: l.product_id, company_id: owner, quality: 'good', quantity: Number(l.qty), source: 'tsd' };
        let tookOk = false;
        try {
          const takeRes = await api('/api/cells/stock/take', { method: 'POST', body: JSON.stringify({ node_id: fromShelf.id, ...base }) });
          if (!takeRes.ok) { const dd = await takeRes.json().catch(() => ({})); l.err = `забрать: ${errMsg(dd) || `сервер ${takeRes.status}`}`; fail++; continue; }
          tookOk = true;
          const putRes = await api('/api/cells/stock/put', { method: 'POST', body: JSON.stringify({ node_id: toShelf.id, ...base }) });
          if (!putRes.ok) { const dd = await putRes.json().catch(() => ({})); l.err = `забрали, но НЕ положили: ${errMsg(dd) || putRes.status} — товар неразмещён`; fail++; stranded++; basket.remove(l.product_id); continue; }
          okCount++; okUnits += Number(l.qty || 0); basket.remove(l.product_id);
        } catch (e) {
          if (tookOk) { l.err = `забрали, но НЕ положили: ${e.message} — товар неразмещён`; stranded++; basket.remove(l.product_id); }
          else l.err = e.message;
          fail++;
        }
      }
      if (okCount) { setNote(`Перемещено: ${okCount} поз. / ${okUnits} шт из ${fromLabel} в ${toLabel}`); sound('ok', 'Готово'); }
      if (fail) {
        setError(stranded
          ? `Не прошло строк: ${fail} (из них ${stranded} остались НЕразмещёнными — положите вручную)`
          : `Не прошло строк: ${fail} — см. подсвеченные`);
        if (!okCount) sound('error', 'Ошибка');
      }
      if (!basket.count) { setFromShelf(null); setToShelf(null); setPhase('scan'); refocus(); }
    } finally { setBusy(false); }
  };

  const reset = () => { basket.clear(); setFromShelf(null); setToShelf(null); setPhase('scan'); setActiveLineId(null); setError(''); setNote(''); sound('step', 'Пикните штрихкод товара'); refocus(); };
  const fillLine = (id) => { const l = basket.line(id); if (!l || l.max == null) return; basket.setQty(id, l.max); if (l.max <= 100) sound('ok', String(l.max)); };

  const placeholder = phase === 'scan'
    ? (basket.count ? 'Пикайте ещё товар…' : 'Пикните ШК товара…')
    : (!fromShelf ? 'Пикните ячейку, ОТКУДА забрать…' : (!toShelf ? 'Пикните ячейку, КУДА положить…' : 'Готово — жмите Переместить'));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {!embedded ? <ScreenHeader title={mod?.title || 'Перемещение'} subtitle={mod?.subtitle} onBack={() => router.back()} /> : null}

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 12, paddingTop: 8, paddingBottom: insets.bottom + 24, gap: 10 }}>
        {error ? <Banner kind="error" text={error} /> : null}
        {note ? <Banner kind="note" text={note} /> : null}

        <ScanField ref={scanRef} value={scan} onChangeText={setScan} onSubmit={onSubmitScan} showKeyboard={showKb} onToggleKeyboard={() => setShowKb((s) => !s)} placeholder={placeholder} />

        {phase === 'scan' ? (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontFamily: font.semibold, fontSize: 13, color: colors.muted }}>{basket.count ? `В корзине: ${basket.count} поз. · ${basket.totalUnits} шт` : 'Корзина пуста — пикайте товары'}</Text>
              <Pressable onPress={() => { setSearchOpen(true); setSearchQuery(''); setSearchResults([]); setSearchDone(false); }} style={ghostBtn}><Text style={ghostBtnTxt}>Найти</Text></Pressable>
            </View>
            <BasketList lines={basket.lines} editable showPlaces onInc={basket.inc} onDec={basket.dec} onRemove={basket.remove} onEdit={setActiveLineId} onFill={fillLine} onPhoto={(l) => l.photo_url && setLightbox({ src: l.photo_url, name: l.product_name })} />
            <View style={{ gap: 8, marginTop: 4 }}>
              <Pressable onPress={goDone} disabled={!basket.count} style={[submitBtn, !basket.count && { opacity: 0.45 }]}><Text style={submitTxt}>Готово · переместить ({basket.totalUnits})</Text></Pressable>
              {basket.count ? <Pressable onPress={reset} style={{ padding: 10, alignItems: 'center' }}><Text style={{ fontFamily: font.medium, color: colors.muted }}>Очистить корзину</Text></Pressable> : null}
            </View>
          </>
        ) : (
          <>
            <ShelfSlot label="Откуда" shelf={fromShelf} loading={shelvesLoading} onManual={openFromPicker} onToggle={() => (fromShelf ? changeFrom() : openFromPicker())} />
            <ShelfSlot label="Куда" shelf={toShelf} loading={shelvesLoading} onManual={openToPicker} onToggle={() => (toShelf ? changeTo() : openToPicker())} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontFamily: font.semibold, fontSize: 12, color: colors.muted }}>Перенесём: {basket.count} поз. · {basket.totalUnits} шт</Text>
              <Pressable onPress={backToScan} style={ghostBtn}><Text style={ghostBtnTxt}>Изменить</Text></Pressable>
            </View>
            <BasketList lines={basket.lines} editable={false} showPlaces onPhoto={(l) => l.photo_url && setLightbox({ src: l.photo_url, name: l.product_name })} />
            <View style={{ gap: 8, marginTop: 4 }}>
              <Pressable onPress={submit} disabled={!canSubmit || busy} style={[submitBtn, (!canSubmit || busy) && { opacity: 0.45 }]}><Text style={submitTxt}>{busy ? 'Перемещаю…' : `Переместить (${basket.totalUnits})`}</Text></Pressable>
              <Pressable onPress={backToScan} style={{ padding: 10, alignItems: 'center' }}><Text style={{ fontFamily: font.medium, color: colors.muted }}>← К сканам</Text></Pressable>
            </View>
          </>
        )}
      </ScrollView>

      {/* QtyPad */}
      <Modal visible={activeLineId != null && !!activeLine} transparent animationType="slide" onRequestClose={() => setActiveLineId(null)}>
        <Pressable style={sheetBackdrop} onPress={() => setActiveLineId(null)}>
          <Pressable style={[sheetBody, { paddingBottom: insets.bottom + 14 }]} onPress={() => {}}>
            {activeLine ? (
              <>
                <Text style={{ fontFamily: font.bold, fontSize: 15, color: colors.ink }} numberOfLines={1}>{activeLine.product_name}</Text>
                <QtyPad value={activeLine.qty} onChange={(v) => basket.setQty(activeLineId, v)} limit={null} />
                <Pressable onPress={() => setActiveLineId(null)} style={[submitBtn, { marginTop: 4 }]}><Text style={submitTxt}>Готово</Text></Pressable>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Поиск */}
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

      {/* Выбор ячейки */}
      <Modal visible={shelfPickerOpen} transparent animationType="slide" onRequestClose={() => setShelfPickerOpen(false)}>
        <Pressable style={sheetBackdrop} onPress={() => setShelfPickerOpen(false)}>
          <Pressable style={[sheetBody, { paddingBottom: insets.bottom + 14, maxHeight: '80%' }]} onPress={() => {}}>
            <Text style={{ fontFamily: font.semibold, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.muted }}>{pickerTarget === 'from' ? 'Откуда забрать' : 'Куда положить'}</Text>
            {pickerTarget === 'to' ? <TextInput value={shelfQuery} onChangeText={setShelfQuery} autoFocus placeholder="Например, G-1" placeholderTextColor={colors.muted} onSubmitEditing={pickShelfByQuery} style={fieldStyle} /> : null}
            {pickerTarget === 'from' && !pickerCells.length ? <Text style={hintTxt}>Товары корзины нигде не лежат — пикните ячейку-источник сканером.</Text> : null}
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 360 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {pickerCells.map((s) => (
                <Pressable key={String(s.id)} onPress={() => pickShelf(s)} style={{ minWidth: 72, paddingHorizontal: 14, paddingVertical: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: s.lies ? colors.accent : colors.border, backgroundColor: s.lies ? colors.accent + '14' : colors.surface }}>
                  <Text style={{ fontFamily: font.bold, fontSize: 15, color: colors.primary }}>{s.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable onPress={() => setShelfPickerOpen(false)} style={{ padding: 12, alignItems: 'center' }}><Text style={{ fontFamily: font.medium, color: colors.muted }}>Закрыть</Text></Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Фото */}
      <Modal visible={!!lightbox} transparent animationType="fade" onRequestClose={() => setLightbox(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(10,20,20,0.92)', alignItems: 'center', justifyContent: 'center', padding: 16, gap: 12 }} onPress={() => setLightbox(null)}>
          {lightbox ? <Image source={{ uri: lightbox.src }} style={{ width: '100%', height: '70%' }} resizeMode="contain" /> : null}
          {lightbox?.name ? <Text style={{ color: '#fff', fontFamily: font.regular, textAlign: 'center' }}>{lightbox.name}</Text> : null}
        </Pressable>
      </Modal>
    </View>
  );
}

function ShelfSlot({ label, shelf, loading, onManual, onToggle }) {
  return (
    <View style={[{ backgroundColor: colors.surface, borderWidth: 1, borderColor: shelf ? colors.primary : colors.border, borderRadius: radius.lg, padding: 12 }, shadow.card]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <Text style={{ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.muted }}>{label}</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {shelf ? <Pressable onPress={onManual} style={ghostBtn}><Text style={ghostBtnTxt}>Вручную</Text></Pressable> : null}
          <Pressable onPress={onToggle} style={primBtn}><Text style={primBtnTxt}>{shelf ? 'Сменить' : 'Выбрать'}</Text></Pressable>
        </View>
      </View>
      {shelf ? <Text style={{ fontFamily: font.bold, fontSize: 22, color: colors.primary }}>{shelf.label}</Text> : <Text style={{ fontFamily: font.regular, color: colors.muted }}>{loading ? 'загрузка…' : 'пикните ячейку'}</Text>}
    </View>
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
