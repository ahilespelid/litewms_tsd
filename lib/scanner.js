// Приём кодов от железного сканера ТСД в RN.
//
// Сканер в режиме «клавиатура» (Newland Output Mode = Simulate keystroke)
// печатает код в сфокусированный TextInput и жмёт Enter (суффикс 0D). Поэтому в
// RN поле скана — это обычный TextInput с:
//   showSoftInputOnFocus={false}  — фокус БЕЗ системной клавиатуры (аналог
//                                   inputmode="none" в веб-версии);
//   blurOnSubmit={false}          — не терять фокус после Enter;
//   onSubmitEditing               — срабатывает на Enter от сканера.
// Компонент <ScanField> (components/ScanField.js) это уже инкапсулирует.
//
// Дедуп двойного скана: часть ТСД отдаёт один физический скан дважды
// (broadcast + клавиатура). Одинаковый код в пределах короткого окна — повтор.
import { useRef, useCallback } from 'react';

export function useScanDedup(windowMs = 250) {
  const last = useRef({ code: '', at: 0 });
  return useCallback((code) => {
    const now = Date.now();
    if (code && code === last.current.code && now - last.current.at < windowMs) return true;
    last.current = { code, at: now };
    return false;
  }, [windowMs]);
}
