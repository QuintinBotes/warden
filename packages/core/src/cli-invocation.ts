/**
 * How Warden names its own CLI to anything that shells out to it: the GitHub Action, the
 * workflow `warden init` scaffolds, and the commands in the docs.
 *
 * The rule is one line long: **never hand a package manager the bare name `warden`.** On
 * npm that name belongs to an unrelated package published in 2014 ("A wrapper for
 * Panopticon", latest 0.1.1) which declares no `bin`. `npx warden analyze …` therefore
 * downloads a stranger's tarball and exits with "could not determine executable to run" —
 * a third-party download where the user asked for Warden, and an error naming nothing they
 * can act on. Naming the scoped package makes the resolution unambiguous, and while
 * `@warden/cli` is unpublished it turns that silent substitution into a plain 404 for a
 * package the reader can look up.
 *
 * Nothing here claims `@warden/cli` is installable from npm today; it is not (see
 * docs/cli.md, "Installing"). This module only guarantees that when it is, the name that
 * resolves is Warden's.
 */

/** The npm package that contains the CLI. `warden`, unscoped, is somebody else's package. */
export const CLI_PACKAGE = '@warden/cli';

/** The executable {@link CLI_PACKAGE} installs. */
export const CLI_BIN = 'warden';

/** The launcher every generated CLI call uses. */
export const CLI_LAUNCHER = 'npx';

/**
 * argv for {@link CLI_LAUNCHER} that runs `warden <subcommand…>` out of {@link CLI_PACKAGE}.
 *
 * `--yes` because a CI runner has no TTY on which to answer npx's install prompt, and `--`
 * because without it npx claims leading flags (`--base`, `--grep`) as its own.
 */
export function cliLauncherArgs(subcommand: string[]): string[] {
  return ['--yes', `--package=${CLI_PACKAGE}`, '--', CLI_BIN, ...subcommand];
}

/**
 * The same call as a shell prefix, for generated workflow steps and documentation:
 * `npx --yes --package=@warden/cli -- warden`. Append the subcommand and its flags.
 */
export const CLI_COMMAND_PREFIX = `${CLI_LAUNCHER} --yes --package=${CLI_PACKAGE} -- ${CLI_BIN}`;
