#!/usr/bin/env bash
#
# エージェントエージェント: Cloud Run の最近のログを表示する
#   bash scripts/gcp/logs.sh            直近の 80 行(古い順)
#   LIMIT=200 bash scripts/gcp/logs.sh  行数を変える
#
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
require_project
print_recent_logs "${LIMIT:-80}"
