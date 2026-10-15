import { useState } from 'react';
import { View, Text, FlatList } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { modules } from '../../data/modules';
import ScanField from '../../components/ScanField';
import ScreenHeader from '../../components/ScreenHeader';
import WhereScreen from '../modules/where';
import InventoryScreen from '../modules/inventory';
import PlacementScreen from '../modules/placement';
import PriemkaScreen from '../modules/priemka';
import FbsScreen from '../modules/fbs';
import RequestsScreen from '../modules/requests';
import { colors, font, radius, shadow } from '../../theme';

// Экран операции. Готовые модули — ПОЛНОЭКРАННЫЕ: каждый сам рисует свою шапку
// (ScreenHeader), т.к. ему нужны своя кнопка «назад» (шаги), подзаголовок и
// действие справа. Остальные — общая шапка + «полотно» (скан + накопитель).
const REAL = {
  where: WhereScreen,
  inventory: InventoryScreen,
  placement: PlacementScreen,
  priemka: PriemkaScreen,
  fbs: FbsScreen,
  requests: RequestsScreen,
};

export default function ModuleScreen() {
  const { key } = useLocalSearchParams();

  const mod =
    modules.find((m) => m.key === key) || { title: 'Модуль', subtitle: '', icon: 'cube-outline', color: colors.primary };
  const Real = REAL[key];

  if (Real) return <Real mod={mod} />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={mod.title} subtitle={mod.subtitle} />
      <StubScan />
    </View>
  );
}

// Временная заглушка для ещё не портированных модулей: поле скана + накопитель.
function StubScan() {
  const insets = useSafeAreaInsets();
  const [scan, setScan] = useState('');
  const [showKb, setShowKb] = useState(false);
  const [items, setItems] = useState([]);

  const add = () => {
    const v = scan.trim();
    setScan('');
    if (!v) return;
    setItems((prev) => [{ id: String(prev.length + 1) + '-' + v, code: v }, ...prev]);
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 16, paddingBottom: 4 }}>
        <ScanField
          value={scan}
          onChangeText={setScan}
          onSubmit={add}
          showKeyboard={showKb}
          onToggleKeyboard={() => setShowKb((s) => !s)}
        />
        <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.muted, marginTop: 8 }}>
          Модуль ещё переносится на React Native — пока демонстрационный скан.
        </Text>
      </View>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 8 }}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 56 }}>
            <MaterialCommunityIcons name="barcode-scan" size={48} color={colors.border} />
            <Text style={{ fontFamily: font.medium, color: colors.muted, marginTop: 12 }}>Пока пусто — отсканируйте код</Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <View style={[{ backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }, shadow.card]}>
            <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.accent + '1A', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: font.bold, color: colors.primary }}>{items.length - index}</Text>
            </View>
            <Text style={{ fontFamily: font.mono, fontSize: 14, color: colors.ink, flex: 1 }}>{item.code}</Text>
          </View>
        )}
      />
    </View>
  );
}
