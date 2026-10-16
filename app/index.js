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
import { lookupTenantsByEmail, loginToTenant } from '../lib/auth';
import { colors, font, radius, shadow } from '../theme';

// Экран входа: почта/пароль → поиск складов → /api/login. Если складов несколько —
// выбор. Демо-вход (без токена) оставлен для просмотра интерфейса без сервера.
export default function Login() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [matches, setMatches] = useState([]); // [{ id, name, slug, domain }]

  const doLogin = async () => {
    setError('');
    const mail = email.trim().toLowerCase();
    if (!mail || !pass) { setError('Введите почту и пароль'); return; }
    setLoading(true);
    setMatches([]);
    try {
      const info = await lookupTenantsByEmail(mail);
      const found = info?.tenants || [];
      if (!info?.found || !found.length) { setError('Пользователь с такой почтой не найден'); return; }
      if (found.length === 1) {
        await loginToTenant(found[0], mail, pass);
        router.replace('/home');
        return;
      }
      setMatches(found);
    } catch (e) {
      setError(e?.message || 'Нет связи с сервером');
    } finally {
      setLoading(false);
    }
  };

  const enterTenant = async (tenant) => {
    setError('');
    setLoading(true);
    try {
      await loginToTenant(tenant, email.trim().toLowerCase(), pass);
      router.replace('/home');
    } catch (e) {
      setError(e?.message || 'Не удалось войти');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.bg }}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        {/* Тёмно-зелёный герой */}
        <View
          style={{
            backgroundColor: colors.brand,
            paddingTop: insets.top + 40,
            paddingBottom: 44,
            paddingHorizontal: 24,
            overflow: 'hidden',
          }}
        >
          <View style={{ position: 'absolute', right: -40, top: 10, opacity: 0.1 }}>
            <Ionicons name="cube-outline" size={230} color={colors.accent} />
          </View>
          <Brand size={40} />
          <Text style={{ fontFamily: font.regular, color: colors.onDarkMuted, fontSize: 14, marginTop: 20, lineHeight: 20 }}>
            Управление фулфилментом{'\n'}нового поколения
          </Text>
        </View>

        <View style={{ padding: 24 }}>
          {matches.length ? (
            <>
              <Text style={{ fontFamily: font.bold, fontSize: 22, color: colors.ink, marginBottom: 6 }}>Выберите склад</Text>
              <Text style={{ fontFamily: font.regular, fontSize: 13, color: colors.muted, marginBottom: 16 }}>
                Ваша почта есть на нескольких складах
              </Text>
              {matches.map((m) => (
                <Pressable
                  key={m.domain}
                  disabled={loading}
                  onPress={() => enterTenant(m)}
                  style={[{ backgroundColor: colors.surface, borderRadius: radius.md, padding: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }, shadow.card]}
                >
                  <Ionicons name="business-outline" size={22} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: font.semibold, fontSize: 15, color: colors.ink }}>{m.name || m.slug}</Text>
                    <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.muted }}>{m.domain}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.muted} />
                </Pressable>
              ))}
              <Pressable onPress={() => setMatches([])} style={{ marginTop: 8, alignItems: 'center' }}>
                <Text style={{ fontFamily: font.medium, color: colors.muted, fontSize: 13 }}>← Назад</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={{ fontFamily: font.bold, fontSize: 24, color: colors.ink, marginBottom: 20 }}>Авторизация</Text>

              <Field label="E-mail" value={email} onChangeText={setEmail} placeholder="Введите ваш email" keyboardType="email-address" />
              <Field
                label="Пароль"
                value={pass}
                onChangeText={setPass}
                placeholder="Введите пароль"
                secureTextEntry={!show}
                onSubmitEditing={doLogin}
                returnKeyType="go"
                right={
                  <Pressable onPress={() => setShow((s) => !s)} hitSlop={10}>
                    <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.muted} />
                  </Pressable>
                }
              />

              {error ? (
                <Text style={{ fontFamily: font.medium, color: colors.danger, fontSize: 13, marginBottom: 12 }}>{error}</Text>
              ) : null}

              <PrimaryButton title="Войти" onPress={doLogin} loading={loading} style={{ marginTop: 4 }} />

              <Pressable onPress={() => router.replace('/home')} style={{ marginTop: 18, alignItems: 'center' }}>
                <Text style={{ fontFamily: font.medium, color: colors.muted, fontSize: 13 }}>
                  Войти без входа · просмотр интерфейса
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
