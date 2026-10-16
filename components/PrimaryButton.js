import { Pressable, Text, ActivityIndicator, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, font, radius } from '../theme';

// Кнопка ТСД v99: сплошной вариант — вертикальный градиент #00807f→#006666 +
// бирюзовое свечение (как .submit в premium.css); контурный — прозрачный с рамкой.
export default function PrimaryButton({ title, onPress, variant = 'solid', loading = false, style }) {
  const solid = variant === 'solid';
  const inner = (
    loading ? <ActivityIndicator color={solid ? '#fff' : colors.primary} /> : (
      <Text style={{ fontFamily: font.semibold, fontSize: 15, color: solid ? '#fff' : colors.primary }}>{title}</Text>
    )
  );
  return (
    <Pressable onPress={onPress} disabled={loading} style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1 }, style]}>
      {solid ? (
        <LinearGradient
          colors={[colors.brandTop, colors.brand]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={{ borderRadius: radius.sm, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', shadowColor: '#006666', shadowOpacity: 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 }}
        >
          {inner}
        </LinearGradient>
      ) : (
        <View style={{ borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.sm, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' }}>
          {inner}
        </View>
      )}
    </Pressable>
  );
}
