#!/usr/bin/env bash
# Convex Data Export Script using CLI
# 
# 导出 Convex 数据库中的所有数据为 JSON 格式，
# 供后续迁移到 MySQL 使用。

set -e

CONVEX_URL="${VITE_CONVEX_URL:-https://cheerful-schnauzer-269.convex.cloud}"
CONVEX_DEPLOY_KEY="${CONVEX_DEPLOY_KEY:-}"
OUTPUT_DIR="./migrations/exports"

# 要导出的表
TABLES=(
  "users"
  "publishers"
  "publisherMembers"
  "officialPublishers"
  "skills"
  "skillVersions"
  "skillEmbeddings"
  "skillBadges"
  "comments"
  "commentReports"
  "stars"
  "skillReports"
  "skillAppeals"
  "packages"
  "packageReleases"
  "skillDailyStats"
  "skillStatEvents"
  "globalStats"
  "apiTokens"
  "rateLimits"
  "reservedSlugs"
  "reservedHandles"
  "auditLogs"
)

if [ -z "$CONVEX_DEPLOY_KEY" ]; then
  echo "Error: CONVEX_DEPLOY_KEY environment variable is not set"
  exit 1
fi

echo "============================================================"
echo "Convex Data Export Tool (CLI Mode)"
echo "============================================================"
echo "Convex URL: $CONVEX_URL"
echo "Output Directory: $OUTPUT_DIR"
echo ""

# 创建输出目录
mkdir -p "$OUTPUT_DIR"

total_records=0

for table in "${TABLES[@]}"; do
  query_name="export_${table}"
  echo "Exporting ${table}... (query: ${query_name})"
  
  output_file="${OUTPUT_DIR}/${table}.json"
  
  # 使用 bunx convex run 执行查询并输出到文件
  if bunx convex run "${query_name}" 2>/dev/null > "$output_file"; then
    count=$(cat "$output_file" | grep -o '"_id"' | wc -l)
    echo "  ✅ Exported $count records"
    total_records=$((total_records + count))
  else
    echo "  ❌ Error: Failed to export $table"
    echo "[]" > "$output_file"
  fi
done

elapsed=$SECONDS

# 保存导出摘要
cat > "${OUTPUT_DIR}/export_summary.json" <<EOF
{
  "exportedAt": "$(date -Iseconds)",
  "convexUrl": "$CONVEX_URL",
  "tablesCount": ${#TABLES[@]},
  "totalRecords": $total_records,
  "elapsedSecs": $elapsed
}
EOF

echo ""
echo "============================================================"
echo "Export Complete!"
echo "Total records: $total_records"
echo "Elapsed time: ${elapsed}s"
echo "Output: ${OUTPUT_DIR}/"
echo "============================================================"
