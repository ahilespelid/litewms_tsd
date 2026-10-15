import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Brand from '../components/Brand';
import Field from '../components/Field';
import PrimaryButton from '../components/PrimaryButton';
import { colors, font, radius } from '../theme';

// Экран авторизации в стиле litebox: тёмно-зелёный «герой» сверху + форма.
export default function Login() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);

  const enter = () => router.replace('/home');

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.bg }}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        {/* Тёмно-зелёный герой с мотивом складских кубов */}
        <View
          style={{
            backgroundColor: colors.brand,
            paddingTop: insets.top + 40,
            paddingBottom: 44,
            paddingHorizontal: 24,
            borderBottomLeftRadius: 28,
            borderBottomRightRadius: 28,
            overflow: 'hidden',
          }}
        >
          <View style={{ position: 'absolute', right: -40, top: 10, opacity: 0.1 }}>
            <Ionicons name="cube-outline" size={230} color={colors.accent} />
          </View>
          <Brand size={40} />
          <Text
            style={{
              fontFamily: font.regular,
              color: colors.onDarkMuted,
              fontSize: 14,
              marginTop: 20,
              lineHeight: 20,
            }}
          >
            Управление фулфилментом{'\n'}нового поколения
          </Text>
        </View>

        {/* Форма входа */}
        <View style={{ padding: 24 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 24, color: colors.ink, marginBottom: 20 }}>
            Авторизация
          </Text>

          <Field
            label="E-mail"
            value={email}
            onChangeText={setEmail}
            placeholder="Введите ваш email"
            keyboardType="email-address"
          />

          <Field
            label="Пароль"
            value={pass}
            onChangeText={setPass}
            placeholder="Введите пароль"
            secureTextEntry={!show}
            right={
              <Pressable onPress={() => setShow((s) => !s)} hitSlop={10}>
                <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.muted} />
              </Pressable>
            }
          />

          <PrimaryButton title="Войти" onPress={enter} style={{ marginTop: 4 }} />

          <Pressable onPress={enter} style={{ marginTop: 18, alignItems: 'center' }}>
            <Text style={{ fontFamily: font.medium, color: colors.muted, fontSize: 13 }}>
              Войти без входа · демо-полотно
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
