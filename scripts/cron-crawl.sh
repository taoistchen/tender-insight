#!/bin/bash
#
# Tender Insight - 定时爬取脚本
# 由 crontab 每 8 小时触发一次
#

LOG_DIR="/root/tender-insight/data/logs"
mkdir -p "$LOG_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

crawl_site() {
  local site_name="$1"
  local max_pages="${2:-3}"

  log "开始爬取: $site_name (maxPages=$max_pages)"

  local result
  result=$(curl -s -X POST http://localhost:3002/api/crawler/run \
    -H "Content-Type: application/json" \
    -d "{\"siteName\": \"$site_name\", \"maxPages\": $max_pages}" 2>&1)

  local status=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','error'))" 2>/dev/null || echo "parse_error")
  local found=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tendersFound',0))" 2>/dev/null || echo "?")
  local new=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tendersNew',0))" 2>/dev/null || echo "?")

  log "  状态=$status, 发现=$found, 新增=$new"
}

log "======== 定时爬取开始 ========"

crawl_site "南京市公共资源交易平台" 3
crawl_site "连云港市公共资源交易平台" 3
crawl_site "镇江市公共资源交易平台" 3

log "======== 定时爬取结束 ========"
