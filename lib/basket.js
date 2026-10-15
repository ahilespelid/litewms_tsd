import { useRef, useState } from 'react';

// Корзина сканов для ячеистого хранения (Размещение: Положить/Забрать, Перемещение).
// Порт useScanBasket.vue. Оператор сначала набирает ТОВАРЫ (тот же ШК = +1, другой
// ШК = новая строка сверху), потом одной пачкой кладёт/забирает против ВЫБРАННОЙ
// ячейки — поэтому «сколько можно» проверяется на отправке, а не тут.
//
// Источник правды — useRef (мутируем строки на месте, как во Vue, чтобы синхронно
// вернуть строку для озвучки счёта); useState служит триггером ререндера.
function normalize(p, places, max) {
  return {
    product_id: p.product_id ?? p.id ?? null,
    product_name: p.product_name || p.name || '',
    article: p.article || p.offer_id || '',
    photo_url: p.photo_url || p.image_url || p.image || p.primary_image || '',
    barcode: p.barcode || '',
    places: places || p.places || [],
    qty: 1,
    max: max != null ? Number(max) : null, // потолок для Забрать/Переместить; null = без потолка
    err: '',
  };
}

export function useScanBasket() {
  const ref = useRef([]);
  const [, force] = useState(0);
  const sync = () => force((n) => (n + 1) % 1e9);

  const line = (id) => ref.current.find((l) => l.product_id === id) || null;

  function addProduct(p, places, max) {
    const id = p.product_id ?? p.id ?? null;
    const found = id != null ? line(id) : null;
    if (found) {
      if (max != null) found.max = Number(max);
      const next = Number(found.qty || 0) + 1;
      if (found.max == null || next <= found.max) found.qty = next;
      found.err = '';
      if (places) found.places = places;
      sync();
      return { line: found, incremented: true };
    }
    const l = normalize(p, places, max);
    ref.current = [l, ...ref.current]; // новый товар — СВЕРХУ, на виду
    sync();
    return { line: l, incremented: false };
  }

  function inc(id) { const l = line(id); if (l) { const n = Number(l.qty || 0) + 1; if (l.max == null || n <= l.max) { l.qty = n; l.err = ''; sync(); } } }
  function dec(id) { const l = line(id); if (l && Number(l.qty) > 1) { l.qty = Number(l.qty) - 1; sync(); } }
  function setQty(id, n) { const l = line(id); if (l) { let v = Math.max(1, Math.floor(Number(n) || 1)); if (l.max != null) v = Math.min(v, l.max); l.qty = v; sync(); } }
  function remove(id) { ref.current = ref.current.filter((l) => l.product_id !== id); sync(); }
  function clear() { ref.current = []; sync(); }
  function clearErrors() { ref.current.forEach((l) => { l.err = ''; }); sync(); }

  const lines = ref.current;
  const count = lines.length;
  const totalUnits = lines.reduce((s, l) => s + Number(l.qty || 0), 0);
  const hasErrors = lines.some((l) => l.err);

  return { lines, addProduct, line, inc, dec, setQty, remove, clear, clearErrors, count, totalUnits, hasErrors };
}
