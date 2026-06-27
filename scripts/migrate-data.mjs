#!/usr/bin/env node
/**
 * Data Migration Runner
 * 
 * 将导出的 Convex JSON 数据导入到 MySQL
 */

import fs from "fs/promises";
import path from "path";
import { PrismaClient } from "@prisma/client";

const EXPORT_DIR = "./migrations/exports";

async function main() {
  console.log("=".repeat(60));
  console.log("ClawHub 数据迁移工具");
  console.log("=".repeat(60));
  
  const prisma = new PrismaClient();
  
  try {
    // 检查导出文件是否存在
    const files = await fs.readdir(EXPORT_DIR);
    const tableFiles = files.filter(f => f.endsWith(".json") && f !== "export_summary.json");
    
    console.log(`找到 ${tableFiles.length} 个表文件`);
    
    // 按依赖顺序迁移
    const migrationOrder = [
      { file: "users.json", model: "users", transform: transformUser },
      { file: "publishers.json", model: "publishers", transform: transformPublisher },
      { file: "publisherMembers.json", model: "publisherMembers", transform: identity },
      { file: "officialPublishers.json", model: "officialPublishers", transform: identity },
      { file: "skills.json", model: "skills", transform: transformSkill },
      { file: "skillVersions.json", model: "skillVersions", transform: transformSkillVersion },
      { file: "skillEmbeddings.json", model: "skillEmbeddings", transform: transformEmbedding },
      { file: "skillBadges.json", model: "skillBadges", transform: identity },
      { file: "comments.json", model: "comments", transform: transformComment },
      { file: "stars.json", model: "stars", transform: identity },
      { file: "skillReports.json", model: "skillReports", transform: identity },
      { file: "skillAppeals.json", model: "skillAppeals", transform: identity },
      { file: "packages.json", model: "packages", transform: transformPackage },
      { file: "packageReleases.json", model: "packageReleases", transform: transformPackageRelease },
      { file: "globalStats.json", model: "globalStats", transform: identity },
    ];
    
    for (const { file, model, transform } of migrationOrder) {
      if (!tableFiles.includes(file)) {
        console.log(`⏭️  跳过 ${file} (文件不存在)`);
        continue;
      }
      
      console.log(`\n迁移 ${file}...`);
      const rawData = await fs.readFile(path.join(EXPORT_DIR, file), "utf-8");
      const records = JSON.parse(rawData);
      
      console.log(`  找到 ${records.length} 条记录`);
      
      // 分批处理
      const BATCH_SIZE = 100;
      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        const transformed = batch.map(transform);
        
        try {
          await (prisma[model] as any).createMany({
            data: transformed,
            skipDuplicates: true,
          });
          console.log(`  ✅ 已导入 ${i + batch.length}/${records.length}`);
        } catch (error) {
          console.error(`  ❌ 批量导入失败: ${error.message}`);
        }
      }
    }
    
    console.log("\n" + "=".repeat(60));
    console.log("迁移完成!");
    console.log("=".repeat(60));
    
  } finally {
    await prisma.$disconnect();
  }
}

// 转换函数
function identity(x) {
  return x;
}

function transformUser(user) {
  return {
    id: user._id || user.id,
    name: user.name,
    image: user.image,
    email: user.email,
    emailVerificationTime: user.emailVerificationTime ? new Date(user.emailVerificationTime) : null,
    phone: user.phone,
    handle: user.handle,
    displayName: user.displayName || user.name,
    bio: user.bio,
    role: user.role || "user",
    githubCreatedAt: user.githubCreatedAt ? new Date(user.githubCreatedAt) : null,
    trustedPublisher: user.trustedPublisher || false,
    publishedSkills: user.publishedSkills || 0,
    totalStars: user.totalStars || 0,
    totalDownloads: user.totalDownloads || 0,
    createdAt: user.createdAt ? new Date(user.createdAt) : new Date(),
    updatedAt: user.updatedAt ? new Date(user.updatedAt) : new Date(),
    banReason: user.banReason,
    deactivatedAt: user.deactivatedAt ? new Date(user.deactivatedAt) : null,
    deletedAt: user.deletedAt ? new Date(user.deletedAt) : null,
  };
}

function transformPublisher(pub) {
  return {
    id: pub._id || pub.id,
    kind: pub.kind || "user",
    handle: pub.handle,
    displayName: pub.displayName,
    bio: pub.bio,
    image: pub.image,
    linkedUserId: pub.linkedUserId,
    trustedPublisher: pub.trustedPublisher || false,
    publishedSkills: pub.publishedSkills || 0,
    publishedPackages: pub.publishedPackages || 0,
    totalInstalls: pub.totalInstalls || 0,
    totalDownloads: pub.totalDownloads || 0,
    totalStars: pub.totalStars || 0,
    createdAt: pub.createdAt ? new Date(pub.createdAt) : new Date(),
    updatedAt: pub.updatedAt ? new Date(pub.updatedAt) : new Date(),
    deactivatedAt: pub.deactivatedAt ? new Date(pub.deactivatedAt) : null,
    deletedAt: pub.deletedAt ? new Date(pub.deletedAt) : null,
  };
}

