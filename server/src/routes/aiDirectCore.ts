import { FastifyInstance } from "fastify";
import type { ArtifactStore } from "../services/artifactStore.js";
import type { ManagedAssetStore } from "../services/managedAssetStore.js";
import { clearProviderRuntime, loadProviderRuntime } from "../services/providerRuntime.js";
import { aiDirectAgentPublicationRoutes } from "./aiDirectAgentPublication.js";
import { createAiDirectAppearanceRoutes } from "./aiDirectAppearance.js";
import { aiDirectApprovalsRoutes } from "./aiDirectApprovals.js";
import { aiDirectAuditRoutes } from "./aiDirectAudit.js";
import { aiDirectCandidateCatalogRoutes } from "./aiDirectCandidateCatalog.js";
import { aiDirectCandidateMatchingRoutes } from "./aiDirectCandidateMatching.js";
import { aiDirectCapabilitiesRoutes } from "./aiDirectCapabilities.js";
import { aiDirectCompaniesRoutes } from "./aiDirectCompanies.js";
import { createAiDirectCredentialRoutes } from "./aiDirectCredentials.js";
import { aiDirectEmploymentsRoutes } from "./aiDirectEmployments.js";
import { aiDirectInterviewRoutes } from "./aiDirectInterviews.js";
import { createAiDirectJobsRoutes } from "./aiDirectJobs.js";
import { aiDirectManagementInsightsRoutes } from "./aiDirectManagementInsights.js";
import { aiDirectOffersRoutes } from "./aiDirectOffers.js";
import { aiDirectOrganizationsRoutes } from "./aiDirectOrganizations.js";
import { aiDirectPaidHiringRoutes } from "./aiDirectPaidHiring.js";
import { aiDirectRuntimeAdminRoutes } from "./aiDirectRuntimeAdmin.js";
import { aiDirectSessionRoutes } from "./aiDirectSession.js";
import { aiDirectWalletRoutes } from "./aiDirectWallet.js";
import { aiDirectWorkersRoutes } from "./aiDirectWorkers.js";
import { aiDirectWorkforceRoutes } from "./aiDirectWorkforce.js";
import { friendlyLinksRoutes } from "./friendlyLinks.js";

export function createAiDirectCoreRoutes(
  assetStore?: ManagedAssetStore,
  artifactStore?: ArtifactStore,
) {
  return async function aiDirectCoreRoutes(fastify: FastifyInstance): Promise<void> {
    const providerRuntime = loadProviderRuntime((fastify as any).mysql);
    if (providerRuntime) {
      fastify.addHook("onClose", async () => clearProviderRuntime(providerRuntime));
      await fastify.register(createAiDirectCredentialRoutes(providerRuntime));
    }
    await fastify.register(aiDirectSessionRoutes);
    await fastify.register(friendlyLinksRoutes);
    await fastify.register(aiDirectAgentPublicationRoutes);
    await fastify.register(aiDirectCandidateCatalogRoutes);
    await fastify.register(aiDirectCandidateMatchingRoutes);
    await fastify.register(aiDirectOrganizationsRoutes);
    await fastify.register(aiDirectCompaniesRoutes);
    await fastify.register(aiDirectWorkforceRoutes);
    await fastify.register(aiDirectPaidHiringRoutes);
    await fastify.register(aiDirectWalletRoutes);
    await fastify.register(aiDirectOffersRoutes);
    await fastify.register(aiDirectEmploymentsRoutes);
    await fastify.register(aiDirectInterviewRoutes);
    await fastify.register(aiDirectApprovalsRoutes);
    await fastify.register(aiDirectManagementInsightsRoutes);
    await fastify.register(aiDirectAuditRoutes);
    await fastify.register(aiDirectCapabilitiesRoutes);
    await fastify.register(createAiDirectJobsRoutes(artifactStore));
    await fastify.register(aiDirectRuntimeAdminRoutes);
    await fastify.register(aiDirectWorkersRoutes);
    if (assetStore) {
      await fastify.register(createAiDirectAppearanceRoutes(assetStore));
    }
  };
}

export const aiDirectCoreRoutes = createAiDirectCoreRoutes();
