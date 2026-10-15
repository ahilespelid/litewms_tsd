// Печать этикеток по Bluetooth. В вебе это Web Bluetooth (navigator.bluetooth),
// которого в React Native НЕТ: нужен нативный BLE-модуль (react-native-ble-plx)
// и собственный dev-build — в Expo Go печать недоступна. Здесь — безопасная
// заглушка: кнопки печати в ФБС сообщат «принтер не выбран», сборка/ЧЗ работают.
// TODO(dev-build): заменить на react-native-ble-plx + TSPL, перенести tspl*-генераторы.
export function getSavedPrinter() { return null; }
export function savePrinter() {}
export async function listPairedPrinters() { return []; }
export async function printLabel() { throw new Error('печать доступна только в dev-build (не в Expo Go)'); }
export function tsplCodeLabel() { return new Uint8Array(); }
export async function tsplImageLabel() { return new Uint8Array(); }
