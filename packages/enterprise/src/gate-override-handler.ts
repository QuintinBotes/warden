import type { AuditSink, GateDecision, GitHubAccess, Principal, PrRef, Role } from '@warden/core';
import { requireRole } from './rbac-guard.js';

export interface GateOverrideInput {
  principal: Principal;
  pr: PrRef;
  decision: GateDecision;
  reason: string;
}

export interface GateOverrideHandler {
  /** Amended decision, audited, check-run flipped. Throws `AuthzError` for an under-privileged principal. */
  override(input: GateOverrideInput): Promise<GateDecision>;
}

export interface GateOverrideHandlerDeps {
  requiredRole: Role;
  auditSink: AuditSink;
  gh: GitHubAccess; // reused from the @warden/core coverage-sync contract
}

/** `org/repo#123` — the audit `resource.id` convention for a pull request. */
function prResourceId(pr: PrRef): string {
  return `${pr.owner}/${pr.repo}#${pr.number}`;
}

/**
 * Overrides a blocked gate: checks the role FIRST (fail-closed, no partial side effects),
 * amends the {@link GateDecision} with the override trail, flips the PR's check-run to
 * `success`, and appends a `gate.override` audit event.
 */
export function createGateOverrideHandler(deps: GateOverrideHandlerDeps): GateOverrideHandler {
  return {
    async override(input): Promise<GateDecision> {
      // Fail closed: the role check runs before any check-run flip or audit write.
      requireRole(input.principal, deps.requiredRole);

      const amended: GateDecision = {
        ...input.decision,
        overridden: true,
        overriddenBy: input.principal.subject,
        overrideReason: input.reason,
      };

      await deps.gh.postCheckRun(
        input.pr,
        'success',
        'Warden gate overridden',
        `Overridden by ${input.principal.email || input.principal.subject}: ${input.reason}`,
      );

      await deps.auditSink.record({
        tenant: input.principal.tenant,
        actor: { subject: input.principal.subject, email: input.principal.email },
        action: 'gate.override',
        resource: { type: 'pull_request', id: prResourceId(input.pr) },
        detail: input.reason,
        metadata: { previousDecision: input.decision.decision },
      });

      return amended;
    },
  };
}
