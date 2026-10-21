import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { defineRouteMiddleware } from '@astrojs/starlight/route-data';

const LINK = 'src/content/docs/';
const EDIT_BASE = 'https://github.com/ewels/EELSdb/edit/rewrite/docs/';

// The pages live in the repo's top-level docs/ folder, which src/content/docs links to. Git and GitHub do not
// follow that link, so point the edit link and the last-updated date at the real file.
export const onRequest = defineRouteMiddleware(({ locals }) => {
  const route = locals.starlightRoute;
  const file = route.entry.filePath;
  // Starlight's own 404 page reports a file that does not exist.
  if (!file?.startsWith(LINK) || !existsSync(file)) return;
  const relative = file.slice(LINK.length);
  route.editUrl = new URL(relative, EDIT_BASE);
  const log = spawnSync('git', ['log', '--max-count=1', '--format=%ct', '--', realpathSync(file)], { encoding: 'utf-8' });
  const seconds = Number(log.stdout?.trim());
  route.lastUpdated = seconds ? new Date(seconds * 1000) : undefined;
});
