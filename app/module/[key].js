import { useState } from 'react';
import { View, Text, FlatList, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { modules } from '../../data/modules';
import Field from '../../components/Field';
import { colors, font, radius, shadow } from '../../theme';

// Универсальный экран операции (demo): поле скана + накопитель отсканированного.
// Пока это «полотно» — реальной логики/запросов к бэкенду нет.
export default function ModuleScreen() {
  const { key } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const mod =
    modules.find((m) => m.key === key) || {
      title: 'Модуль',
      subtitle: '',
      icon: 'cube-outline',
      color: colors.primary,
    };

  const [scan, setScan] = useState('');
  const [items, setItems] = useState([]);

  const add = () => {
    const v = scan.trim();
    if (!v) return;
    setItems((prev) => [{ id: String(Date.now()), code: v }, ...prev]);
    setScan('');
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Шапка модуля */}
      <View
        style={{
          backgroundColor: colors.brand,
          paddingTop: insets.top + 12,
          paddingBottom: 18,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          borderBottomLeftRadius: 22,
          borderBottomRightRadius: 22,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#ffffff14', alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="chevron-back" size={22} color={colors.onDark} />
        </Pressable>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: '#ffffff14', alignItems: 'center', justifyContent: 'center' }}>
          <MaterialCommunityIcons name={mod.icon} size={22} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: font.bold, color: colors.onDark, fontSize: 18 }}>{mod.title}</Text>
          {mod.subtitle ? (
            <Text style={{ fontFamily: font.regular, color: colors.onDarkMuted, fontSize: 12 }}>{mod.subtitle}</Text>
          ) : null}
        </View>
      </View>

      {/* Поле скана */}
      <View style={{ padding: 16, paddingBottom: 4 }}>
        <Field
          label="Сканируйте штрихкод"
          value={scan}
          onChangeText={setScan}
          placeholder="Наведите сканер или введите код"
          returnKeyType="done"
          onSubmitEditing={add}
          right={
            <Pressable onPress={add} hitSlop={8}>
              <Ionicons name="add-circle" size={26} color={colors.primary} />
            </Pressable>
          }
        />
      </View>

      {/* Накопитель сканов */}
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 8 }}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 56 }}>
            <MaterialCommunityIcons name="barcode-scan" size={48} color={colors.border} />
            <Text style={{ fontFamily: font.medium, color: colors.muted, marginTop: 12 }}>
              Пока пусто — отсканируйте первый код
            </Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <View
            style={[
              { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
              shadow.card,
            ]}
          >
            <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.accent + '1A', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: font.bold, color: colors.primary }}>{items.length - index}</Text>
            </View>
            <Text style={{ fontFamily: font.mono, fontSize: 14, color: colors.ink, flex: 1 }}>{item.code}</Text>
            <View style={{ backgroundColor: colors.accent + '1A', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ fontFamily: font.semibold, fontSize: 11, color: colors.primary }}>принят</Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}
