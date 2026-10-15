// Хранение входа и локальных настроек (RN-версия tsd.<key> из Vue-приложения).
// В вебе был localStorage + Capacitor Preferences; в RN — AsyncStorage.
// Держим синхронный кэш в памяти: грузим один раз на старте (initStorage),
// дальше читаем из кэша (синхронно), пишем и в кэш, и в AsyncStorage.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = ['domain', 'tenantName', 'token', 'email'];
const cache = { domain: '', tenantName: '', token: '', email: '' };
let loaded = false;

export async function initStorage() {
  try {
    const pairs = await AsyncStorage.multiGet(KEYS.map((k) => 'tsd.' + k));
    for (const [k, v] of pairs) cache[k.replace('tsd.', '')] = v || '';
  } catch (_) {}
  loaded = true;
}
export const isStorageLoaded = () => loaded;

function write(key, value) {
  cache[key] = value || '';
  try {
    if (value) AsyncStorage.setItem('tsd.' + key, value);
    else AsyncStorage.removeItem('tsd.' + key);
  } catch (_) {}
}

// У склада хранится полный домен (litebox.litewms.ru либо свой вроде skiniya.ru).
export const getDomain = () => cache.domain || 'litebox.litewms.ru';
export const setDomain = (v) => write('domain', v);
export const getTenantName = () => cache.tenantName;
export const setTenantName = (v) => write('tenantName', v);
export const getToken = () => cache.token;
export const setToken = (v) => write('token', v);
export const clearToken = () => write('token', '');
export const getEmail = () => cache.email;
export const setEmail = (v) => write('email', v);

// ФИО вошедшего — только в памяти (как в вебе), тянется из /api/me при входе в меню.
let userName = '';
export const getUserName = () => userName;
export const setUserName = (v) => { userName = String(v || '').trim(); };

// Обёртки для прочих ключей (тумблеры, otborTaken и т.п.) — асинхронные.
export async function lsGet(key) { try { return await AsyncStorage.getItem(key); } catch (_) { return null; } }
export async function lsSet(key, val) { try { await AsyncStorage.setItem(key, String(val)); } catch (_) {} }
export async function lsRemove(key) { try { await AsyncStorage.removeItem(key); } catch (_) {} }
