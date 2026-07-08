/**
 * Test doubles for `@warden/vcs`. The canonical in-memory `VcsProvider` fake lives in
 * `@warden/core/testing` (so every package can inject it without depending on `@warden/vcs`);
 * this module re-exports it so consumers already importing from `@warden/vcs` get it too.
 */
export {
  createFakeVcsProvider,
  type FakeVcsProvider,
  type FakeVcsProviderOptions,
  type FakeVcsCommentCall,
  type FakeVcsStatusCall,
  type FakeVcsLookupCall,
} from '@warden/core/testing';
