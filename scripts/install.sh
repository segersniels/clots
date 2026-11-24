#!/bin/sh
# Installs the clots command for this machine, or with --app the Clots app for a Mac, from the GitHub releases.
#
#   curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/segersniels/clots/main/scripts/install.sh | sh
#   curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/segersniels/clots/main/scripts/install.sh | sh -s -- --app
#
# Environment variables:
#   CLOTS_VERSION  The release to install, such as 0.2.0. Defaults to the latest.
#
# Everything runs from main at the end, so a partly downloaded script does nothing.
set -eu

REPO="segersniels/clots"

say() {
  printf 'clots: %s\n' "$1"
}

fail() {
  printf 'clots: error: %s\n' "$1" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "this script needs $1"
}

# detect_platform prints the release's name for this OS and CPU, such as linux-x64.
detect_platform() {
  case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "clots runs on macOS and Linux, not $(uname -s)" ;;
  esac

  case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) fail "clots runs on arm64 and x86_64, not $(uname -m)" ;;
  esac

  # A shell under Rosetta reports x86_64 on an Apple silicon Mac. The release has only the native build.
  if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null)" = 1 ]; then
    arch=arm64
  fi

  if [ "$os" = darwin ] && [ "$arch" = x64 ]; then
    fail "clots runs on Apple silicon Macs, not on Intel Macs"
  fi

  printf '%s-%s' "$os" "$arch"
}

# sha256 prints the SHA-256 checksum of a file.
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  else
    shasum -a 256 "$1" | awk '{ print $1 }'
  fi
}

# download fetches a release file into tmp_dir and stops when it does not match the release's checksum.
download() {
  say "downloading $1"
  curl --proto '=https' --tlsv1.2 -fsSL -o "$tmp_dir/$1" "$base_url/$1" ||
    fail "could not download $base_url/$1"
  curl --proto '=https' --tlsv1.2 -fsSL -o "$tmp_dir/checksums.txt" "$base_url/checksums.txt" ||
    fail "could not download the checksums of the release"

  expected="$(awk -v file="$1" '$2 == file { print $1 }' "$tmp_dir/checksums.txt")"
  [ -n "$expected" ] && [ "$expected" = "$(sha256 "$tmp_dir/$1")" ] ||
    fail "the checksum of $1 does not match the release"
}

# install_app copies Clots.app from the release's disk image to /Applications.
install_app() {
  [ "$(detect_platform)" = darwin-arm64 ] || fail "the Clots app runs on Apple silicon Macs only"
  need hdiutil

  download Clots.dmg
  hdiutil attach -nobrowse -readonly -quiet -mountpoint "$tmp_dir/volume" "$tmp_dir/Clots.dmg"

  # A curl download has no quarantine flag, so macOS opens the app without the notarization warning.
  rm -rf /Applications/Clots.app
  ditto "$tmp_dir/volume/Clots.app" /Applications/Clots.app
  hdiutil detach -quiet "$tmp_dir/volume"

  say "installed /Applications/Clots.app"
  say "open Clots and choose where clots runs"
}

# install_server installs the clots command through the bundle's own `clots install`.
install_server() {
  need tar

  bundle="clots-$(detect_platform)"
  download "$bundle.tar.gz"
  tar -xzf "$tmp_dir/$bundle.tar.gz" -C "$tmp_dir"

  # `clots install` copies the bundle into place and tells the user when its folder is not on the PATH.
  "$tmp_dir/$bundle/clots" install

  echo
  say "run \`clots up\` to start the server as a background service and put it on your tailnet"
}

main() {
  need curl
  need uname

  base_url="https://github.com/$REPO/releases/latest/download"
  if [ -n "${CLOTS_VERSION:-}" ]; then
    base_url="https://github.com/$REPO/releases/download/v${CLOTS_VERSION#v}"
  fi

  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT

  case "${1:---server}" in
  --server) install_server ;;
  --app) install_app ;;
  *) fail "unknown option $1. Use --server (the default) or --app" ;;
  esac
}

main "$@"
