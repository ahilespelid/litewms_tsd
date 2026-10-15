// Модули ТСД (как в текущем Vue-приложении LiteWMS).
// icon — имя из MaterialCommunityIcons (@expo/vector-icons).
import { colors } from '../theme';

export const modules = [
  { key: 'priemka', title: 'Приёмка', subtitle: 'Приём по заявке', icon: 'archive-arrow-down-outline', color: colors.primary },
  { key: 'placement', title: 'Размещение', subtitle: 'Разложить по ячейкам', icon: 'dolly', color: colors.accent },
  { key: 'otbor', title: 'Отбор', subtitle: 'Снятие с ячеек', icon: 'clipboard-list-outline', color: colors.primary },
  { key: 'inventory', title: 'Инвентаризация', subtitle: 'Пересчёт остатков', icon: 'counter', color: colors.accent },
  { key: 'fbs', title: 'ФБС', subtitle: 'WB · Ozon · Яндекс', icon: 'truck-fast-outline', color: colors.primary },
  { key: 'requests', title: 'Заявки', subtitle: 'Распределение и отбор', icon: 'file-tree-outline', color: colors.accent },
  { key: 'where', title: 'Где лежит', subtitle: 'Поиск по ячейкам', icon: 'map-marker-radius-outline', color: colors.primary },
  { key: 'print', title: 'Печать', subtitle: 'Этикетки и стикеры', icon: 'printer-outline', color: colors.accent },
];
