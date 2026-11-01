#!/usr/bin/env bash
# 统一的启动入口。
#
# 为什么需要这个脚本：某些宿主环境（例如以 Electron 应用启动的子进程）会继承
# ELECTRON_RUN_AS_NODE=1，Electron 会因此退化成纯 Node 运行，表现为
# `electron.protocol` / `electron.app` 为 undefined，报错栈尾出现 Node 版本号。
# 所有启动都必须先清掉这个变量。
set -euo pipefail
cd "$(dirname "$0")/.."

unset ELECTRON_RUN_AS_NODE || true

cmd="${1:-start}"
shift || true

case "$cmd" in
  dev)
    exec ./node_modules/.bin/electron-vite dev "$@"
    ;;
  build)
    exec ./node_modules/.bin/electron-vite build "$@"
    ;;
  start)
    exec ./node_modules/.bin/electron . "$@"
    ;;
  *)
    echo "用法: scripts/run.sh [dev|build|start]" >&2
    exit 1
    ;;
esac
