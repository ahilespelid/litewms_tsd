import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenHeader from '../../components/ScreenHeader';
import OtborView from './otborView';
import DistributionView from './distributionView';
import { api } from '../../lib/api';
import { colors, font, radius, shadow } from '../../theme';

// Модуль «Заявки» (порт RequestsModule.vue): список заявок стадий 13 «На
// распределении» → DistributionView и 7 «В обработке» → OtborView. Список берём из
// канбана (/api/requests/kanban/basic?column_id=), а не из /api/requests (та
// фильтрует по user_id владельца и у части входов отдаёт 0).
const STAGE_PROCESSING = 7;
const STAGE_DISTRIBUTION = 13;
const mpLabel = (bt) => { const s = String(bt || '').toLowerCase(); return s === 'ozon' ? 'Озон' : s === 'wb' ? 'ВБ' : s === 'yandex' ? 'Яндекс' : s.toUpperCase(); };

export default function RequestsScreen({ mod }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState('list'); // list | work
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [requests, setRequests] = useState([]);
  const [request, setRequest] = useState(null);

  const fetchStage = async (col) => {
    const res = await api(`/api/requests/kanban/basic?column_id=${col}`);
    if (!res.ok) throw new Error(`Сервер ответил ${res.status}`);
    const d = await res.json();
    const rows = Array.isArray(d?.requests) ? d.requests : [];
    return rows.map((r) => ({ id: r.request_id ?? r.id, column_id: r.column_id ?? col, company_name: r.company_name || r.company_short_name || r.full_name || r.company || '', barcode_type: r.barcode_type || '' })).filter((r) => r.id != null);
  };
  const loadRequests = useCallback(async () => {
    setLoading(true); setError('');
    try { const [distr, otbor] = await Promise.all([fetchStage(STAGE_DISTRIBUTION), fetchStage(STAGE_PROCESSING)]); setRequests([...distr, ...otbor]); }
    catch (e) { setError('Не удалось загрузить заявки: ' + e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  const openRequest = (r) => { setRequest(r); setStep('work'); };
  const backToList = () => { setRequest(null); setStep('list'); loadRequests(); };

  if (step === 'work' && request) {
    return Number(request.column_id) === STAGE_PROCESSING
      ? <OtborView request={request} onBack={backToList} />
      : <DistributionView request={request} onBack={backToList} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={mod?.title || 'Заявки'} subtitle={mod?.subtitle} onBack={() => router.back()}
        right={<Pressable onPress={loadRequests} hitSlop={8} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: '#ffffff22', alignItems: 'center', justifyContent: 'center' }}>{loading ? <ActivityIndicator color={colors.onDark} size="small" /> : <Text style={{ color: colors.onDark, fontSize: 18 }}>↻</Text>}</Pressable>} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 24, gap: 8 }}>
        {error ? <View style={{ backgroundColor: colors.danger + '15', borderRadius: radius.md, padding: 11 }}><Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.danger }}>{error}</Text></View> : null}
        {requests.map((r) => { const otbor = Number(r.column_id) === STAGE_PROCESSING; return (
          <Pressable key={`${r.column_id}-${r.id}`} onPress={() => openRequest(r)} style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 14 }, shadow.card]}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: font.semibold, fontSize: 15, color: colors.ink }} numberOfLines={1}>{r.company_name || ('Заявка #' + r.id)}</Text>
              <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.muted }}>Заявка #{r.id}{r.barcode_type ? ` · ${mpLabel(r.barcode_type)}` : ''}</Text>
            </View>
            <View style={{ borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: otbor ? '#0e78b422' : colors.primary + '1A' }}>
              <Text style={{ fontFamily: font.bold, fontSize: 12, color: otbor ? '#0e78b4' : colors.primary }}>{otbor ? 'Отбор' : 'Распределение'}</Text>
            </View>
          </Pressable>
        ); })}
        {!loading && !requests.length && !error ? <Text style={{ fontFamily: font.regular, fontSize: 13, color: colors.muted }}>Нет заявок на распределение или отбор.</Text> : null}
      </ScrollView>
    </View>
  );
}
