import { Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, font, radius, shadow } from '../theme';

// Карточка модуля на рабочем столе: иконка в цветной плашке + заголовок.
export default function ModuleCard({ item, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          flex: 1,
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          padding: 16,
          minHeight: 122,
          justifyContent: 'space-between',
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        shadow.card,
      ]}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          backgroundColor: item.color + '18',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MaterialCommunityIcons name={item.icon} size={24} color={item.color} />
      </View>
      <View>
        <Text style={{ fontFamily: font.semibold, fontSize: 16, color: colors.ink }}>{item.title}</Text>
        <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.muted, marginTop: 2 }}>{item.subtitle}</Text>
      </View>
    </Pressable>
  );
}
