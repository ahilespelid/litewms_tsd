// Дизайн-токены в стиле litebox.new.litewms.ru
// Цвета сняты прямо с боевого интерфейса (login-экран LiteBox).

export const colors = {
  brand: '#072D29', // тёмно-зелёный бренд: шапки, панель логина, сплэш
  primary: '#0D4F49', // основной зелёный: кнопки, активные элементы
  accent: '#20B29B', // бирюза: акценты, выделения, «живые» статусы
  bg: '#F2F1EA', // кремовый фон приложения
  surface: '#FFFFFF', // карточки, поля
  ink: '#13241F', // основной текст
  muted: '#6B7B76', // вторичный текст, подписи
  border: '#E4E2DA', // тонкие границы на креме
  success: '#20B29B',
  danger: '#C0492F', // брак/ошибки
  warning: '#D98A28',
  onDark: '#EAF3F0', // текст поверх тёмно-зелёного
  onDarkMuted: '#8FB3AB',
};

export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

// Имена шрифтов = ключи из @expo-google-fonts (их отдаёт useFonts).
export const font = {
  regular: 'GolosText_400Regular',
  medium: 'GolosText_500Medium',
  semibold: 'GolosText_600SemiBold',
  bold: 'GolosText_700Bold',
  mono: 'MartianMono_500Medium',
};

// Мягкая тень карточки (iOS: shadow*, Android: elevation).
export const shadow = {
  card: {
    shadowColor: '#0B2B25',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
};
