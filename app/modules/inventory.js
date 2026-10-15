import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Modal, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenHeader from '../../components/ScreenHeader';
import ScanField from '../../components/ScanField';
import QtyPad from '../../components/QtyPad';
import { api } from '../../lib/api';
import { speak } from '../../lib/cells';
import { useScanDedup } from '../../lib/scanner';
import { lsGet, lsSet, lsRemove } from '../../lib/storage';
import { colors, font, radius, shadow } from '../../theme';

// Инвентаризация (порт InventoryModule.vue): привести УЧЁТ к ФАКТУ по паре ИП+товар.
// Оператор вводит фактическое количество (не разницу) — сервер создаёт приход/списание.
// Ручки: GET /api/sklad/unified/ledger-by-company, GET /api/sklad/inventory/products,
// POST /api/sklad/inventory {company_id, items:[{product_id, qty_fact, defect_fact}]}.
export default function InventoryScreen({ mod }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState('company'); // 'company' | 'count'

  // шаг 1
  const [companies, setCompanies] = useState([]);
  const [companyQuery, setCompanyQuery] = useState('');
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [companiesError, setCompaniesError] = useState('');

  // шаг 2
  const [company, setCompany] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [result, setResult] = useState(null);
  const [showKb, setShowKb] = useState(false);
  const [scan, setScan] = useState('');
  const [flash, setFlash] = useState(null);

  // QtyPad
  const [pad, setPad] = useState(null); // { productId, field: 'fact'|'defect', value }
  const isDup = useScanDedup();

  const companyTitle = (c) => c?.full_name || c?.company_short_name || c?.company_name || 'контрагент';

  const loadCompanies = useCallback(async () => {
    setLoadingCompanies(true);
    setCompaniesError('');
    try {
      const res = await api('/api/sklad/unified/ledger-by-company?per_page=2000&sort_field=availableQuantity&sort_dir=desc');
      if (!res.ok) {
        setCompaniesError(res.status === 403 ? 'Нет доступа к складу' : `Не удалось загрузить список ИП (${res.status})`);
        return;
      }
      const d = await res.json();
      const items = Array.isArray(d?.items) ? d.items : [];
      setCompanies(
        items
          .filter((r) => Number(r.company_id) > 0)
          .map((r) => ({
            id: Number(r.company_id),
            full_name: String(r.name || r.company_name || '').trim(),
            stock: Number(r.availableQuantity ?? r.available_quantity ?? 0) || 0,
          })),
      );
    } catch (e) {
      setCompaniesError('Нет связи с сервером');
    } finally {
      setLoadingCompanies(false);
    }
  }, []);

  useEffect(() => { loadCompanies(); }, [loadCompanies]);

  const draftKey = (cid) => (cid ? `tsd.inventoryDraft.${cid}` : null);

  const loadProducts = useCallback(async (comp) => {
    if (!comp) return;
    setLoading(true);
    setError('');
    try {
      const res = await api(`/api/sklad/inventory/products?company_id=${comp.id}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        const detail = typeof d?.detail === 'string' ? d.detail : '';
        setError(res.status === 403 ? 'Нет права «Инвентаризация» — выдайте на сайте (Админ → Особые права)' : (detail || `Не удалось загрузить товары (${res.status})`));
        setRows([]);
        return;
      }
      const d = await res.json();
      let list = (d?.products || []).map((p) => ({ ...p, fact_total: '', fact_defect: '' }));
      // предложить восстановить черновик
      try {
        const raw = JSON.parse((await lsGet(draftKey(comp.id))) || 'null');
        if (raw && typeof raw === 'object' && Object.keys(raw).length) {
          Alert.alert('Незаконченный пересчёт', 'Есть незаконченный пересчёт этого ИП. Восстановить введённые количества?', [
            { text: 'Нет', style: 'cancel', onPress: () => lsRemove(draftKey(comp.id)) },
            { text: 'Восстановить', onPress: () => setRows((prev) => prev.map((r) => (raw[r.product_id] ? { ...r, fact_total: raw[r.product_id].f ?? '', fact_defect: raw[r.product_id].d ?? '' } : r))) },
          ]);
        }
      } catch (_) {}
      setRows(list);
    } catch (e) {
      setError('Нет связи с сервером');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const selectCompany = (c) => { setCompany(c); setStep('count'); setResult(null); loadProducts(c); };

  const saveDraft = useCallback((list, comp) => {
    const key = draftKey(comp?.id);
    if (!key) return;
    const d = {};
    for (const r of list) {
      if (String(r.fact_total).trim() !== '' || String(r.fact_defect).trim() !== '') d[r.product_id] = { f: r.fact_total, d: r.fact_defect };
    }
    if (Object.keys(d).length) lsSet(key, JSON.stringify(d));
    else lsRemove(key);
  }, []);

  const deltaOf = (row) => (String(row.fact_total).trim() === '' ? 0 : Number(row.fact_total) - Number(row.qty_total || 0));
  const filledRows = rows.filter((r) => String(r.fact_total).trim() !== '');
  const plusCount = rows.filter((r) => deltaOf(r) > 0).length;
  const minusCount = rows.filter((r) => deltaOf(r) < 0).length;

  const visibleRows = rows.filter((row) => {
    if (onlyChanged && deltaOf(row) === 0) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [row.product_name, row.article, row.barcode, row.color, row.size, ...(row.barcodes || []), ...(row.articles || [])]
      .some((v) => String(v || '').toLowerCase().includes(q));
  });

  const openPad = (row, field) => {
    const start = field === 'fact'
      ? (String(row.fact_total).trim() !== '' ? Number(row.fact_total) : Number(row.qty_total || 0))
      : (String(row.fact_defect).trim() !== '' ? Number(row.fact_defect) : 0);
    setPad({ productId: row.product_id, field, value: start });
  };

  const padLimit = (() => {
    if (!pad || pad.field === 'fact') return null;
    const row = rows.find((r) => r.product_id === pad.productId);
    const f = String(row?.fact_total ?? '').trim();
    return f !== '' ? Number(f) : Number(row?.qty_total || 0);
  })();

  const applyPad = () => {
    if (!pad) return;
    setRows((prev) => {
      const next = prev.map((r) => {
        if (r.product_id !== pad.productId) return r;
        if (pad.field === 'fact') {
          const fact = String(Number(pad.value) || 0);
          let defect = r.fact_defect;
          if (String(defect).trim() !== '' && Number(defect) > Number(fact)) defect = fact;
          return { ...r, fact_total: fact, fact_defect: defect };
        }
        const v = Number(pad.value) || 0;
        return { ...r, fact_defect: v > 0 ? String(v) : '' };
      });
      saveDraft(next, company);
      return next;
    });
    setPad(null);
  };

  const handleScan = useCallback(() => {
    const code = scan.trim();
    setScan('');
    if (!code || isDup(code) || pad) return;
    const row = rows.find((r) => r.barcode === code || (r.barcodes || []).includes(code));
    if (!row) { setError(`${code} — товар не найден у этого ИП`); speak('Не из этого ИП'); return; }
    setError('');
    setFlash(row.product_id);
    speak(row.product_name || 'Товар');
    openPad(row, 'fact');
  }, [scan, rows, pad, isDup]);

  const submit = async () => {
    if (!filledRows.length || saving) return;
    const items = filledRows.map((r) => ({
      product_id: r.product_id,
      qty_fact: Number(String(r.fact_total).replace(',', '.')) || 0,
      defect_fact: Number(String(r.fact_defect || 0).replace(',', '.')) || 0,
    }));
    if (items.find((i) => i.defect_fact > i.qty_fact)) {
      setError('Брака не может быть больше, чем всего насчитано');
      speak('Брака больше чем всего');
      return;
    }
    Alert.alert('Провести инвентаризацию?', `${items.length} поз. Система создаст приход/списание на разницу.`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Провести', onPress: () => doSubmit(items) },
    ]);
  };

  const doSubmit = async (items) => {
    setSaving(true);
    setError('');
    try {
      const res = await api('/api/sklad/inventory', { method: 'POST', body: JSON.stringify({ company_id: company.id, items }) });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        const detail = typeof d?.detail === 'string' ? d.detail : '';
        setError(res.status === 403 ? 'Нет права «Инвентаризация» — выдайте на сайте' : (detail || `Не удалось провести (${res.status})`));
        speak('Ошибка проведения');
        return;
      }
      const d = await res.json();
      const s = d?.summary || {};
      setResult({ total: s.total || items.length, plus: s.plus || 0, minus: s.minus || 0, same: s.same || 0 });
      speak('Инвентаризация проведена');
      lsRemove(draftKey(company.id));
      loadProducts(company);
    } catch (e) {
      setError('Нет связи с сервером');
      speak('Ошибка');
    } finally {
      setSaving(false);
    }
  };

  const goBack = () => {
    if (step === 'count') {
      if (filledRows.length) {
        Alert.alert('Выйти из пересчёта?', 'Введённые количества сохранятся черновиком.', [
          { text: 'Остаться', style: 'cancel' },
          { text: 'Выйти', onPress: () => { setStep('company'); setCompany(null); setRows([]); setResult(null); setSearch(''); setOnlyChanged(false); } },
        ]);
        return;
      }
      setStep('company'); setCompany(null); setRows([]); setResult(null);
      return;
    }
    router.back();
  };

  const q = companyQuery.trim().toLowerCase();
  const companiesShown = q
    ? companies.filter((c) => companyTitle(c).toLowerCase().includes(q) || String(c.inn || '').includes(q))
    : companies;

  const shkTail = (c) => String(c || '').slice(-4);
  const shkHead = (c) => { const s = String(c || ''); return s.length > 4 ? s.slice(0, -4) : ''; };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader
        title={mod?.title || 'Инвентаризация'}
        subtitle={step === 'count' ? companyTitle(company) : undefined}
        onBack={goBack}
        right={
          step === 'count' ? (
            <Pressable
              onPress={submit}
              disabled={!filledRows.length || saving}
              style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: '#fff', opacity: !filledRows.length || saving ? 0.45 : 1 }}
            >
              <Text style={{ fontFamily: font.bold, color: colors.primary, fontSize: 14 }}>{saving ? 'Проводим…' : 'Провести'}</Text>
            </Pressable>
          ) : null
        }
      />

      {step === 'company' ? (
        <View style={{ flex: 1, padding: 12, gap: 8 }}>
          <TextInput
            value={companyQuery}
            onChangeText={setCompanyQuery}
            placeholder="Поиск ИП — название или ИНН…"
            placeholderTextColor={colors.muted}
            style={inputStyle}
          />
          {companiesError ? <Text style={errText}>{companiesError}</Text> : loadingCompanies ? <Text style={hintText}>Загрузка списка ИП…</Text> : !companiesShown.length ? <Text style={hintText}>Ничего не найдено</Text> : null}
          <ScrollView contentContainerStyle={{ gap: 6, paddingBottom: insets.bottom + 16 }}>
            {companiesShown.map((c) => (
              <Pressable key={c.id} onPress={() => selectCompany(c)} style={[{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 14 }, shadow.card]}>
                <Text style={{ fontFamily: font.semibold, fontSize: 15, color: colors.ink }}>{companyTitle(c)}</Text>
                <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.muted, marginTop: 2 }}>на складе: {c.stock}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={{ padding: 12, gap: 8 }}>
            <ScanField value={scan} onChangeText={setScan} onSubmit={handleScan} showKeyboard={showKb} onToggleKeyboard={() => setShowKb((s) => !s)} placeholder="Сканируйте товар…" />
            <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.muted }}>
              Укажите, сколько товара на складе СЕЙЧАС (не разницу). Система сравнит с учётом и создаст приход/списание.
            </Text>
            {result ? (
              <View style={{ backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#a7f3d0', borderRadius: radius.md, padding: 10 }}>
                <Text style={{ fontFamily: font.semibold, fontSize: 13, color: '#065f46' }}>
                  Проведено: {result.total} поз · излишки {result.plus} · недостачи {result.minus} · без изм. {result.same}
                </Text>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <TextInput value={search} onChangeText={setSearch} placeholder="Поиск товара…" placeholderTextColor={colors.muted} style={[inputStyle, { flex: 1 }]} />
              <Pressable onPress={() => setOnlyChanged((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: onlyChanged ? colors.primary : colors.border, backgroundColor: onlyChanged ? colors.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {onlyChanged ? <Text style={{ color: '#fff', fontSize: 13 }}>✓</Text> : null}
                </View>
                <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.muted }}>расхождения</Text>
              </Pressable>
            </View>
            {error ? <Text style={errText}>{error}</Text> : null}
            {filledRows.length ? (
              <Text style={{ fontFamily: font.medium, fontSize: 12, color: colors.muted }}>
                Заполнено {filledRows.length}{plusCount ? ` · изл. ${plusCount}` : ''}{minusCount ? ` · нед. ${minusCount}` : ''}
              </Text>
            ) : null}
          </View>

          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
          ) : (
            <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 24, gap: 6 }}>
              {!visibleRows.length ? (
                <Text style={[hintText, { textAlign: 'center', marginTop: 32 }]}>{onlyChanged ? 'Расхождений нет' : 'Нет товаров'}</Text>
              ) : visibleRows.map((row) => {
                const factSet = String(row.fact_total).trim() !== '';
                const d = deltaOf(row);
                return (
                  <View key={row.product_id} style={[{ backgroundColor: colors.surface, borderWidth: 1, borderColor: flash === row.product_id ? colors.primary : colors.border, borderRadius: radius.md, padding: 10 }, shadow.card]}>
                    <Text style={{ fontFamily: font.semibold, fontSize: 14, color: colors.ink }} numberOfLines={1}>{row.product_name}</Text>
                    <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.muted }} numberOfLines={1}>
                      {row.barcode ? `ШК ${shkHead(row.barcode)}` : ''}<Text style={{ fontFamily: font.bold, color: colors.ink }}>{row.barcode ? shkTail(row.barcode) : ''}</Text>
                      {row.size ? ` · р.${row.size}` : ''}{row.color ? ` · ${row.color}` : ''}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                      <Cell label="учёт" value={String(Number(row.qty_total || 0))} />
                      <Pressable onPress={() => openPad(row, 'fact')} style={{ flex: 1, alignItems: 'center', paddingVertical: 5, borderRadius: radius.sm, borderWidth: 1, borderColor: factSet ? colors.primary : colors.border, backgroundColor: colors.surface }}>
                        <Text style={cellSmall}>факт</Text>
                        <Text style={{ fontFamily: font.bold, fontSize: 16, color: factSet ? colors.ink : colors.muted }}>{factSet ? row.fact_total : String(Number(row.qty_total || 0))}</Text>
                      </Pressable>
                      <Cell label="Δ" value={factSet ? (d > 0 ? `+${d}` : String(d)) : '—'} color={factSet ? (d > 0 ? '#047857' : d < 0 ? '#b91c1c' : colors.muted) : colors.muted} />
                    </View>
                    <Pressable onPress={() => openPad(row, 'defect')} style={{ marginTop: 6, paddingVertical: 5, borderRadius: radius.sm, borderWidth: 1, borderStyle: String(row.fact_defect).trim() !== '' && Number(row.fact_defect) > 0 ? 'solid' : 'dashed', borderColor: String(row.fact_defect).trim() !== '' && Number(row.fact_defect) > 0 ? '#f59e0b' : colors.border, alignItems: 'center' }}>
                      <Text style={{ fontFamily: font.medium, fontSize: 12, color: String(row.fact_defect).trim() !== '' && Number(row.fact_defect) > 0 ? '#b45309' : colors.muted }}>
                        брак {String(row.fact_defect).trim() !== '' ? row.fact_defect : 0}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      )}

      {/* ввод количества (QtyPad) */}
      <Modal visible={!!pad} transparent animationType="slide" onRequestClose={() => setPad(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' }} onPress={() => setPad(null)}>
          <Pressable style={{ backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 14, paddingBottom: insets.bottom + 14, gap: 10 }} onPress={() => {}}>
            {pad ? (() => {
              const row = rows.find((r) => r.product_id === pad.productId) || {};
              return (
                <>
                  <Text style={{ fontFamily: font.bold, fontSize: 15, color: colors.ink }} numberOfLines={1}>{row.product_name}</Text>
                  <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.muted }}>
                    {pad.field === 'fact' ? 'Фактически ВСЕГО' : 'Из них брак'} · учёт {Number(row.qty_total || 0)}
                  </Text>
                  <QtyPad value={pad.value} onChange={(v) => setPad((p) => ({ ...p, value: v }))} limit={padLimit} onOver={() => speak('Больше учёта нельзя')} />
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                    <Pressable onPress={() => setPad(null)} style={{ flex: 1, paddingVertical: 13, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
                      <Text style={{ fontFamily: font.semibold, color: colors.ink }}>Отмена</Text>
                    </Pressable>
                    <Pressable onPress={applyPad} style={{ flex: 1, paddingVertical: 13, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center' }}>
                      <Text style={{ fontFamily: font.semibold, color: '#fff' }}>Готово</Text>
                    </Pressable>
                  </View>
                </>
              );
            })() : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function Cell({ label, value, color }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingVertical: 5, borderRadius: radius.sm, backgroundColor: colors.bg }}>
      <Text style={cellSmall}>{label}</Text>
      <Text style={{ fontFamily: font.bold, fontSize: 16, color: color || colors.ink }}>{value}</Text>
    </View>
  );
}

const inputStyle = { paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, fontFamily: font.regular, fontSize: 15, color: colors.ink, backgroundColor: colors.surface };
const hintText = { fontFamily: font.regular, fontSize: 13, color: colors.muted, paddingVertical: 6 };
const errText = { fontFamily: font.semibold, fontSize: 13, color: colors.danger, paddingVertical: 6 };
const cellSmall = { fontFamily: font.medium, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: colors.muted };
