import { View, Text, Pressable } from 'react-native';
import { colors, font } from '../theme';

// Переключатель маркетплейса WB/Ozon/Яндекс — тёмные пилюли в капсуле внутри
// бирюзовой шапки ФБС (как .market в premium.css v99). Активная — белая/бирюзовая.
export default function MarketPills({ market, onMarket }) {
  const items = [['wb', 'WB'], ['ozon', 'Ozon'], ['yandex', 'Я']];
  return (
    <View style={{ flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 999, padding: 3 }}>
      {items.map(([m, l]) => {
        const on = m === market;
        return (
          <Pressable key={m} onPress={() => !on && onMarket && onMarket(m)} style={{ paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: on ? '#fff' : 'transparent' }}>
            <Text style={{ fontFamily: font.bold, fontSize: 11, color: on ? colors.primary : 'rgba(255,255,255,0.82)' }}>{l}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
