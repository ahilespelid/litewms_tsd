// Цена сборки одной единицы по правилам клиента (порт pricing.js).
// GET /api/lightfin/fbs-control/categories?company_id=N: client_rule (на клиента),
// product_rules (на товар). Приоритет: товар → клиент. Категорию ТСД не знает.
import { api } from './api';

const cache = new Map(); // company_id -> info
const productKey = (article) => String(article || '').trim().toLowerCase();

export async function loadPricing(companyId) {
  if (!companyId) return null;
  if (cache.has(companyId)) return cache.get(companyId);
  try {
    const res = await api(`/api/lightfin/fbs-control/categories?company_id=${companyId}`);
    if (!res.ok) return null;
    const data = await res.json();
    const byProduct = new Map();
    for (const rule of data?.product_rules || []) {
      const key = productKey(rule.product_key);
      if (key) byProduct.set(key, Number(rule.price) || 0);
    }
    const info = {
      client: data?.client_rule ? Number(data.client_rule.price) || 0 : null,
      byProduct,
      hasCategoryRules: (data?.categories || []).some((c) => c.rule),
    };
    cache.set(companyId, info);
    return info;
  } catch (_) { return null; }
}

export function priceForItem(info, article) {
  if (!info) return null;
  const byProduct = info.byProduct.get(productKey(article));
  if (byProduct != null) return byProduct;
  return info.client;
}
