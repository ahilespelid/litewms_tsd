import { View, Text, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, font } from '../theme';

// Тёмно-бирюзовая шапка экрана модуля — ВЕРТИКАЛЬНЫЙ градиент #00807f→#006666,
// плоская (без скругления низа), мягкая бирюзовая тень — ровно как header в
// premium.css старого ТСД v99. ‹ назад, заголовок, опц. действие справа.
export default function ScreenHeader({ title, subtitle, onBack, right }) {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient
      colors={[colors.brandTop, colors.brand]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={{
        paddingTop: insets.top + 12,
        paddingBottom: 14,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        shadowColor: '#006666',
        shadowOpacity: 0.2,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 4,
      }}
    >
      <Pressable
        onPress={onBack}
        hitSlop={10}
        style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#ffffff26', alignItems: 'center', justifyContent: 'center' }}
      >
        <Ionicons name="chevron-back" size={22} color={colors.onDark} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: font.bold, color: colors.onDark, fontSize: 17 }} numberOfLines={1}>{title}</Text>
        {subtitle ? (
          <Text style={{ fontFamily: font.regular, color: colors.onDarkMuted, fontSize: 12 }} numberOfLines={1}>{subtitle}</Text>
        ) : null}
      </View>
      {right}
    </LinearGradient>
  );
}
