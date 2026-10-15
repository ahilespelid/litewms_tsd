// Общение с сервером LiteWMS (RN-версия src/api.js).
// В RN нет браузерного CORS и нет vite-моста — ходим на https://<домен> напрямую.
// Ко всем запросам прикладываем Bearer-токен и заголовок x-tsd-domain.
import { getDomain, getToken } from './storage';

export function apiBase(domain = getDomain()) {
  return `https://${domain}`;
}

// Таймаут гонкой с fetch: плохой складской Wi-Fi не должен вешать экран вечным
// спиннером. По истечении времени промис отклоняется (ошибка с флагом timeout).
export function fetchWithTimeout(input, options = {}, ms = 60000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error('Превышено время ожидания сети');
      e.timeout = true;
      reject(e);
    }, ms);
  });
  return Promise.race([fetch(input, options), timeout]).finally(() => clearTimeout(timer));
}

export function api(path, options = {}) {
  const { timeoutMs = 60000, ...opts } = options;
  const headers = {
    'Content-Type': 'application/json',
    'x-tsd-domain': getDomain(),
    ...(opts.headers || {}),
  };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetchWithTimeout(apiBase() + path, { ...opts, headers }, timeoutMs);
}

// Права пользователя — тот же список разделов, по которому сайт строит меню.
export async function loadPermissions() {
  try {
    const res = await api('/api/user/permissions');
    if (!res.ok) return [];
    const data = await res.json();
    const list = Array.isArray(data) ? data : data.permissions;
    return Array.isArray(list) ? list.map(String) : [];
  } catch (_) {
    return [];
  }
}
