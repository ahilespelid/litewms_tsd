import { View, Text, Pressable, Image } from 'react-native';
import { colors, font, radius } from '../theme';

// Список корзины сканов (Размещение: Положить/Забрать). Порт BasketList.vue.
// editable — степпер «− N +» и удаление; иначе (фаза «ячейка») только «×N».
// showPlaces — где товар лежит (подсказка ячейки-источника для «Забрать»).
// Тап по числу = ввод (onEdit); удержание (есть потолок max) = проставить всё (onFill).
function shortName(name, words = 3) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= words) return parts.join(' ');
  return parts.slice(0, words).join(' ') + '…';
}
const shkTail = (c) => String(c || '').slice(-4);
const placesStr = (l) =>
  (l?.places || []).filter((p) => Number(p.quantity) > 0).map((p) => `${p.code} ×${p.quantity}`).join(', ');

export default function BasketList({ lines = [], editable = true, showPlaces = false, onInc, onDec, onRemove, onEdit, onFill, onPhoto }) {
  return (
    <View style={{ gap: 8 }}>
      {lines.map((l) => (
        <View
          key={l.product_id}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: l.err ? colors.danger : colors.border,
            borderRadius: radius.lg,
            padding: 10,
          }}
        >
          {l.photo_url ? (
            <Pressable onPress={() => onPhoto && onPhoto(l)}>
              <Image source={{ uri: l.photo_url }} style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: colors.bg }} />
            </Pressable>
          ) : null}

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: font.semibold, fontSize: 14, color: colors.ink }} numberOfLines={1}>
              {shortName(l.product_name) || '—'}
            </Text>
            {l.barcode ? (
              <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.muted }}>
                ШК …<Text style={{ fontFamily: font.bold, color: colors.ink }}>{shkTail(l.barcode)}</Text>
              </Text>
            ) : null}
            {showPlaces ? (
              placesStr(l) ? (
                <Text style={{ fontFamily: font.regular, fontSize: 11, color: colors.muted }} numberOfLines={2}>лежит: {placesStr(l)}</Text>
              ) : (
                <Text style={{ fontFamily: font.medium, fontSize: 11, color: colors.warning }}>нигде не размещён</Text>
              )
            ) : null}
            {l.err ? <Text style={{ fontFamily: font.semibold, fontSize: 11, color: colors.danger }}>{l.err}</Text> : null}
          </View>

          {editable ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <StepBtn label="−" disabled={Number(l.qty) <= 1} onPress={() => onDec && onDec(l.product_id)} />
              <Pressable
                onPress={() => onEdit && onEdit(l.product_id)}
                onLongPress={() => l.max != null && onFill && onFill(l.product_id)}
                delayLongPress={1000}
                style={{ minWidth: 46, paddingHorizontal: 8, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primaryLight, alignItems: 'center' }}
              >
                <Text style={{ fontFamily: font.bold, fontSize: 18, color: colors.primary }}>
                  {l.qty}
                  {l.max != null ? <Text style={{ fontFamily: font.medium, fontSize: 12, color: colors.muted }}>/{l.max}</Text> : null}
                </Text>
              </Pressable>
              <StepBtn label="+" disabled={l.max != null && Number(l.qty) >= l.max} onPress={() => onInc && onInc(l.product_id)} />
              <Pressable onPress={() => onRemove && onRemove(l.product_id)} hitSlop={6} style={{ width: 32, height: 36, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: font.bold, fontSize: 16, color: colors.muted }}>✕</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={{ fontFamily: font.bold, fontSize: 18, color: colors.primary }}>×{l.qty}</Text>
          )}
        </View>
      ))}
    </View>
  );
}

function StepBtn({ label, disabled, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{ width: 38, height: 38, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1 }}
    >
      <Text style={{ fontFamily: font.bold, fontSize: 20, color: colors.primary }}>{label}</Text>
    </Pressable>
  );
}
