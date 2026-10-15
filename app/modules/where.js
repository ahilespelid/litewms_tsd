import { useState, useCallback } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import ScanField from '../../components/ScanField';
import ScreenHeader from '../../components/ScreenHeader';
import { api } from '../../lib/api';
import { formatCellSpeech, speak } from '../../lib/cells';
import { useScanDedup } from '../../lib/scanner';
import { colors, font, radius, shadow } from '../../theme';

// «Где лежит»: скан ШК → GET /api/cells/scan?code= → ячейки товара + голос адреса.
// Первый реальный модуль RN-версии — проверяет весь фундамент: api + сканер + голос.
export default function WhereScreen({ mod }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [scan, setScan] = useState('');
  const [showKb, setShowKb] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { name, places: [{ code, quantity }] }
  const [error, setError] = useState('');
  const isDup = useScanDedup();

  const handleScan = useCallback(async () => {
    const code = scan.trim();
    setScan('');
    if (!code || isDup(code)) return;
    setBusy(true);
    setError('');
    try {
      const res = await api(`/api/cells/scan?code=${encodeURIComponent(code)}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.found) {
        setResult(null);
        setError(`Код ${code} — не найден`);
        speak('Не найдено');
        return;
      }
      if (d.kind !== 'product') {
        setResult(null);
        setError('Это ячейка, а не товар — пикните товар');
        return;
      }
      const places = (d.places || []).filter((p) => Number(p.quantity) > 0);
      setResult({ name: d.product?.name || d.name || code, places });
      const first = places[0]?.code;
      speak(first ? formatCellSpeech(first) : 'Ячейка неизвестна');
    } catch (e) {
      setResult(null);
      setError(e?.timeout ? 'Сеть недоступна — повторите' : 'Ошибка запроса');
    } finally {
      setBusy(false);
    }
  }, [scan, isDup]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={mod?.title || 'Где лежит'} subtitle={mod?.subtitle} onBack={() => router.back()} />
      <View style={{ padding: 16, gap: 12 }}>
        <ScanField
          value={scan}
          onChangeText={setScan}
          onSubmit={handleScan}
          showKeyboard={showKb}
          onToggleKeyboard={() => setShowKb((s) => !s)}
          placeholder="Сканируйте ШК товара…"
        />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }}>
        {error ? (
          <View style={{ backgroundColor: colors.danger + '15', borderRadius: radius.md, padding: 14, marginBottom: 12 }}>
            <Text style={{ fontFamily: font.medium, color: colors.danger }}>{error}</Text>
          </View>
        ) : null}

        {result ? (
          <View style={[{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16 }, shadow.card]}>
            <Text style={{ fontFamily: font.bold, fontSize: 16, color: colors.ink, marginBottom: 12 }}>{result.name}</Text>
            {result.places.length ? (
              result.places.map((p, i) => (
                <View
                  key={`${p.code}-${i}`}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 10,
                    borderTopWidth: i ? 1 : 0,
                    borderTopColor: colors.border,
                  }}
                >
                  <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: colors.accent + '1A', alignItems: 'center', justifyContent: 'center' }}>
                    <MaterialCommunityIcons name="map-marker" size={22} color={colors.primary} />
                  </View>
                  <Text style={{ flex: 1, fontFamily: font.mono, fontSize: 18, color: colors.primary }}>{p.code}</Text>
                  <Text style={{ fontFamily: font.semibold, color: colors.muted }}>×{p.quantity}</Text>
                </View>
              ))
            ) : (
              <Text style={{ fontFamily: font.medium, color: colors.muted }}>Товар не разложен по ячейкам</Text>
            )}
          </View>
        ) : !error ? (
          <View style={{ alignItems: 'center', paddingTop: 56 }}>
            <MaterialCommunityIcons name="map-marker-radius-outline" size={48} color={colors.border} />
            <Text style={{ fontFamily: font.medium, color: colors.muted, marginTop: 12, textAlign: 'center' }}>
              Сканируйте товар — покажу, где он лежит
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
