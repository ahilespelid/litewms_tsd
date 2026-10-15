import { useRef } from 'react';
import { View, Text, Pressable } from 'react-native';
import { colors, font, radius } from '../theme';

// Экранный ввод количества (порт QtyPad.vue). Все кнопки на экране — системная
// клавиатура не нужна. value/onChange — число; limit — верхний предел (null = без).
// Первая набранная цифра заменяет 0, дальше дописываем справа.
export default function QtyPad({ value = 0, onChange, limit = null, onOver }) {
  const typed = useRef(false);

  const set = (n, isTyped = false) => {
    typed.current = !!isTyped;
    let v = Math.max(0, Math.floor(Number(n) || 0));
    if (limit != null && v > limit) { onOver && onOver(); v = limit; }
    onChange && onChange(v);
  };
  const bump = (d) => { typed.current = false; set(Math.max(0, Number(value || 0) + d)); };
  const pushDigit = (d) => {
    const cur = typed.current ? String(Number(value || 0)) : '';
    const raw = (cur === '0' ? '' : cur) + d;
    set(Number(raw.slice(0, 6)) || 0, true);
  };
  const backspace = () => {
    const cur = String(Number(value || 0));
    onChange && onChange(Number(cur.length > 1 ? cur.slice(0, -1) : '0') || 0);
  };
  const clear = () => { typed.current = false; onChange && onChange(0); };
  const all = () => { if (limit != null) { typed.current = false; onChange && onChange(limit); } };

  const Key = ({ label, onPress, variant }) => (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 52,
        borderRadius: radius.sm,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: variant === 'accent' ? colors.primary : colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ fontFamily: font.semibold, fontSize: 19, color: variant === 'accent' ? '#fff' : colors.ink }}>{label}</Text>
    </Pressable>
  );

  const atLimit = limit != null && Number(value) >= limit;

  return (
    <View style={{ gap: 8 }}>
      {/* табло со степперами */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable onPress={() => bump(-1)} style={stepStyle}><Text style={stepTxt}>−</Text></Pressable>
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.bg,
            borderRadius: radius.md,
            paddingVertical: 10,
            borderWidth: 2,
            borderColor: atLimit ? colors.danger : colors.primary,
          }}
        >
          <Text style={{ fontFamily: font.bold, fontSize: 30, color: colors.ink }}>{value}</Text>
        </View>
        <Pressable onPress={() => bump(1)} style={stepStyle}><Text style={stepTxt}>+</Text></Pressable>
      </View>

      {/* быстрые */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Key label="+10" onPress={() => bump(10)} />
        <Key label="+50" onPress={() => bump(50)} />
        <Key label="+100" onPress={() => bump(100)} />
        {limit != null ? <Key label={`Всё ${limit}`} onPress={all} variant="accent" /> : null}
      </View>

      {/* цифры */}
      {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['C', '0', '⌫']].map((rowk, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
          {rowk.map((k) => (
            <Key key={k} label={k} onPress={() => (k === 'C' ? clear() : k === '⌫' ? backspace() : pushDigit(k))} />
          ))}
        </View>
      ))}
    </View>
  );
}

const stepStyle = {
  width: 54,
  height: 54,
  borderRadius: 12,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: colors.surface,
  borderWidth: 1,
  borderColor: colors.border,
};
const stepTxt = { fontFamily: font.bold, fontSize: 26, color: colors.primary };
