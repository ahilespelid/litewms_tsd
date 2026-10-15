#!/usr/bin/env bash
# =============================================================================
#  LiteWMS ТСД — установка dev-окружения на Android через UserLAnd
# -----------------------------------------------------------------------------
#  Что делает: ставит Node 20 (через nvm), клонирует/обновляет репозиторий,
#  ставит зависимости (npm install). Можно запускать повторно — безопасно.
#
#  Запуск:
#     bash dev.sh              # собрать окружение
#     bash dev.sh start        # собрать окружение и сразу поднять dev-сервер
# =============================================================================
set -euo pipefail

REPO_URL="https://github.com/ahilespelid/litewms_tsd.git"
PROJECT_DIR="$HOME/litewms_tsd"
NODE_VERSION="20"
NVM_VERSION="v0.40.1"

log()  { printf '\n\033[1;32m==>\033[0m %s\n' "$1"; }
warn() { printf '\n\033[1;33m[!]\033[0m  %s\n' "$1"; }
die()  { printf '\n\033[1;31m[x]\033[0m  %s\n' "$1" >&2; exit 1; }

# -----------------------------------------------------------------------------
# 1. Базовые пакеты (git, curl). Нужен интерактивный sudo — поэтому скрипт
#    запускаем из файла, а не через `curl | bash`.
# -----------------------------------------------------------------------------
log "Проверяю git и curl..."
need_pkgs=()
command -v git  >/dev/null 2>&1 || need_pkgs+=(git)
command -v curl >/dev/null 2>&1 || need_pkgs+=(curl)
if [ "${#need_pkgs[@]}" -gt 0 ]; then
  if command -v apt-get >/dev/null 2>&1; then
    log "Ставлю: ${need_pkgs[*]} (может спросить пароль sudo)"
    sudo apt-get update -y
    sudo apt-get install -y ca-certificates "${need_pkgs[@]}"
  else
    die "Нет apt-get и нет ${need_pkgs[*]}. Поставь их вручную и запусти скрипт снова."
  fi
fi

# -----------------------------------------------------------------------------
# 2. nvm (менеджер версий Node)
# -----------------------------------------------------------------------------
export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  log "Ставлю nvm ${NVM_VERSION}..."
  curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" | bash
fi
# подгружаем nvm в текущую сессию скрипта
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"

# -----------------------------------------------------------------------------
# 3. Node 20 (Expo SDK 57 требует Node 20+)
# -----------------------------------------------------------------------------
if ! nvm ls "$NODE_VERSION" >/dev/null 2>&1; then
  log "Ставлю Node ${NODE_VERSION}..."
  nvm install "$NODE_VERSION"
fi
nvm use "$NODE_VERSION" >/dev/null
nvm alias default "$NODE_VERSION" >/dev/null 2>&1 || true
log "Node $(node -v), npm $(npm -v)"

# -----------------------------------------------------------------------------
# 4. Репозиторий: клонируем или обновляем
# -----------------------------------------------------------------------------
if [ -d "$PROJECT_DIR/.git" ]; then
  log "Обновляю репозиторий в $PROJECT_DIR ..."
  git -C "$PROJECT_DIR" pull --ff-only || warn "git pull не прошёл (локальные правки?) — разрули вручную"
else
  log "Клонирую репозиторий в $PROJECT_DIR ..."
  git clone "$REPO_URL" "$PROJECT_DIR"
fi

# -----------------------------------------------------------------------------
# 5. Зависимости
# -----------------------------------------------------------------------------
log "Ставлю зависимости (npm install) — пара минут..."
cd "$PROJECT_DIR"
npm install

# -----------------------------------------------------------------------------
# 6. Готово / опциональный запуск
# -----------------------------------------------------------------------------
if [ "${1:-}" = "start" ] || [ "${1:-}" = "--start" ]; then
  log "Поднимаю dev-сервер. Останов — Ctrl+C."
  echo "    В Expo Go: Enter URL manually → exp://127.0.0.1:8081"
  exec npx expo start --localhost
fi

log "Окружение собрано!"
cat <<EOF

Запуск dev-сервера:

    cd $PROJECT_DIR
    npx expo start --localhost

Затем в Expo Go (SDK 57): Enter URL manually → exp://127.0.0.1:8081

Если открыл новый терминал и 'node' не находится — выполни:
    source ~/.bashrc
EOF
