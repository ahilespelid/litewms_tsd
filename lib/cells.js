// Адрес ячейки голосом/текстом (RN-версия formatCellSpeech из fbsSettings.js)
// + озвучка через expo-speech. Код ячейки = стеллаж-ряд-полка-ячейка.
import * as Speech from 'expo-speech';
import { lsGet, lsSet } from './storage';

export const CELL_VOICE_MODES = [
  { id: 'full', label: 'Полностью (с полкой)' },
  { id: 'short', label: 'Стеллаж, ряд, ячейка' },
  { id: 'rackcell', label: 'Стеллаж и ячейка' },
  { id: 'rack', label: 'Только стеллаж' },
];
const VOICE_MODE_KEY = 'tsd.cellVoiceMode';
let voiceMode = 'short';
export async function initCellVoiceMode() {
  const v = await lsGet(VOICE_MODE_KEY);
  if (CELL_VOICE_MODES.some((m) => m.id === v)) voiceMode = v;
}
export const getCellVoiceMode = () => voiceMode;
export function setCellVoiceMode(id) {
  if (!CELL_VOICE_MODES.some((m) => m.id === id)) return;
  voiceMode = id;
  lsSet(VOICE_MODE_KEY, id);
}

export function formatCellSpeech(code, mode = voiceMode) {
  const parts = String(code || '').split('-').map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return String(code || '');
  const rack = parts[0];
  const nums = parts.slice(1);
  if (mode === 'rack' || !nums.length) return `Стеллаж ${rack}`;
  const row = nums[0];
  const cell = nums[nums.length - 1];
  if (nums.length === 1 || mode === 'rackcell') return `Стеллаж ${rack}, ячейка ${cell}`;
  if (mode === 'full') {
    const shelf = nums.slice(1, -1);
    const shelfPart = shelf.length ? `полка ${shelf.join(' ')}, ` : '';
    return `Стеллаж ${rack}, ряд ${row}, ${shelfPart}ячейка ${cell}`;
  }
  return `Стеллаж ${rack}, ряд ${row}, ячейка ${cell}`;
}

// Озвучка (системный TTS Android через expo-speech). Новая фраза обрывает старую.
export function speak(text) {
  try {
    Speech.stop();
    Speech.speak(String(text || ''), { language: 'ru-RU' });
  } catch (_) {}
}
