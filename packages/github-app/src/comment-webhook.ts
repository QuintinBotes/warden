import type { GateDecision, Principal, PrRef } from '@warden/core';
import { AuthzError, type GateOverrideHandler } from '@warden/enterprise';

/**
 * The slice of an `issue_comment` webhook payload the override handler reads. The real
 * `@octokit/webhooks` payload is a superset, so it is assignable to this shape.
 */
export interface IssueCommentEvent {
  action: string;
  installation?: { id: number };
  repository: {
    name: string;
    full_name: string;
    owner: { login: string };
  };
  issue: {
    number: number;
    // Present only when the comment is on a pull request (vs. a plain issue).
    pull_request?: { url?: string } | null;
  };
  comment: {
    body: string;
    user: { login: string };
  };
}

export type OverrideCommentOutcome =
  | 'ignored' // not a `created` comment
  | 'not-a-pull-request' // comment was on a plain issue
  | 'no-command' // body did not contain `/warden override <reason>`
  | 'unbound-identity' // commenter never linked their GitHub login to an OIDC identity
  | 'forbidden' // commenter lacks the required role
  | 'overridden';

export interface OverrideCommentResult {
  outcome: OverrideCommentOutcome;
  decision?: GateDecision;
}

export interface HandleOverrideCommentDeps {
  event: IssueCommentEvent;
  /** Injected from `@warden/enterprise` (`createGateOverrideHandler`). */
  overrideHandler: GateOverrideHandler;
  /**
   * GitHub login -> the bound OIDC principal, or `null` when the login was never linked via a
   * prior dashboard login. A comment author is NOT automatically a principal — this binding is
   * what prevents a spoofed comment from self-service overriding a gate.
   */
  resolvePrincipal: (login: string) => Promise<Principal | null>;
  /** Resolve the full {@link PrRef} (head sha/ref) for the PR the comment is on. */
  loadPrRef: (loc: { owner: string; repo: string; number: number }) => Promise<PrRef>;
  /** The current gate decision for the PR (the `BLOCK` being overridden). */
  loadGateDecision: (pr: PrRef) => Promise<GateDecision>;
  /** Post a reply comment back on the PR. */
  reply: (loc: { owner: string; repo: string; number: number }, message: string) => Promise<void>;
}

/** `/warden override <reason>` or `/warden override: <reason>`, case-insensitive, anywhere in the body. */
const OVERRIDE_COMMAND = /^\s*\/warden\s+override:?\s+(.+?)\s*$/im;

/** Extract the override reason from a comment body, or `null` if it is not an override command. */
export function parseOverrideCommand(body: string): string | null {
  const match = OVERRIDE_COMMAND.exec(body);
  return match && match[1] ? match[1].trim() : null;
}

/**
 * Handle a `/warden override <reason>` PR comment: bind the commenter to a {@link Principal},
 * then delegate to the injected {@link GateOverrideHandler} (which runs the RBAC check first).
 * An unbound commenter or an under-privileged one gets a clear reply and no override.
 */
export async function handleOverrideComment(
  deps: HandleOverrideCommentDeps,
): Promise<OverrideCommentResult> {
  const { event } = deps;
  if (event.action !== 'created') return { outcome: 'ignored' };
  if (!event.issue.pull_request) return { outcome: 'not-a-pull-request' };

  const reason = parseOverrideCommand(event.comment.body);
  if (!reason) return { outcome: 'no-command' };

  const loc = {
    owner: event.repository.owner.login,
    repo: event.repository.name,
    number: event.issue.number,
  };

  const principal = await deps.resolvePrincipal(event.comment.user.login);
  if (!principal) {
    await deps.reply(
      loc,
      'Warden could not verify your identity. Sign in to the Warden dashboard once to link your ' +
        'GitHub account before using `/warden override`.',
    );
    return { outcome: 'unbound-identity' };
  }

  const pr = await deps.loadPrRef(loc);
  const decision = await deps.loadGateDecision(pr);

  try {
    const amended = await deps.overrideHandler.override({ principal, pr, decision, reason });
    return { outcome: 'overridden', decision: amended };
  } catch (err) {
    if (err instanceof AuthzError) {
      await deps.reply(loc, `You need \`${err.required}\` access to override this gate.`);
      return { outcome: 'forbidden' };
    }
    throw err;
  }
}
