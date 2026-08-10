export type WorkflowStepTemplate = {
  stepKey: string;
  metadata?: Record<string, unknown>;
};

export type WorkflowTemplate = {
  workflowKey: string;
  workflowVersion: string;
  steps: WorkflowStepTemplate[];
};

export type OutboxEvent = {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
};

const employmentLifecycleTemplates: Record<string, WorkflowTemplate> = {
  onboarding: {
    workflowKey: "employment.onboarding",
    workflowVersion: "v1",
    steps: [
      { stepKey: "employment.context.prepare" },
      { stepKey: "employment.capabilities.resolve" },
    ],
  },
  active: {
    workflowKey: "employment.activation",
    workflowVersion: "v1",
    steps: [{ stepKey: "employment.activation.publish" }],
  },
  paused: {
    workflowKey: "employment.pause",
    workflowVersion: "v1",
    steps: [{ stepKey: "employment.access.suspend" }],
  },
  offboarding: {
    workflowKey: "employment.offboarding",
    workflowVersion: "v1",
    steps: [{ stepKey: "employment.access.review" }],
  },
  terminated: {
    workflowKey: "employment.termination",
    workflowVersion: "v1",
    steps: [{ stepKey: "employment.access.revoke" }],
  },
};

export function resolveWorkflowTemplate(event: OutboxEvent): WorkflowTemplate | null {
  if (event.eventType === "employment.transition.v1") {
    const targetStatus = event.payload.to;
    return typeof targetStatus === "string"
      ? (employmentLifecycleTemplates[targetStatus] ?? null)
      : null;
  }

  if (event.eventType === "capability.granted.v1") {
    return {
      workflowKey: "capability.propagation",
      workflowVersion: "v1",
      steps: [{ stepKey: "capability.apply" }],
    };
  }

  return null;
}