function transformSkill(skill) {
  return {
    id: skill._id || skill.id,
    slug: skill.slug,
    displayName: skill.displayName,
    summary: skill.summary,
    icon: skill.icon,
    resourceId: skill.resourceId,
    ownerUserId: skill.ownerUserId,
    ownerPublisherId: skill.ownerPublisherId,
    canonicalSkillId: skill.canonicalSkillId,
    forkOfSkillId: skill.forkOf?.skillId,
    forkOfKind: skill.forkOf?.kind,
    forkOfVersion: skill.forkOf?.version,
    forkOfAt: skill.forkOf?.at ? new Date(skill.forkOf.at) : null,
    installKind: skill.installKind,
    githubSourceId: skill.githubSourceId,
    githubPath: skill.githubPath,
    githubHasSkillCard: skill.githubHasSkillCard,
    githubCurrentCommit: skill.githubCurrentCommit,
    githubCurrentContentHash: skill.githubCurrentContentHash,
    githubCurrentStatus: skill.githubCurrentStatus,
    githubScanStatus: skill.githubScanStatus,
    moderationStatus: skill.moderationStatus,
    moderationNotes: skill.moderationNotes,
    moderationReason: skill.moderationReason,
    moderationVerdict: skill.moderationVerdict,
    isSuspicious: skill.isSuspicious,
    statsDownloads: skill.statsDownloads ?? skill.stats?.downloads ?? 0,
    statsStars: skill.statsStars ?? skill.stats?.stars ?? 0,
    statsInstallsCurrent: skill.statsInstallsCurrent ?? skill.stats?.installsCurrent ?? 0,
    statsInstallsAllTime: skill.statsInstallsAllTime ?? skill.stats?.installsAllTime ?? 0,
    statsVersions: skill.stats?.versions ?? 0,
    statsComments: skill.stats?.comments ?? 0,
    createdAt: skill.createdAt ? new Date(skill.createdAt) : new Date(),
    updatedAt: skill.updatedAt ? new Date(skill.updatedAt) : new Date(),
    softDeletedAt: skill.softDeletedAt ? new Date(skill.softDeletedAt) : null,
  };
}

function transformSkillVersion(version) {
  return {
    id: version._id || version.id,
    skillId: version.skillId,
    version: version.version,
    fingerprint: version.fingerprint,
    changelog: version.changelog,
    changelogSource: version.changelogSource,
    icon: version.icon,
    files: version.files || [],
    parsed: version.parsed || {},
    createdBy: version.createdBy,
    createdAt: version.createdAt ? new Date(version.createdAt) : new Date(),
    sha256hash: version.sha256hash,
  };
}

function transformEmbedding(embedding) {
  return {
    id: embedding._id || embedding.id,
    skillId: embedding.skillId,
    versionId: embedding.versionId,
    ownerId: embedding.ownerId,
    ownerPublisherId: embedding.ownerPublisherId,
    embedding: embedding.embedding,
    isLatest: embedding.isLatest,
    isApproved: embedding.isApproved,
    visibility: embedding.visibility || "public",
  };
}

function transformComment(comment) {
  return {
    id: comment._id || comment.id,
    skillId: comment.skillId,
    userId: comment.userId,
    body: comment.body,
    createdAt: comment.createdAt ? new Date(comment.createdAt) : new Date(),
    softDeletedAt: comment.softDeletedAt ? new Date(comment.softDeletedAt) : null,
  };
}

function transformPackage(pkg) {
  return {
    id: pkg._id || pkg.id,
    name: pkg.name,
    normalizedName: pkg.normalizedName || pkg.name.toLowerCase(),
    displayName: pkg.displayName || pkg.name,
    summary: pkg.summary,
    ownerUserId: pkg.ownerUserId,
    ownerPublisherId: pkg.ownerPublisherId,
    family: pkg.family || "skill",
    channel: pkg.channel || "community",
    isOfficial: pkg.isOfficial || false,
    runtimeId: pkg.runtimeId,
    sourceRepo: pkg.sourceRepo,
    stats: pkg.stats || { downloads: 0, installs: 0, stars: 0, versions: 0 },
    scanStatus: pkg.scanStatus || "pending",
    createdAt: pkg.createdAt ? new Date(pkg.createdAt) : new Date(),
    updatedAt: pkg.updatedAt ? new Date(pkg.updatedAt) : new Date(),
    softDeletedAt: pkg.softDeletedAt ? new Date(pkg.softDeletedAt) : null,
  };
}

function transformPackageRelease(release) {
  return {
    id: release._id || release.id,
    packageId: release.packageId,
    version: release.version,
    changelog: release.changelog || "",
    summary: release.summary,
    distTags: release.distTags || [],
    files: release.files || [],
    integritySha256: release.integritySha256 || release.sha256hash || "",
    artifactKind: release.artifactKind,
    clawpackStorageId: release.clawpackStorageId,
    clawpackSha256: release.clawpackSha256,
    clawpackSize: release.clawpackSize,
    npmIntegrity: release.npmIntegrity,
    npmShasum: release.npmShasum,
    npmTarballName: release.npmTarballName,
    createdBy: release.createdBy,
    publishActor: release.publishActor || { kind: "user", userId: release.createdBy },
    createdAt: release.createdAt ? new Date(release.createdAt) : new Date(),
    softDeletedAt: release.softDeletedAt ? new Date(release.softDeletedAt) : null,
  };
}

main().catch(console.error);
