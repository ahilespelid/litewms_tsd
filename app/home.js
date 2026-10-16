import { View, Text, FlatList, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { modules } from '../data/modules';
import ModuleCard from '../components/ModuleCard';
import { colors, font } from '../theme';

// Рабочий стол: тёмно-зелёная шапка + сетка модулей 2 в ряд.
export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Шапка */}
      <View
        style={{
          backgroundColor: colors.brand,
          paddingTop: insets.top + 16,
          paddingBottom: 22,
          paddingHorizontal: 20,
        }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Text style={{ fontFamily: font.mono, color: colors.accent, fontSize: 11, letterSpacing: 2 }}>
              LITEWMS · ТСД
            </Text>
            <Text style={{ fontFamily: font.bold, color: colors.onDark, fontSize: 22, marginTop: 4 }}>
              Рабочий стол
            </Text>
          </View>
          <Pressable
            onPress={() => router.replace('/')}
            hitSlop={10}
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              backgroundColor: '#ffffff14',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="log-out-outline" size={20} color={colors.onDark} />
          </Pressable>
        </View>
      </View>

      {/* Сетка модулей */}
      <FlatList
        data={modules}
        keyExtractor={(i) => i.key}
        numColumns={2}
        columnWrapperStyle={{ gap: 12 }}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 24 }}
        ListHeaderComponent={
          <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.muted, marginBottom: 12 }}>
            Выберите операцию
          </Text>
        }
        renderItem={({ item }) => (
          <ModuleCard item={item} onPress={() => router.push(`/module/${item.key}`)} />
        )}
      />
    </View>
  );
}
