import { Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius } from '../theme';

// Главная кнопка ТСД v99: вертикальный градиент #00807f→#006666 + бирюзовое
// свечение (box-shadow --shadow-primary). Дети — обычно <Text style={submitTxt}>.
// style — доп. layout на внешний Pressable (flex:1, marginTop и т.п.).
export default function GradButton({ onPress, disabled, children, style, height = 50 }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[{ opacity: disabled ? 0.5 : 1 }, style]}>
      <LinearGradient
        colors={[colors.brandTop, colors.brand]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{
          minHeight: height,
          borderRadius: radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 16,
          shadowColor: '#006666',
          shadowOpacity: 0.22,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
        }}
      >
        {children}
      </LinearGradient>
    </Pressable>
  );
}
