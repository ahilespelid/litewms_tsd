import { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, Image, Modal, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenHeader from '../../components/ScreenHeader';
import ScanField from '../../components/ScanField';
import { api } from '../../lib/api';
import { speak, formatCellSpeech, getCellVoiceMode } from '../../lib/cells';
import { lsGet, lsSet } from '../../lib/storage';
import { colors, font, radius, shadow } from '../../theme';

// Отбор (подбор с ячеек) по заявке — порт OtborView.vue. Скан ШК/тап позиции →
// карточка «куда идти» (крупная ячейка + фото) + кнопка «Снять ✓» (POST
// /api/cells/stock/take) / «Вернуть» (put). Идемпотентность — ТОЛЬКО на клиенте
// (otborTaken по link_id, поштучно): бэк take не защищён от двойного снятия.
const sound = (kind, text) => { if (text) speak(String(text)); };
const cellSpeech = (code) => formatCellSpeech(code, getCellVoiceMode());
const shkTail = (c) => String(c || '').slice(-4);
const shkHead = (c) => { const s = String(c || ''); return s.length > 4 ? s.slice(0, -4) : ''; };
const photoOf = (r) => r?.photo_url || r?.image_url || r?.image || '';
const cellsStr = (places) => (places || []).filter((p) => Number(p.quantity) > 0).map((p) => `${p.code} ×${p.quantity}`).join(', ');
const firstCell = (r) => (r.places || []).find((p) => Number(p.quantity) > 0)?.code || (r.places || [])[0]?.code || '';
const cellRack = (code) => String(code || '').split('-')[0] || '—';
const cellNums = (code) => String(code || '').split('-').slice(1).join('-');
const isGoodQuality = (p) => { const q = String(p?.quality || 'good').toLowerCase(); return q === 'good' || q === ''; };
const goodPlaces = (places) => (places || []).filter((p) => Number(p.quantity) > 0 && isGoodQuality(p));

function comparePickRoute(a, b) {
  const A = firstCell(a), B = firstCell(b);
  if (!A && !B) return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
  if (!A) return 1; if (!B) return -1;
  const pa = A.split('-'), pb = B.split('-'); const ra = (pa[0] || '').toUpperCase(), rb = (pb[0] || '').toUpperCase();
  if (ra !== rb) return ra < rb ? -1 : 1; const n = Math.max(pa.length, pb.length);
  for (let i = 1; i < n; i++) { const da = Number(pa[i]) || 0, db = Number(pb[i]) || 0; if (da !== db) return da - db; } return 0;
}
function pickCells(places, want) {
  const live = goodPlaces(places); if (!live.length || want <= 0) return [];
  const enough = live.filter((p) => Number(p.quantity) >= want).sort((a, b) => a.quantity - b.quantity);
  if (enough.length) return [{ node_id: enough[0].node_id, company_id: enough[0].company_id || 0, code: enough[0].code, qty: want, quality: enough[0].quality || 'good' }];
  const out = []; let need = want;
  for (const p of [...live].sort((a, b) => b.quantity - a.quantity)) { if (need <= 0) break; const take = Math.min(need, Number(p.quantity)); out.push({ node_id: p.node_id, company_id: p.company_id || 0, code: p.code, qty: take, quality: p.quality || 'good' }); need -= take; }
  return out;
}

export default function OtborView({ request, onBack }) {
  const insets = useSafeAreaInsets();
  const scanRef = useRef(null);
  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => (n + 1) % 1e9), []);

  const rowsRef = useRef([]);
  const otborTakenRef = useRef({});
  const otborBusy = useRef(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastMsg, setLastMsg] = useState(null);
  const [scan, setScan] = useState('');
  const [showKb, setShowKb] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null);
  const [targetFace, setTargetFace] = useState('cell');
  const [lightbox, setLightbox] = useState(null);

  const rows = rowsRef.current;
  const takenKey = () => `tsd.proc.otbortaken.${request?.id}`;
  const logLine = (kind, text) => setLastMsg({ kind, text });
  const refocus = useCallback(() => { setTimeout(() => scanRef.current?.focus(), 250); }, []);

  const mapRow = (it) => ({
    link_id: String(it.link_id ?? it.product_id),
    product_id: it.product_id, productId: it.product_id,
    name: it.name || it.product_name || '', article: it.vendor_code || it.article || '',
    barcodes: [it.barcode, it.barcode_ozon, it.barcode_wb].filter(Boolean),
    size: String(it.size || '').trim(), photo_url: it.photo_url || it.photo || '',
    need: Number(it.qty ?? it.quantity ?? 0), siteDone: Number(it.qty_done ?? 0), places: [], cells: '',
  });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      try { otborTakenRef.current = JSON.parse((await lsGet(takenKey())) || '{}') || {}; } catch (_) { otborTakenRef.current = {}; }
      const res = await api(`/api/requests/full/${request.id}`);
      if (res.status === 404 || res.status === 403) { setError('Нет доступа к заявке на этом аккаунте. Откройте её на ПК или попросите доступ к «Заявкам».'); rowsRef.current = []; return; }
      if (!res.ok) { setError(`Не удалось загрузить заявку (сервер ${res.status}).`); rowsRef.current = []; return; }
      const full = await res.json();
      const pp = (full?.processing || []).flatMap((pf) => (Array.isArray(pf.parsed_products) ? pf.parsed_products : []));
      rowsRef.current = pp.map(mapRow).filter((r) => r.product_id);
    } catch (e) { setError('Сеть недоступна: ' + (e?.message || e)); rowsRef.current = []; }
    finally { setLoading(false); rerender(); }
    loadCells();
    refocus();
  }, [request, refocus, rerender]);

  useEffect(() => { load(); }, [load]);

  const loadCells = useCallback(async () => {
    const seen = new Set(); const queue = [];
    for (const r of rowsRef.current) for (const bc of r.barcodes) { if (seen.has(bc)) continue; seen.add(bc); queue.push(bc); }
    const cache = {};
    const worker = async () => { while (queue.length) { const bc = queue.shift(); try { const res = await api(`/api/cells/scan?code=${encodeURIComponent(bc)}`); if (res.ok) { const d = await res.json(); if (d?.found && d.kind === 'product') cache[bc] = { productId: d.product?.id || null, places: goodPlaces(d.places) }; } } catch (_) {} } };
    await Promise.all([worker(), worker(), worker(), worker()]);
    for (const r of rowsRef.current) { const hit = r.barcodes.map((bc) => cache[bc]).find(Boolean); if (hit) { r.places = hit.places; if (hit.productId) r.productId = hit.productId; r.cells = cellsStr(r.places); } }
    rerender();
  }, [rerender]);

  const rescanRow = async (r) => {
    for (const bc of r.barcodes) { try { const res = await api(`/api/cells/scan?code=${encodeURIComponent(bc)}`); if (!res.ok) continue; const d = await res.json(); if (d?.found && d.kind === 'product') { r.places = goodPlaces(d.places); if (d.product?.id) r.productId = d.product.id; r.cells = cellsStr(r.places); return; } } catch (_) {} }
  };

  const saveTaken = () => { lsSet(takenKey(), JSON.stringify(otborTakenRef.current)); };
  const takenQty = (r) => (otborTakenRef.current[r.link_id] || []).reduce((s, t) => s + (Number(t.qty) || 0), 0);
  const leftToTake = (r) => Math.max(0, r.need - takenQty(r));
  const isDone = (r) => r.need > 0 && takenQty(r) >= r.need;

  const sortedRows = [...rows].sort((x, y) => ((isDone(x) ? 1 : 0) - (isDone(y) ? 1 : 0)) || comparePickRoute(x, y));
  const nextRow = sortedRows.find((r) => leftToTake(r) > 0) || null;
  const activeRow = (() => { if (selectedKey != null) { const r = rows.find((x) => x.link_id === selectedKey); if (r) return r; } return nextRow; })();
  const positions = rows.length;
  const doneCount = rows.filter(isDone).length;
  const unitsTotal = rows.reduce((s, r) => s + r.need, 0);
  const unitsTaken = rows.reduce((s, r) => s + Math.min(takenQty(r), r.need), 0);
  const allDone = positions > 0 && doneCount >= positions;

  const removeTakenRecord = (key, t) => { const arr = otborTakenRef.current[key] || []; const i = arr.indexOf(t); if (i >= 0) arr.splice(i, 1); if (!arr.length) delete otborTakenRef.current[key]; saveTaken(); };

  const applyTake = (r) => {
    const key = r.link_id; if (otborBusy.current.has(key)) return;
    const want = r.need - takenQty(r);
    if (want <= 0) { sound('ok', 'Уже снято'); return; }
    if (!r.places || !r.places.length) { logLine('error', `${r.name}: ячейка неизвестна — снять нельзя`); sound('error', 'Нет ячейки'); return; }
    if (!r.productId) { logLine('error', `${r.name}: не знаю product_id`); sound('error', 'Ошибка'); return; }
    const plan = pickCells(r.places, want);
    if (!plan.length) { logLine('error', `${r.name}: в ячейках нет остатка`); sound('error', 'Нет остатка'); return; }
    otborBusy.current.add(key);
    (async () => {
      let took = 0, conflict = false;
      try {
        for (const p of plan) {
          const rec = { node_id: p.node_id, company_id: p.company_id || 0, code: p.code, qty: p.qty, quality: p.quality || 'good', product_id: r.productId };
          const res = await api('/api/cells/stock/take', { method: 'POST', body: JSON.stringify({ node_id: p.node_id, product_id: r.productId, company_id: p.company_id || 0, quality: p.quality || 'good', quantity: p.qty, source: 'tsd' }) });
          const d = await res.json().catch(() => ({}));
          if (!res.ok) { if (res.status === 409) { conflict = true; break; } logLine('error', `${r.name}: ${d.detail?.message || d.detail || d.message || ('ошибка ' + res.status)}`); continue; }
          otborTakenRef.current[key] = [...(otborTakenRef.current[key] || []), rec]; saveTaken();
          const pl = r.places.find((x) => x.node_id === p.node_id); if (pl) pl.quantity = Math.max(0, pl.quantity - p.qty);
          took += p.qty;
        }
        r.cells = cellsStr(r.places);
        if (took) { logLine('ok', `${r.name}: снято ${took}${leftToTake(r) ? ` · осталось ${leftToTake(r)}` : ' · готово'}`); sound('ok', leftToTake(r) ? `Снято ${took}` : 'Снято, готово'); }
        if (conflict) { await rescanRow(r); logLine('error', `${r.name}: ячейка изменилась — обновил остаток, повторите`); sound('error', 'Ячейка изменилась'); }
      } finally { otborBusy.current.delete(key); rerender(); refocus(); }
    })();
  };
  const revertTake = (r) => {
    const key = r.link_id; const taken = [...(otborTakenRef.current[key] || [])]; if (!taken.length) return;
    otborBusy.current.add(key);
    (async () => {
      try {
        let returned = 0;
        for (const t of taken) {
          const res = await api('/api/cells/stock/put', { method: 'POST', body: JSON.stringify({ node_id: t.node_id, product_id: t.product_id || r.productId, company_id: t.company_id || 0, quality: t.quality || 'good', quantity: t.qty, source: 'tsd' }) });
          if (!res.ok) { const d = await res.json().catch(() => ({})); logLine('error', `${r.name}: возврат не прошёл (${d.detail?.message || d.detail || res.status})`); continue; }
          const pl = r.places.find((x) => x.node_id === t.node_id); if (pl) pl.quantity += t.qty;
          removeTakenRecord(key, t); returned += t.qty;
        }
        r.cells = cellsStr(r.places);
        if (returned) { logLine('ok', `${r.name}: возвращено в ячейку`); sound('ok', 'Возвращено'); }
      } finally { otborBusy.current.delete(key); rerender(); refocus(); }
    })();
  };

  const selectRow = (r) => { setSelectedKey(r.link_id); setTargetFace('cell'); const code = firstCell(r); const left = leftToTake(r); if (left > 0) sound('step', code ? `Снять ${left}. ${cellSpeech(code)}` : `Снять ${left}`); else sound('ok', 'Уже снято'); refocus(); };
  const takeActive = () => { const r = activeRow; if (!r) return; setSelectedKey(null); applyTake(r); };
  const revertActive = () => { const r = activeRow; if (!r) return; setSelectedKey(null); revertTake(r); };
  const handleScan = () => { const c = scan.trim(); setScan(''); if (!c) return; const r = rows.find((x) => x.barcodes.includes(c)); if (!r) { logLine('error', `ШК ${c} — нет в заявке`); sound('error', 'Нет в заявке'); refocus(); return; } selectRow(r); };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={`Отбор · №${request?.id}`} subtitle={request?.company_name} onBack={onBack} />
      <View style={{ padding: 12, gap: 10 }}>
        {error ? <Banner kind="error" text={error} /> : null}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Counter n={`${doneCount}/${positions}`} label="позиций" ok={allDone} />
          <Counter n={`${unitsTaken}/${unitsTotal}`} label="штук" ok={allDone} />
        </View>

        {activeRow ? (
          <View style={{ backgroundColor: colors.surface, borderWidth: 2, borderColor: isDone(activeRow) ? colors.success : colors.primary, borderRadius: radius.lg, padding: 12, gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Pressable onPress={() => setTargetFace(targetFace === 'cell' ? 'photo' : 'cell')} style={{ width: 92, height: 92, borderRadius: radius.md, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {targetFace === 'photo' ? (photoOf(activeRow) ? <Image source={{ uri: photoOf(activeRow) }} style={{ width: '100%', height: '100%' }} /> : <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.muted }}>нет фото</Text>)
                  : firstCell(activeRow) ? (<><Text style={{ fontFamily: font.medium, fontSize: 9, color: colors.muted }}>СТЕЛЛАЖ</Text><Text style={{ fontFamily: font.bold, fontSize: 34, color: colors.primary }}>{cellRack(firstCell(activeRow))}</Text>{cellNums(firstCell(activeRow)) ? <Text style={{ fontFamily: font.semibold, fontSize: 12, color: colors.ink }}>{cellNums(firstCell(activeRow))}</Text> : null}</>)
                    : (<><Text style={{ fontFamily: font.medium, fontSize: 9, color: colors.muted }}>ЯЧЕЙКА</Text><Text style={{ fontFamily: font.bold, fontSize: 28, color: colors.muted }}>—</Text></>)}
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: font.semibold, fontSize: 14, color: colors.ink }} numberOfLines={2}>{activeRow.name || '—'}</Text>
                {activeRow.cells ? <Text style={{ fontFamily: font.medium, fontSize: 12, color: colors.primary, marginTop: 2 }}>{cellSpeech(firstCell(activeRow))} · {activeRow.cells}</Text> : <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.muted, marginTop: 2 }}>ячейка неизвестна</Text>}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {activeRow.size ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.muted }}>р.{activeRow.size}</Text> : null}
                  {activeRow.barcodes[0] ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.muted }}>{shkHead(activeRow.barcodes[0])}<Text style={{ fontFamily: font.bold, color: colors.ink }}>{shkTail(activeRow.barcodes[0])}</Text></Text> : null}
                  <Text style={{ fontFamily: font.bold, fontSize: 12, color: isDone(activeRow) ? colors.success : colors.accent }}>снято {takenQty(activeRow)}/{activeRow.need}</Text>
                </View>
              </View>
            </View>
            {isDone(activeRow)
              ? <Pressable onPress={revertActive} style={outlineBtn}><Text style={outlineTxt}>Вернуть в ячейку</Text></Pressable>
              : <Pressable onPress={takeActive} disabled={otborBusy.current.has(activeRow.link_id)} style={[submitBtn, otborBusy.current.has(activeRow.link_id) && { opacity: 0.5 }]}><Text style={submitTxt}>Снять ✓ ×{leftToTake(activeRow)}</Text></Pressable>}
          </View>
        ) : null}

        <ScanField ref={scanRef} value={scan} onChangeText={setScan} onSubmit={handleScan} showKeyboard={showKb} onToggleKeyboard={() => setShowKb((s) => !s)} placeholder="Пикните ШК товара…" />
        {lastMsg ? <Text style={{ fontFamily: font.medium, fontSize: 13, color: lastMsg.kind === 'error' ? colors.danger : colors.primary }}>{lastMsg.text}</Text> : null}
      </View>

      {loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} /> : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 24, gap: 6 }}>
          {sortedRows.map((r) => { const done = isDone(r); return (
            <Pressable key={r.link_id} onPress={() => selectRow(r)} style={[planRow, done && { opacity: 0.55 }, activeRow?.link_id === r.link_id && { borderColor: colors.primary }]}>
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                {photoOf(r) ? <Pressable onPress={() => setLightbox({ src: photoOf(r), name: r.name })}><Image source={{ uri: photoOf(r) }} style={thumb} /></Pressable> : null}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: font.semibold, fontSize: 13, color: colors.ink }} numberOfLines={2}>{r.name || '—'}</Text>
                  <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.muted }}>{r.cells ? `📍 ${r.cells}` : 'нет ячейки'}</Text>
                </View>
                <Text style={{ fontFamily: font.bold, fontSize: 13, color: done ? colors.success : colors.muted }}>{takenQty(r)}/{r.need}{done ? ' ✓' : ''}</Text>
              </View>
            </Pressable>
          ); })}
          {!loading && !rows.length && !error ? <Text style={hintTxt}>В заявке нет позиций для отбора.</Text> : null}
        </ScrollView>
      )}

      <Modal visible={!!lightbox} transparent animationType="fade" onRequestClose={() => setLightbox(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(10,20,20,0.92)', alignItems: 'center', justifyContent: 'center', padding: 16, gap: 12 }} onPress={() => setLightbox(null)}>
          {lightbox ? <Image source={{ uri: lightbox.src }} style={{ width: '100%', height: '70%' }} resizeMode="contain" /> : null}
          {lightbox?.name ? <Text style={{ color: '#fff', fontFamily: font.regular, textAlign: 'center' }}>{lightbox.name}</Text> : null}
        </Pressable>
      </Modal>
    </View>
  );
}

