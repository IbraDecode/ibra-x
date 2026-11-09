#!/usr/bin/env bash
# ==========================================================================
# Ibra X — pemasang satu baris
# Pemakaian:  curl -fsSL https://raw.githubusercontent.com/IbraDecode/ibra-x/main/install.sh | bash
# ==========================================================================
set -euo pipefail

REPO="${IBRA_X_REPO:-https://github.com/IbraDecode/ibra-x.git}"
DIR="${IBRA_X_DIR:-$HOME/.ibra-x}"

info() { printf "\033[36m›\033[0m %s\n" "$1"; }
ok()   { printf "\033[32m✓\033[0m %s\n" "$1"; }
err()  { printf "\033[31m✗ %s\033[0m\n" "$1" >&2; }

# --- Prasyarat -------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  err "Node.js tidak ditemukan. Pasang Node.js >= 20 lalu ulangi."
  exit 1
fi
NODE_MAJOR="$(node -v | sed 's/v//' | cut -d. -f1)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  err "Butuh Node.js >= 20 (terdeteksi $(node -v))."
  exit 1
fi
ok "Node.js $(node -v)"

if ! command -v git >/dev/null 2>&1; then
  err "git tidak ditemukan."
  exit 1
fi

# --- Ambil sumber ----------------------------------------------------------
if [ -d "$DIR/.git" ]; then
  info "Memperbarui $DIR"
  git -C "$DIR" pull --ff-only --quiet || true
else
  info "Mengunduh ke $DIR"
  git clone --depth 1 "$REPO" "$DIR"
fi
cd "$DIR"

# --- Pasang dependensi -----------------------------------------------------
info "Memasang dependensi (mungkin beberapa menit)…"
npm install --silent

# --- Tautkan CLI -----------------------------------------------------------
if npm link --silent >/dev/null 2>&1; then
  ok "Perintah 'ibrax' terpasang global."
else
  info "Tautan global gagal (izin?). Gunakan: cd $DIR && npm run cli -- <perintah>"
fi

ok "Selesai."
printf "\n  Jalankan:  %s\n" "ibrax init"
printf "  Lalu:      %s\n\n" "ibrax start"
