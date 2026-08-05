import { FastifyInstance } from "fastify";
import type { ManagedAssetStore } from "../services/managedAssetStore.js";
import { clearProviderRuntime, loadProviderRuntime } from "../services/providerRuntime.js";
import { createAiDirectAppearanceRoutes } from "./aiDirectAppearance.js";
import { aiDirectApprovalsRoutes } from "./aiDirectApprovals.js";
import { aiDirectCapabilitiesRoutes } from "./aiDirectCapabilities.js";
import { aiDirectCompaniesRoutes } from "./aiDirectCompanies.js";
import { createAiDirectCredentialRoutes } from "./aiDirectCredentials.js";
import { aiDirectEmploymentsRoutes } from "./aiDirectEmployments.js";
import { aiDirectJobsRoutes } from "./aiDirectJobs.js";
import { aiDirectOffersRoutes } from "./aiDirectOffers.js";
import { aiDirectOrganizationsRoutes } from "./aiDirectOrganizations.js";
import { aiDirectRuntimeAdminRoutes } from "./aiDirectRuntimeAdmin.js";
import { aiDirectSessionRoutes } from "./aiDirectSession.js";
import { aiDirectWorkersRoutes } from "./aiDirectWorkers.js";

export function createAiDirectCoreRoutes(assetStore?: ManagedAssetStore) {
  return async function aiDirectCoreRoutes(fastify: FastifyInstance): Promise<void> {
    const providerRuntime = loadProviderRuntime((fastify as any).mysql);
    if (providerRuntime) {
      fastify.addHook("onClose", async () => clearProviderRuntime(providerRuntime));
      await fastify.register(createAiDirectCredentialRoutes(providerRuntime));
    }
    await fastify.register(aiDirectSessionRoutes);
    await fastify.register(aiDirectOrganizationsRoutes);
    await fastify.register(aiDirectCompaniesRoutes);
    await fastify.register(aiDirectOffersRoutes);
    await fastify.register(aiDirectEmploymentsRoutes);
    await fastify.register(aiDirectApprovalsRoutes);
    await fastify.register(aiDirectCapabilitiesRoutes);
    await fastify.register(aiDirectJobsRoutes);
    await fastify.register(aiDirectRuntimeAdminRoutes);
    await fastify.register(aiDirectWorkersRoutes);
    if (assetStore) {
      await fastify.register(createAiDirectAppearanceRoutes(assetStore));
    }
  };
}

export const aiDirectCoreRoutes = createAiDirectCoreRoutes();
