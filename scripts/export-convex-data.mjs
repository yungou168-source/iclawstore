#!/usr/bin/env node
/**
 * Convex Data Export Script
 * 
 * 导出 Convex 数据库中的所有数据为 JSON 格式，
 * 供后续迁移到 MySQL 使用。
 * 
 * 使用方法:
 *   node scripts/export-convex-data.mjs
 * 
 * 依赖:
 *   - Convex CLI
 *   - CONVEX_DEPLOY_KEY 环境变量
 */

import { ConvexHttpClient } from "convex/cli.js";
import fs from "fs/promises";
import path from "path";

// 配置
const CONVEX_URL = process.env.VITE_CONVEX_URL || "https://cheerful-schnauzer-269.convex.cloud";
const OUTPUT_DIR = "./migrations/exports";

// 要导出的表
const TABLES = [
  "users",
  "publishers", 
  "publisherMembers",
  "officialPublishers",
  "skills",
  "skillVersions",
  "skillEmbeddings",
  "skillBadges",
  "comments",
  "commentReports",
  "stars",
  "skillReports",
  "skillAppeals",
  "packages",
  "packageReleases",
  "skillDailyStats",
  "skillStatEvents",
  "globalStats",
  "apiTokens",
  "rateLimits",
  "reservedSlugs",
  "reservedHandles",
  "auditLogs",
];

async function exportTable(client, tableName) {
  console.log(`Exporting ${tableName}...`);
  
  try {
    // 使用 genericQuery 调用导出的 query 函数
    const results = await client.query(`export_${tableName}`, {});
    
    return {
      table: tableName,
      count: results?.length || 0,
      data: results || [],
      exportedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`Error exporting ${tableName}:`, error.message);
    return {
      table: tableName,
      count: 0,
      data: [],
      error: error.message,
      exportedAt: new Date().toISOString(),
    };
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("Convex Data Export Tool");
  console.log("=".repeat(60));
  console.log(`Convex URL: ${CONVEX_URL}`);
  console.log(`Output Directory: ${OUTPUT_DIR}`);
  console.log("");
  
  // 创建输出目录
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  
  // 初始化 Convex 客户端
  const client = new ConvexHttpClient(CONVEX_URL);
  
  const results = [];
  const startTime = Date.now();
  
  for (const table of TABLES) {
    const result = await exportTable(client, table);
    results.push(result);
    
    if (result.error) {
      console.log(`  ❌ Error: ${result.error}`);
    } else {
      console.log(`  ✅ Exported ${result.count} records`);
    }
  }
  
  const elapsed = Date.now() - startTime;
  
  // 保存导出摘要
  const summary = {
    exportedAt: new Date().toISOString(),
    convexUrl: CONVEX_URL,
    tablesCount: TABLES.length,
    totalRecords: results.reduce((sum, r) => sum + r.count, 0),
    elapsedMs: elapsed,
    tables: results.map(r => ({
      table: r.table,
      count: r.count,
      success: !r.error,
      error: r.error,
    })),
  };
  
  await fs.writeFile(
    path.join(OUTPUT_DIR, "export_summary.json"),
    JSON.stringify(summary, null, 2)
  );
  
  // 保存每个表的数据
  for (const result of results) {
    if (result.data.length > 0) {
      await fs.writeFile(
        path.join(OUTPUT_DIR, `${result.table}.json`),
        JSON.stringify(result.data, null, 2)
      );
    }
  }
  
  console.log("");
  console.log("=".repeat(60));
  console.log("Export Complete!");
  console.log(`Total records: ${summary.totalRecords}`);
  console.log(`Elapsed time: ${elapsed}ms`);
  console.log(`Output: ${OUTPUT_DIR}/`);
  console.log("=".repeat(60));
}

main().catch(console.error);
