// Настройки ФБС-сборки (порт из fbsSettings.vue). В вебе были reactive-ref +
// localStorage; в RN держим значения в памяти (загружаем на старте initFbsSettings)
// и читаем геттерами в момент скана — ровно как логика сборки читала .value.
// Экран «Настройки» пока не портирован; значения по умолчанию = как на проде.
import { lsGet, lsSet } from './storage';

const VERIFY_KEY = 'tsd.fbsVerifySticker';     // пара ШК+стикер со сверкой; по умолч. ВКЛ ('0' = выкл)
const SPEAK_CELL_KEY = 'tsd.fbsSpeakCellSborka'; // проговаривать стеллаж на сборке; по умолч. ВКЛ
const TAKE_KEY = 'tsd.fbsTakeFromCell';        // снимать с ячейки при пике; по умолч. ВЫКЛ ('1' = вкл)

let verifySticker = true;
let speakCellSborka = true;
let takeFromCell = false;

export async function initFbsSettings() {
  try {
    const [v, s, t] = await Promise.all([lsGet(VERIFY_KEY), lsGet(SPEAK_CELL_KEY), lsGet(TAKE_KEY)]);
    if (v != null) verifySticker = v !== '0';
    if (s != null) speakCellSborka = s !== '0';
    if (t != null) takeFromCell = t === '1';
  } catch (_) {}
}

export const getVerifySticker = () => verifySticker;
export const getSpeakCellSborka = () => speakCellSborka;
export const getTakeFromCell = () => takeFromCell;

export function setVerifySticker(on) { verifySticker = !!on; lsSet(VERIFY_KEY, on ? '1' : '0'); }
export function setSpeakCellSborka(on) { speakCellSborka = !!on; lsSet(SPEAK_CELL_KEY, on ? '1' : '0'); }
export function setTakeFromCell(on) { takeFromCell = !!on; lsSet(TAKE_KEY, on ? '1' : '0'); }
