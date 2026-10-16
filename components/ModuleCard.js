import { Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { colors, font, radius, shadow } from '../theme';

// Строка модуля на рабочем столе (как .menu-btn в v99): полноширинная карточка,
// слева иконка 44×44 в бирюзовой плашке, в центре заголовок+подпись, справа ›.
export default function ModuleCard({ item, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          padding: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
        shadow.card,
      ]}
    >
      <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' }}>
        <MaterialCommunityIcons name={item.icon} size={24} color={colors.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: font.semibold, fontSize: 16, color: colors.ink }}>{item.title}</Text>
        <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.muted, marginTop: 2 }} numberOfLines={1}>{item.subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.ink3} />
    </Pressable>
  );
}
