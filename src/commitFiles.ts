import { info, warning, error, getInput } from '@actions/core';
import simpleGit, { Response } from 'simple-git';
import path from 'path';

const baseDir = path.join(process.cwd(), getInput('cwd') || '');
const git = simpleGit({ baseDir });

export async function commitFiles(files: string[]): Promise<void> {
  info(`Committing files to Git running in dir ${baseDir}`);

  const eventPath = process.env.GITHUB_EVENT_PATH,
    event = eventPath && require(eventPath),
    isPR = process.env.GITHUB_EVENT_NAME?.includes('pull_request'),
    defaultBranch = isPR
      ? (event?.pull_request?.head?.ref as string)
      : process.env.GITHUB_REF?.substring(11);

  const branch = defaultBranch || '';
  if (isPR) info(`> Running for a PR, the action will use '${branch}' as ref.`);

  let commitMessage = getInput('commit_message', { required: false });
  if (commitMessage.length === 0)
    commitMessage = 'chore(pipeline updates): [skip ci]';

  const name = getInput('author_name', { required: true }).trim();
  const email = getInput('author_email', { required: true }).trim();
  await configGit(name, email);

  await add(files);

  info('Checking for changes...');
  const changedFiles = (await git.diffSummary(['--cached'])).files.length;
  if (changedFiles > 0) {
    info(`> Found ${changedFiles} changed files`);

    info('Creating commit...');
    await git.commit(commitMessage, undefined, {}, log);

    await git.fetch(['--tags', '--force'], log);

    info('> Switching/creating branch...');
    await git
      .checkout(branch, undefined, log)
      .catch(() => git.checkoutLocalBranch(branch, log));

    info('> Pulling from remote...');
    await git.fetch(undefined, log).pull(undefined, undefined, undefined, log);

    info('> Re-staging files...');
    await add(files, { ignoreErrors: true });

    info('> Creating commit...');
    await git.commit(
      commitMessage,
      undefined,
      {
        '--author': `"${name} <${email}>"`,
        ...{},
      },
      log,
    );

    info('> Pushing commit to repo...');
    await git.push('origin', branch, { '--set-upstream': null }, log);

    info('> Task completed.');
  }
}

async function configGit(name: string, email: string): Promise<void> {
  await git
    .addConfig('user.email', email, undefined, log)
    .addConfig('user.name', name, undefined, log);

  info(
    'Current git config\n' +
      JSON.stringify((await git.listConfig()).all, null, 2),
  );
}

async function add(
  files: string[],
  { logWarning = true, ignoreErrors = false } = {},
): Promise<void | Response<void>> {
  info(`Adding ${files.length} files`);

  return git
    .add(files, (
      e: any, // eslint-disable-line @typescript-eslint/no-explicit-any
      d?: any, // eslint-disable-line @typescript-eslint/no-explicit-any
    ) => (ignoreErrors ? null : info(`${e}: ${d ?? ''}`)))
    .catch((e: Error) => {
      if (ignoreErrors) return;

      if (
        e.message.includes('fatal: pathspec') &&
        e.message.includes('did not match any files')
      ) {
        logWarning && warning('Add command did not match any file.');
      } else {
        throw e;
      }
    });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function log(err: any | Error, data?: any) {
  if (data) console.log(data);
  if (err) error(err);
}
