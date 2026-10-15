#!/usr/bin/env bash
# =============================================================================
#  LiteWMS ТСД — АВТО-ДЕПЛОЙ master (UserLAnd). Одна команда на всё:
#
#     bash deploy.sh          # подтянуть master + зависимости + поднять Metro,
#                             # и ДАЛЬШЕ сам подтягивать новые пуши (hot reload)
#     bash deploy.sh --once   # то же, но разово (без авто-подтягивания)
#
#  Смысл: ты запускаешь ОДИН раз. Когда код обновляется (пуш в master из чата),
#  скрипт сам подтягивает изменения, а Expo/Metro делает hot reload на телефоне —
#  руками ничего печатать не нужно.
#
#  ВАЖНО: эта копия — ТОЛЬКО ДЛЯ ПРОСМОТРА. Правки кода идут через чат → git push,
#  сюда они прилетают сами. Локальные правки в этой папке держать не нужно
#  (если они есть — авто-обновление их не тронет и просто пропустит шаг).
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")"

# nvm / Node 20 (как в dev.sh)
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
if [ -s "$NVM_DIR/nvm.sh" ]; then . "$NVM_DIR/nvm.sh"; nvm use 20 >/dev/null 2>&1 || true; fi

note() { printf '\033[1;32m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m[!]\033[0m  %s\n' "$1"; }

# Подтянуть master (копия только для просмотра → ровняем по origin/master).
sync_master() {
  git fetch origin master -q 2>/dev/null || { warn "нет сети — работаю на текущей версии"; return; }
  if [ -n "$(git status --porcelain)" ]; then
    warn "в копии есть локальные правки — авто-обновление пропущено (правь через чат)"; return
  fi
  local before after
  before=$(git rev-parse HEAD)
  git reset --hard origin/master -q
  after=$(git rev-parse HEAD)
  if [ "$before" != "$after" ]; then
    note "обновлено до: $(git log --oneline -1)"
    if git diff --name-only "$before" "$after" | grep -qE 'package(-lock)?\.json'; then
      note "менялись зависимости — npm install…"; npm install
    fi
  else
    note "уже актуально"
  fi
}

note "Подтягиваю master…"
sync_master
[ -d node_modules ] || { note "ставлю зависимости…"; npm install; }

# Фоновый авто-пулл: новые пуши прилетают сами, Metro делает hot reload.
if [ "${1:-}" != "--once" ]; then
  note "Авто-деплой ВКЛючён: новые пуши в master подтягиваются сами (hot reload на телефоне)."
  (
    while true; do
      sleep 20
      git fetch origin master -q 2>/dev/null || continue
      [ -n "$(git status --porcelain)" ] && continue
      if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/master 2>/dev/null)" ]; then
        printf '\n\033[1;36m⟳ новый master — подтягиваю…\033[0m\n'
        b=$(git rev-parse HEAD)
        git reset --hard origin/master -q
        note "обновлено: $(git log --oneline -1)"
        if git diff --name-only "$b" HEAD | grep -qE 'package(-lock)?\.json'; then
          warn "менялись зависимости — перезапусти deploy.sh (Ctrl+C и снова), чтобы доустановить"
        fi
      fi
    done
  ) &
  WATCH_PID=$!
  trap 'kill "$WATCH_PID" 2>/dev/null || true' EXIT INT TERM
fi

note "Metro поднимается. В Expo Go: Enter URL manually → exp://127.0.0.1:8081   (стоп — Ctrl+C)"
npx expo start --localhost
