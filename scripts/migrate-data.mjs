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
    const tableFiles = files.filter((f) => f.endsWith(".json") && f !== "export_summary.json");

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
      {
        file: "packageReleases.json",
        model: "packageReleases",
        transform: transformPackageRelease,
      },
      { file: "globalStats.json", model: "globalStats", transform: identity },
    ];

    let totalImported = 0;

    for (const { file, model, transform } of migrationOrder) {
      if (!tableFiles.includes(file)) {
        console.log(`⏭️  跳过 ${file} (文件不存在)`);
        continue;
      }

      console.log(`\n迁移 ${file}...`);
      const rawData = await fs.readFile(path.join(EXPORT_DIR, file), "utf-8");
      const records = JSON.parse(rawData);

      console.log(`  找到 ${records.length} 条记录`);

      if (records.length === 0) {
        console.log(`  ⏭️  无数据，跳过`);
        continue;
      }

      // 分批处理
      const BATCH_SIZE = 100;
      let imported = 0;
      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        const transformed = batch.map(transform).filter(Boolean);

        try {
          await prisma[model].createMany({
            data: transformed,
            skipDuplicates: true,
          });
          imported += transformed.length;
          console.log(`  ✅ 已导入 ${imported}/${records.length}`);
        } catch (error) {
          console.error(`  ❌ 批量导入失败: ${error.message}`);
          // 尝试逐条导入
          for (const record of transformed) {
            try {
              await prisma[model].create({ data: record });
              imported++;
            } catch (e) {
              // 忽略重复记录
            }
          }
          console.log(`  ⚠️  逐条导入完成: ${imported}/${records.length}`);
        }
      }

      totalImported += imported;
    }

    console.log("\n" + "=".repeat(60));
    console.log(`迁移完成! 共导入 ${totalImported} 条记录`);
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
  if (!user) return null;
  return {
    id: user._id || user.id,
    name: user.name,
    image: user.image,
    email: user.email,
    emailVerificationTime: user.emailVerificationTime ? new Date(user.emailVerificationTime) : null,
    phone: user.phone,
    phoneVerificationTime: user.phoneVerificationTime ? new Date(user.phoneVerificationTime) : null,
    isAnonymous: user.isAnonymous || false,
    handle: user.handle,
    displayName: user.displayName || user.name,
    bio: user.bio,
    role: user.role || "user",
    githubCreatedAt: user.githubCreatedAt ? new Date(user.githubCreatedAt) : null,
    githubFetchedAt: user.githubFetchedAt ? new Date(user.githubFetchedAt) : null,
    githubProfileSyncedAt: user.githubProfileSyncedAt ? new Date(user.githubProfileSyncedAt) : null,
    trustedPublisher: user.trustedPublisher || false,
    publishedSkills: user.publishedSkills || 0,
    totalStars: user.totalStars || 0,
    totalDownloads: user.totalDownloads || 0,
    personalPublisherId: user.personalPublisherId,
    requiresModerationAt: user.requiresModerationAt ? new Date(user.requiresModerationAt) : null,
    requiresModerationReason: user.requiresModerationReason,
    deactivatedAt: user.deactivatedAt ? new Date(user.deactivatedAt) : null,
    purgedAt: user.purgedAt ? new Date(user.purgedAt) : null,
    deletedAt: user.deletedAt ? new Date(user.deletedAt) : null,
    banReason: user.banReason,
    createdAt: user.createdAt ? new Date(user.createdAt) : new Date(),
    updatedAt: user.updatedAt ? new Date(user.updatedAt) : new Date(),
  };
}

function transformPublisher(pub) {
  if (!pub) return null;
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
    skillTotalInstalls: pub.skillTotalInstalls || 0,
    skillTotalDownloads: pub.skillTotalDownloads || 0,
    skillTotalStars: pub.skillTotalStars || 0,
    createdAt: pub.createdAt ? new Date(pub.createdAt) : new Date(),
    updatedAt: pub.updatedAt ? new Date(pub.updatedAt) : new Date(),
    deactivatedAt: pub.deactivatedAt ? new Date(pub.deactivatedAt) : null,
    deletedAt: pub.deletedAt ? new Date(pub.deletedAt) : null,
  };
}

