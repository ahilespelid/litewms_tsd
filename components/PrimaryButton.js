import { Pressable, Text, ActivityIndicator } from 'react-native';
import { colors, font, radius } from '../theme';

// Кнопка в стиле litebox: сплошная зелёная или контурная.
export default function PrimaryButton({ title, onPress, variant = 'solid', loading = false, style }) {
  const solid = variant === 'solid';
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [
        {
          backgroundColor: solid ? colors.primary : 'transparent',
          borderWidth: solid ? 0 : 1.5,
          borderColor: colors.primary,
          borderRadius: radius.sm,
          paddingVertical: 15,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={solid ? '#fff' : colors.primary} />
      ) : (
        <Text style={{ fontFamily: font.semibold, fontSize: 15, color: solid ? '#fff' : colors.primary }}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}