function Counter({ n, label, ok }) { return (<View style={[{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: ok ? colors.success : colors.border, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center' }, shadow.card]}><Text style={{ fontFamily: font.bold, fontSize: 17, color: ok ? colors.success : colors.ink }}>{n}</Text><Text style={{ fontFamily: font.medium, fontSize: 11, color: colors.muted }}>{label}</Text></View>); }
function Banner({ kind, text }) { const err = kind === 'error'; return <View style={{ backgroundColor: err ? colors.danger + '15' : colors.success + '18', borderWidth: 1, borderColor: err ? colors.danger + '40' : colors.success + '55', borderRadius: radius.md, padding: 11 }}><Text style={{ fontFamily: font.medium, fontSize: 13, color: err ? colors.danger : colors.primary }}>{text}</Text></View>; }

const hintTxt = { fontFamily: font.regular, fontSize: 13, color: colors.muted, paddingVertical: 6 };
const planRow = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10 };
const thumb = { width: 46, height: 46, borderRadius: 8, backgroundColor: colors.bg };
const submitBtn = { minHeight: 50, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 };
const submitTxt = { fontFamily: font.bold, fontSize: 16, color: '#fff' };
const outlineBtn = { minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' };
const outlineTxt = { fontFamily: font.semibold, fontSize: 15, color: colors.ink };