function transformSkill(skill) {
  if (!skill) return null;
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
    githubCurrentCheckedAt: skill.githubCurrentCheckedAt
      ? new Date(skill.githubCurrentCheckedAt)
      : null,
    githubScanStatus: skill.githubScanStatus,
    githubRemovedAt: skill.githubRemovedAt ? new Date(skill.githubRemovedAt) : null,
    latestVersionId: skill.latestVersionId,
    latestVersionSummary: skill.latestVersionSummary
      ? JSON.stringify(skill.latestVersionSummary)
      : null,
    tags: skill.tags ? JSON.stringify(skill.tags) : null,
    capabilityTags: skill.capabilityTags ? JSON.stringify(skill.capabilityTags) : null,
    softDeletedAt: skill.softDeletedAt ? new Date(skill.softDeletedAt) : null,
    moderationStatus: skill.moderationStatus,
    moderationNotes: skill.moderationNotes,
    moderationReason: skill.moderationReason,
    moderationVerdict: skill.moderationVerdict,
    moderationReasonCodes: skill.moderationReasonCodes
      ? JSON.stringify(skill.moderationReasonCodes)
      : null,
    moderationEvidence: skill.moderationEvidence ? JSON.stringify(skill.moderationEvidence) : null,
    moderationSummary: skill.moderationSummary,
    moderationEngineVersion: skill.moderationEngineVersion,
    moderationEvaluatedAt: skill.moderationEvaluatedAt
      ? new Date(skill.moderationEvaluatedAt)
      : null,
    manualOverride: skill.manualOverride ? JSON.stringify(skill.manualOverride) : null,
    quality: skill.quality ? JSON.stringify(skill.quality) : null,
    isSuspicious: skill.isSuspicious,
    moderationFlags: skill.moderationFlags ? JSON.stringify(skill.moderationFlags) : null,
    lastReviewedAt: skill.lastReviewedAt ? new Date(skill.lastReviewedAt) : null,
    scanLastCheckedAt: skill.scanLastCheckedAt ? new Date(skill.scanLastCheckedAt) : null,
    scanCheckCount: skill.scanCheckCount,
    hiddenAt: skill.hiddenAt ? new Date(skill.hiddenAt) : null,
    hiddenBy: skill.hiddenBy,
    unpublishedSlugReservedUntil: skill.unpublishedSlugReservedUntil
      ? new Date(skill.unpublishedSlugReservedUntil)
      : null,
    unpublishedSlugReleasedAt: skill.unpublishedSlugReleasedAt
      ? new Date(skill.unpublishedSlugReleasedAt)
      : null,
    unpublishedOriginalSlug: skill.unpublishedOriginalSlug,
    reportCount: skill.reportCount || 0,
    lastReportedAt: skill.lastReportedAt ? new Date(skill.lastReportedAt) : null,
    batch: skill.batch,
    statsDownloads: skill.statsDownloads ?? skill.stats?.downloads ?? 0,
    statsStars: skill.statsStars ?? skill.stats?.stars ?? 0,
    statsInstallsCurrent: skill.statsInstallsCurrent ?? skill.stats?.installsCurrent ?? 0,
    statsInstallsAllTime: skill.statsInstallsAllTime ?? skill.stats?.installsAllTime ?? 0,
    statsVersions: skill.statsVersions ?? skill.stats?.versions ?? 0,
    statsComments: skill.statsComments ?? skill.stats?.comments ?? 0,
    createdAt: skill.createdAt ? new Date(skill.createdAt) : new Date(),
    updatedAt: skill.updatedAt ? new Date(skill.updatedAt) : new Date(),
  };
}

