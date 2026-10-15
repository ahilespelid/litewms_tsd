import { View, Text, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, font } from '../theme';

// Тёмно-зелёная шапка экрана модуля: ‹ назад, заголовок, опц. действие справа.
export default function ScreenHeader({ title, subtitle, onBack, right }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        backgroundColor: colors.brand,
        paddingTop: insets.top + 12,
        paddingBottom: 16,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderBottomLeftRadius: 22,
        borderBottomRightRadius: 22,
      }}
    >
      <Pressable
        onPress={onBack}
        hitSlop={10}
        style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#ffffff14', alignItems: 'center', justifyContent: 'center' }}
      >
        <Ionicons name="chevron-back" size={22} color={colors.onDark} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: font.bold, color: colors.onDark, fontSize: 18 }} numberOfLines={1}>{title}</Text>
        {subtitle ? (
          <Text style={{ fontFamily: font.regular, color: colors.onDarkMuted, fontSize: 12 }} numberOfLines={1}>{subtitle}</Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}
