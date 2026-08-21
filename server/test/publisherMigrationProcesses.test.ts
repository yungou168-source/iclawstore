import { describe, expect, it } from "bun:test";
import { runPublisherAvatarAssetConsumerProcess } from "../src/publisherAvatarAssetConsumerProcess.js";
import { runPublisherCutoverReadinessProcess } from "../src/publisherCutoverReadinessProcess.js";
import { runPublisherMigrationPreflightProcess } from "../src/publisherMigrationPreflightProcess.js";
import { runPublisherReconciliationProcess } from "../src/publisherReconciliationProcess.js";
import {
  createAuthorizedPublisherConvexClient,
  runPublisherSyncProcess,
} from "../src/publisherSyncProcess.js";

describe("Publisher migration process entrypoints", () => {
  it("is import-safe and exposes explicit preflight and sync runners", () => {
    expect(runPublisherMigrationPreflightProcess).toBeInstanceOf(Function);
    expect(runPublisherCutoverReadinessProcess).toBeInstanceOf(Function);
    expect(runPublisherSyncProcess).toBeInstanceOf(Function);
    expect(runPublisherReconciliationProcess).toBeInstanceOf(Function);
    expect(runPublisherAvatarAssetConsumerProcess).toBeInstanceOf(Function);
    expect(createAuthorizedPublisherConvexClient).toBeInstanceOf(Function);
  });
});