function transformSkillVersion(version) {
  if (!version) return null;
  return {
    id: version._id || version.id,
    skillId: version.skillId,
    version: version.version,
    fingerprint: version.fingerprint,
    sourceProvenance: version.sourceProvenance ? JSON.stringify(version.sourceProvenance) : null,
    changelog: version.changelog || "",
    changelogSource: version.changelogSource,
    icon: version.icon,
    files: version.files ? JSON.stringify(version.files) : "[]",
    parsed: version.parsed ? JSON.stringify(version.parsed) : "{}",
    createdBy: version.createdBy,
    createdAt: version.createdAt ? new Date(version.createdAt) : new Date(),
    clawScanNote: version.clawScanNote,
    clawScanNoteUpdatedAt: version.clawScanNoteUpdatedAt
      ? new Date(version.clawScanNoteUpdatedAt)
      : null,
    softDeletedAt: version.softDeletedAt ? new Date(version.softDeletedAt) : null,
    sha256hash: version.sha256hash,
    vtAnalysis: version.vtAnalysis ? JSON.stringify(version.vtAnalysis) : null,
    skillSpectorAnalysis: version.skillSpectorAnalysis
      ? JSON.stringify(version.skillSpectorAnalysis)
      : null,
    llmAnalysis: version.llmAnalysis ? JSON.stringify(version.llmAnalysis) : null,
    capabilityTags: version.capabilityTags ? JSON.stringify(version.capabilityTags) : null,
    depRegistryAnalysis: version.depRegistryAnalysis
      ? JSON.stringify(version.depRegistryAnalysis)
      : null,
    depRegistryScanStatus: version.depRegistryScanStatus,
    staticScan: version.staticScan ? JSON.stringify(version.staticScan) : null,
    apiKeyRequired: version.apiKeyRequired,
  };
}

function transformEmbedding(embedding) {
  if (!embedding) return null;
  return {
    id: embedding._id || embedding.id,
    skillId: embedding.skillId,
    versionId: embedding.versionId,
    ownerId: embedding.ownerId,
    ownerPublisherId: embedding.ownerPublisherId,
    embedding: embedding.embedding ? JSON.stringify(embedding.embedding) : null,
    isLatest: embedding.isLatest,
    isApproved: embedding.isApproved,
    visibility: embedding.visibility || "public",
    updatedAt: new Date(),
  };
}

function transformComment(comment) {
  if (!comment) return null;
  return {
    id: comment._id || comment.id,
    skillId: comment.skillId,
    userId: comment.userId,
    body: comment.body,
    reportCount: comment.reportCount || 0,
    lastReportedAt: comment.lastReportedAt ? new Date(comment.lastReportedAt) : null,
    scamScanVerdict: comment.scamScanVerdict,
    scamScanConfidence: comment.scamScanConfidence,
    scamScanExplanation: comment.scamScanExplanation,
    scamScanEvidence: comment.scamScanEvidence ? JSON.stringify(comment.scamScanEvidence) : null,
    scamScanModel: comment.scamScanModel,
    scamScanCheckedAt: comment.scamScanCheckedAt ? new Date(comment.scamScanCheckedAt) : null,
    scamBanTriggeredAt: comment.scamBanTriggeredAt ? new Date(comment.scamBanTriggeredAt) : null,
    createdAt: comment.createdAt ? new Date(comment.createdAt) : new Date(),
    softDeletedAt: comment.softDeletedAt ? new Date(comment.softDeletedAt) : null,
    deletedBy: comment.deletedBy,
  };
}

