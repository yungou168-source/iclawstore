#!/usr/bin/env node
/**
 * Convex Data Export Script
 *
 * 逐表导出数据到 JSON 文件
 */

import { execSync } from "child_process";
import fs from "fs/promises";
import path from "path";

const CONVEX_URL = process.env.VITE_CONVEX_URL || "https://cheerful-schnauzer-269.convex.cloud";
const OUTPUT_DIR = "./migrations/exports";

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

async function exportTable(tableName) {
  const queryName = `export:export_${tableName}`;

  try {
    const output = execSync(`bunx convex run ${queryName}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120000,
    });

    // Parse output - convex run outputs JSON directly
    let data;
    try {
      data = JSON.parse(output);
    } catch {
      console.log(`  Warning: Could not parse ${tableName}, saving raw output`);
      data = output;
    }

    return { success: true, data };
  } catch (error) {
    // If it fails, try to get any output
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("Convex Data Export Tool");
  console.log("=".repeat(60));
  console.log(`Convex URL: ${CONVEX_URL}`);
  console.log(`Output Directory: ${OUTPUT_DIR}`);
  console.log("");

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const startTime = Date.now();
  let totalRecords = 0;

  for (const table of TABLES) {
    process.stdout.write(`Exporting ${table}... `);

    const result = await exportTable(table);

    if (result.success) {
      const records = Array.isArray(result.data) ? result.data : [];
      const count = records.length;
      totalRecords += count;

      console.log(`${count} records`);

      await fs.writeFile(path.join(OUTPUT_DIR, `${table}.json`), JSON.stringify(records, null, 2));
    } else {
      console.log(`FAILED: ${result.error}`);
      await fs.writeFile(path.join(OUTPUT_DIR, `${table}.json`), JSON.stringify([], null, 2));
    }
  }

  const elapsed = Date.now() - startTime;

  const summary = {
    exportedAt: new Date().toISOString(),
    convexUrl: CONVEX_URL,
    totalRecords,
    elapsedMs: elapsed,
  };

  await fs.writeFile(
    path.join(OUTPUT_DIR, "export_summary.json"),
    JSON.stringify(summary, null, 2),
  );

  console.log("");
  console.log("=".repeat(60));
  console.log("Export Complete!");
  console.log(`Total records: ${totalRecords}`);
  console.log(`Elapsed time: ${elapsed}ms`);
  console.log(`Output: ${OUTPUT_DIR}/`);
  console.log("=".repeat(60));
}

main().catch(console.error);
