// Дизайн-токены ТСД — ТОЧНО по premium.css старого (Vue) ТСД v99, чтобы RN-версия
// выглядела как привычное приложение. Значения перенесены 1:1 из src/assets/premium.css.

export const colors = {
  // Бренд (бирюзовый) — шапки/кнопки/активные элементы
  brand: '#006666',        // = --primary-color (низ градиента шапки; используем сплошным)
  brandTop: '#00807f',     // = --primary-hover (верх градиента — на будущее)
  primary: '#006666',
  primaryHover: '#00807f',
  primaryDeep: '#004d4d',
  primaryLight: '#e6f5f5', // мягкий фон под акцент (чипы «ячейка», счётчики)

  // Акцент в RN был отдельной бирюзой; в v99 акценты — тот же бренд. Держим hover-тон.
  accent: '#00807f',

  // Поверхности и фон
  bg: '#eef2f4',           // = --bg (прохладный серо-голубой, НЕ кремовый)
  surface: '#ffffff',
  surfaceSunken: '#eef2f4',

  // Текст
  ink: '#0f2b2b',          // = --ink
  muted: '#5b6b73',        // = --ink-2
  ink3: '#94a3ab',         // = --ink-3

  // Линии
  border: '#e5ebee',       // = --line
  borderStrong: '#d3dde0', // = --line-strong

  // Семантика (ровно как premium.css)
  success: '#059669',
  successBg: '#ecfdf5',
  successLine: '#a7f3d0',
  danger: '#dc2626',
  dangerBg: '#fef2f2',
  dangerLine: '#fecaca',
  warning: '#b45309',
  warnBg: '#fffbeb',
  // ЧЗ/маркировка — фиолетовая ветка (в v99 метки ЧЗ фиолетовые, не бирюзовые)
  cz: '#7c3aed',
  czBg: '#f3e8ff',
  czLine: '#d8b4fe',

  // Поверх тёмно-бирюзовой шапки
  onDark: '#ffffff',       // = --on-primary
  onDarkMuted: '#bfe0df',  // светло-бирюзовый для подзаголовков на шапке
};

// Радиусы — по premium.css (--r-sm 10, --r 12, --r-lg 14, --r-xl 18, --r-2xl 22)
export const radius = { sm: 10, md: 12, lg: 14, xl: 18, xxl: 22, pill: 999 };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 };

// Типографика. В premium.css системный стек (-apple-system … 'Inter', Roboto).
// Golos Text — того же гуманистического семейства, что Inter/Roboto; оставляем его
// (уже загружен, корректно рисует жир). Моно (Martian Mono) — только мелкие ярлыки.
export const font = {
  regular: 'GolosText_400Regular',
  medium: 'GolosText_500Medium',
  semibold: 'GolosText_600SemiBold',
  bold: 'GolosText_700Bold',
  mono: 'MartianMono_500Medium',
};

// Тени — мягкие, многослойные (= --shadow, оттенок rgba(15,43,43,…))
export const shadow = {
  card: {
    shadowColor: '#0f2b2b',
    shadowOpacity: 0.07,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
};