function transformPackage(pkg) {
  if (!pkg) return null;
  return {
    id: pkg._id || pkg.id,
    name: pkg.name,
    normalizedName: pkg.normalizedName || pkg.name?.toLowerCase(),
    displayName: pkg.displayName || pkg.name,
    summary: pkg.summary,
    ownerUserId: pkg.ownerUserId,
    ownerPublisherId: pkg.ownerPublisherId,
    family: pkg.family || "skill",
    channel: pkg.channel || "community",
    isOfficial: pkg.isOfficial || false,
    runtimeId: pkg.runtimeId,
    sourceRepo: pkg.sourceRepo,
    latestReleaseId: pkg.latestReleaseId,
    latestVersionSummary: pkg.latestVersionSummary
      ? JSON.stringify(pkg.latestVersionSummary)
      : null,
    tags: pkg.tags ? JSON.stringify(pkg.tags) : null,
    capabilityTags: pkg.capabilityTags ? JSON.stringify(pkg.capabilityTags) : null,
    executesCode: pkg.executesCode,
    compatibility: pkg.compatibility ? JSON.stringify(pkg.compatibility) : null,
    capabilities: pkg.capabilities ? JSON.stringify(pkg.capabilities) : null,
    verification: pkg.verification ? JSON.stringify(pkg.verification) : null,
    scanStatus: pkg.scanStatus || "pending",
    stats: pkg.stats
      ? JSON.stringify(pkg.stats)
      : JSON.stringify({ downloads: 0, installs: 0, stars: 0, versions: 0 }),
    reportCount: pkg.reportCount || 0,
    lastReportedAt: pkg.lastReportedAt ? new Date(pkg.lastReportedAt) : null,
    softDeletedAt: pkg.softDeletedAt ? new Date(pkg.softDeletedAt) : null,
    softDeletedReason: pkg.softDeletedReason,
    softDeletedBy: pkg.softDeletedBy,
    softDeletedByRole: pkg.softDeletedByRole,
    createdAt: pkg.createdAt ? new Date(pkg.createdAt) : new Date(),
    updatedAt: pkg.updatedAt ? new Date(pkg.updatedAt) : new Date(),
  };
}

function transformPackageRelease(release) {
  if (!release) return null;
  return {
    id: release._id || release.id,
    packageId: release.packageId,
    version: release.version,
    changelog: release.changelog || "",
    summary: release.summary,
    distTags: release.distTags ? JSON.stringify(release.distTags) : null,
    files: release.files ? JSON.stringify(release.files) : "[]",
    integritySha256: release.integritySha256 || release.sha256hash || "",
    artifactKind: release.artifactKind,
    clawpackStorageId: release.clawpackStorageId,
    clawpackSha256: release.clawpackSha256,
    clawpackSize: release.clawpackSize,
    clawpackFormat: release.clawpackFormat,
    npmIntegrity: release.npmIntegrity,
    npmShasum: release.npmShasum,
    npmTarballName: release.npmTarballName,
    npmUnpackedSize: release.npmUnpackedSize,
    npmFileCount: release.npmFileCount,
    extractedPackageJson: release.extractedPackageJson
      ? JSON.stringify(release.extractedPackageJson)
      : null,
    extractedPluginManifest: release.extractedPluginManifest
      ? JSON.stringify(release.extractedPluginManifest)
      : null,
    normalizedBundleManifest: release.normalizedBundleManifest
      ? JSON.stringify(release.normalizedBundleManifest)
      : null,
    compatibility: release.compatibility ? JSON.stringify(release.compatibility) : null,
    capabilities: release.capabilities ? JSON.stringify(release.capabilities) : null,
    runtimeId: release.runtimeId,
    sourceRepo: release.sourceRepo,
    verification: release.verification ? JSON.stringify(release.verification) : null,
    sha256hash: release.sha256hash,
    vtAnalysis: release.vtAnalysis ? JSON.stringify(release.vtAnalysis) : null,
    skillSpectorAnalysis: release.skillSpectorAnalysis
      ? JSON.stringify(release.skillSpectorAnalysis)
      : null,
    llmAnalysis: release.llmAnalysis ? JSON.stringify(release.llmAnalysis) : null,
    staticScan: release.staticScan ? JSON.stringify(release.staticScan) : null,
    manualModeration: release.manualModeration ? JSON.stringify(release.manualModeration) : null,
    source: release.source ? JSON.stringify(release.source) : null,
    createdBy: release.createdBy,
    publishActor: release.publishActor
      ? JSON.stringify(release.publishActor)
      : JSON.stringify({ kind: "user", userId: release.createdBy }),
    createdAt: release.createdAt ? new Date(release.createdAt) : new Date(),
    clawScanNote: release.clawScanNote,
    clawScanNoteUpdatedAt: release.clawScanNoteUpdatedAt
      ? new Date(release.clawScanNoteUpdatedAt)
      : null,
    softDeletedAt: release.softDeletedAt ? new Date(release.softDeletedAt) : null,
  };
}

main().catch(console.error);
