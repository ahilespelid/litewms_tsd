import { View, Text, TextInput } from 'react-native';
import { colors, font, radius } from '../theme';

// Поле ввода: подпись сверху, белая «пилюля» со скруглением, опц. иконка справа.
export default function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  autoCapitalize = 'none',
  right,
  onSubmitEditing,
  returnKeyType,
  autoFocus,
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      {label ? (
        <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.muted, marginBottom: 6 }}>{label}</Text>
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.sm,
          paddingHorizontal: 14,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoFocus={autoFocus}
          onSubmitEditing={onSubmitEditing}
          returnKeyType={returnKeyType}
          style={{ flex: 1, fontFamily: font.regular, fontSize: 16, color: colors.ink, paddingVertical: 14 }}
        />
        {right}
      </View>
    </View>
  );
}
