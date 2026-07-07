/**
 * Minimal shapes of the `@octokit/rest` client this package calls into. Reporters accept
 * anything structurally compatible so tests can inject a plain mock instead of a real
 * `Octokit` instance — no live GitHub, ever, in unit tests.
 */
export interface OctokitIssuesClient {
  issues: {
    createComment(params: {
      owner: string;
      repo: string;
      issue_number: number;
      body: string;
    }): Promise<unknown>;
  };
}

export interface CheckRunAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'notice' | 'warning' | 'failure';
  message: string;
  title?: string;
}

export interface OctokitChecksClient {
  checks: {
    create(params: {
      owner: string;
      repo: string;
      name: string;
      head_sha: string;
      status: 'completed';
      conclusion: 'success' | 'neutral' | 'failure';
      output: {
        title: string;
        summary: string;
        annotations?: CheckRunAnnotation[];
      };
    }): Promise<unknown>;
  };
}
