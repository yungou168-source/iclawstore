import { api } from "./_generated/api";
import { query, action } from "./_generated/server";

/**
 * Export queries for Convex data migration
 * These queries return all records from each table for export to MySQL
 */

export const export_users = query({
  handler: async (ctx) => {
    return await ctx.db.query("users").collect();
  },
});

export const export_publishers = query({
  handler: async (ctx) => {
    return await ctx.db.query("publishers").collect();
  },
});

export const export_publisherMembers = query({
  handler: async (ctx) => {
    return await ctx.db.query("publisherMembers").collect();
  },
});

export const export_officialPublishers = query({
  handler: async (ctx) => {
    return await ctx.db.query("officialPublishers").collect();
  },
});

export const export_skills = query({
  handler: async (ctx) => {
    return await ctx.db.query("skills").collect();
  },
});

export const export_skillVersions = query({
  handler: async (ctx) => {
    return await ctx.db.query("skillVersions").collect();
  },
});

export const export_skillEmbeddings = query({
  handler: async (ctx) => {
    return await ctx.db.query("skillEmbeddings").collect();
  },
});

export const export_skillBadges = query({
  handler: async (ctx) => {
    return await ctx.db.query("skillBadges").collect();
  },
});

export const export_comments = query({
  handler: async (ctx) => {
    return await ctx.db.query("comments").collect();
  },
});

export const export_commentReports = query({
  handler: async (ctx) => {
    return await ctx.db.query("commentReports").collect();
  },
});

export const export_stars = query({
  handler: async (ctx) => {
    return await ctx.db.query("stars").collect();
  },
});

export const export_skillReports = query({
  handler: async (ctx) => {
    return await ctx.db.query("skillReports").collect();
  },
});

export const export_skillAppeals = query({
  handler: async (ctx) => {
    return await ctx.db.query("skillAppeals").collect();
  },
});

export const export_packages = query({
  handler: async (ctx) => {
    return await ctx.db.query("packages").collect();
  },
});

export const export_packageReleases = query({
  handler: async (ctx) => {
    return await ctx.db.query("packageReleases").collect();
  },
});

export const export_skillDailyStats = query({
  handler: async (ctx) => {
    return await ctx.db.query("skillDailyStats").collect();
  },
});

export const export_skillStatEvents = query({
  handler: async (ctx) => {
    return await ctx.db.query("skillStatEvents").collect();
  },
});

export const export_globalStats = query({
  handler: async (ctx) => {
    return await ctx.db.query("globalStats").collect();
  },
});

export const export_apiTokens = query({
  handler: async (ctx) => {
    return await ctx.db.query("apiTokens").collect();
  },
});

export const export_rateLimits = query({
  handler: async (ctx) => {
    return await ctx.db.query("rateLimits").collect();
  },
});

export const export_reservedSlugs = query({
  handler: async (ctx) => {
    return await ctx.db.query("reservedSlugs").collect();
  },
});

export const export_reservedHandles = query({
  handler: async (ctx) => {
    return await ctx.db.query("reservedHandles").collect();
  },
});

export const export_auditLogs = query({
  handler: async (ctx) => {
    return await ctx.db.query("auditLogs").collect();
  },
});

// Action that exports all tables at once for efficiency
export const exportAllData = action({
  handler: async (ctx): Promise<Record<string, unknown>> => {
    return {
      users: await ctx.runQuery(api.export.export_users),
      publishers: await ctx.runQuery(api.export.export_publishers),
      publisherMembers: await ctx.runQuery(api.export.export_publisherMembers),
      officialPublishers: await ctx.runQuery(api.export.export_officialPublishers),
      skills: await ctx.runQuery(api.export.export_skills),
      skillVersions: await ctx.runQuery(api.export.export_skillVersions),
      skillEmbeddings: await ctx.runQuery(api.export.export_skillEmbeddings),
      skillBadges: await ctx.runQuery(api.export.export_skillBadges),
      comments: await ctx.runQuery(api.export.export_comments),
      commentReports: await ctx.runQuery(api.export.export_commentReports),
      stars: await ctx.runQuery(api.export.export_stars),
      skillReports: await ctx.runQuery(api.export.export_skillReports),
      skillAppeals: await ctx.runQuery(api.export.export_skillAppeals),
      packages: await ctx.runQuery(api.export.export_packages),
      packageReleases: await ctx.runQuery(api.export.export_packageReleases),
      skillDailyStats: await ctx.runQuery(api.export.export_skillDailyStats),
      skillStatEvents: await ctx.runQuery(api.export.export_skillStatEvents),
      globalStats: await ctx.runQuery(api.export.export_globalStats),
      apiTokens: await ctx.runQuery(api.export.export_apiTokens),
      rateLimits: await ctx.runQuery(api.export.export_rateLimits),
      reservedSlugs: await ctx.runQuery(api.export.export_reservedSlugs),
      reservedHandles: await ctx.runQuery(api.export.export_reservedHandles),
      auditLogs: await ctx.runQuery(api.export.export_auditLogs),
    };
  },
});
