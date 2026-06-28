#!/bin/bash
# Cron job: trigger crawls for all active sites
API="http://localhost:3002/api"

echo "[$(date)] Starting scheduled crawl..."

for site in "南京市公共资源交易平台" "连云港市公共资源交易平台" "镇江市公共资源交易平台"; do
  echo "  Crawling: $site"
  curl -s -X POST "$API/crawler/run" \
    -H "Content-Type: application/json" \
    -d "{\"siteName\": \"$site\", \"maxPages\": 2}" \
    -o /dev/null -w "  -> HTTP %{http_code} in %{time_total}s\n"
done

echo "[$(date)] Scheduled crawl complete."
