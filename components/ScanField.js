import { forwardRef } from 'react';
import { View, TextInput, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius } from '../theme';

// Поле скана для ТСД: держит фокус БЕЗ системной клавиатуры
// (showSoftInputOnFocus={false}) — железный сканер печатает код и жмёт Enter.
// Кнопка ⌨ временно включает клавиатуру для ручного ввода.
const ScanField = forwardRef(function ScanField(
  { value, onChangeText, onSubmit, placeholder = 'Сканируйте штрихкод…', showKeyboard, onToggleKeyboard, autoFocus = true, disabled },
  ref,
) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: disabled ? colors.bg : colors.surface,
          borderWidth: 2,
          borderColor: disabled ? colors.border : colors.primary,
          borderRadius: radius.sm,
          paddingHorizontal: 14,
        }}
      >
        <TextInput
          ref={ref}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={autoFocus}
          editable={!disabled}
          blurOnSubmit={false}
          showSoftInputOnFocus={!!showKeyboard}
          returnKeyType="done"
          onSubmitEditing={() => onSubmit && onSubmit()}
          style={{ flex: 1, fontFamily: font.regular, fontSize: 16, color: colors.ink, paddingVertical: 14 }}
        />
      </View>
      {onToggleKeyboard ? (
        <Pressable
          onPress={onToggleKeyboard}
          hitSlop={8}
          style={{
            width: 48,
            height: 48,
            borderRadius: radius.sm,
            borderWidth: 1,
            borderColor: showKeyboard ? colors.primary : colors.border,
            backgroundColor: showKeyboard ? colors.primary + '1A' : colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="keypad-outline" size={22} color={showKeyboard ? colors.primary : colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
});

export default ScanField;
