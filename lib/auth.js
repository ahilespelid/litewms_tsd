// Вход в LiteWMS (RN-версия логики SignIn.vue + tenants.js).
// Шаг 1: по почте узнаём склады (центральный реестр на litebox.litewms.ru).
// Шаг 2: POST /api/login на домен склада → токен.
import { apiBase, fetchWithTimeout } from './api';
import { setDomain, setTenantName, setEmail, setToken, clearToken } from './storage';

// Поиск складов по почте — ВСЕГДА на центральном домене litebox.litewms.ru.
// Ответ: { found, tenants: [{ id, name, slug, domain }] }.
export async function lookupTenantsByEmail(email) {
  try {
    const res = await fetchWithTimeout(
      `${apiBase('litebox.litewms.ru')}/api/mobile/tenant-info?email=${encodeURIComponent(email)}`,
      { headers: { 'x-tsd-domain': 'litebox.litewms.ru' } },
      20000,
    );
    if (!res.ok) return { found: false, tenants: [] };
    return await res.json().catch(() => ({ found: false, tenants: [] }));
  } catch (_) {
    return { found: false, tenants: [] };
  }
}

// Вход в конкретный склад — тот же /api/login, что у сайта.
export async function loginToTenant(tenant, email, password) {
  const res = await fetchWithTimeout(`${apiBase(tenant.domain)}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-tsd-domain': tenant.domain },
    body: JSON.stringify({ email: email.trim().toLowerCase(), password, remember: true }),
  }, 20000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.message || 'Неверный пароль');
  const token = data.access_token || data.token;
  if (!token) throw new Error('Сервер не вернул токен');
  setDomain(tenant.domain);
  setTenantName(tenant.name || tenant.slug || '');
  setEmail(email.trim().toLowerCase());
  setToken(token);
  return token;
}

export function logout() {
  clearToken();
}
