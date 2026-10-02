// Refuses a deployable build while the real household profile is present.
//
// `src/data/profiles/local.ts` holds real balances, income and debts. It's
// gitignored, but the profile loader bundles it whenever the file exists, so a
// build from a machine that has it would publish it. Cloudflare builds from
// GitHub, where the file never exists, so this check only ever fails locally.
// To check a build with your own numbers, run `npm run build:local`, which
// writes to `dist-local/` instead of the deploy folder.
import { existsSync } from 'node:fs';

const localProfile = new URL('../src/data/profiles/local.ts', import.meta.url);

if (existsSync(localProfile)) {
  console.error(
    '\nRefusing to build: src/data/profiles/local.ts is present, so this build\n' +
      'would bundle real financial data into dist/.\n\n' +
      '  - To deploy, push to GitHub and let Cloudflare build it. The file is absent there.\n' +
      '  - To check a build with your own numbers, run `npm run build:local`,\n' +
      '    which writes to dist-local/ and is never deployed.\n',
  );
  process.exit(1);
}
