import { Text, View } from 'react-native';
import { colors, font } from '../theme';

// Логотип LITEWMS с бирюзовой буквой W — как на боевом litebox.
export default function Brand({ size = 34, onDark = true, showSub = true }) {
  const base = onDark ? colors.onDark : colors.ink;
  return (
    <View>
      <Text style={{ fontFamily: font.bold, fontSize: size, letterSpacing: 1, color: base }}>
        LITE<Text style={{ color: colors.accent }}>W</Text>MS
      </Text>
      {showSub ? (
        <Text style={{ fontFamily: font.mono, fontSize: Math.round(size * 0.3), color: colors.accent, letterSpacing: 2, marginTop: 4 }}>
          ТСД · 2.0
        </Text>
      ) : null}
    </View>
  );
}
