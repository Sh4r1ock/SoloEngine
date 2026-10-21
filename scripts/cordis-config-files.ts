/** Cordis Loader configuration file discovery. */

import { globSync } from 'node:fs'

/**
 * Return repository-relative Cordis Loader YAML paths under `root`.
 *
 * Translation consistency records are YAML sidecars, never Loader inputs.
 *
 * @param root Repository root to scan.
 * @returns Sorted repository-relative Loader configuration paths.
 */
export function cordisConfigFiles(root: string): string[] {
  return globSync(['**/*cordis*.yml', '**/*cordis*.yaml'], {
    cwd: root,
    exclude: ['.claude/**', 'node_modules/**', 'vendor/**', '**/*.i18n.yaml',
      // Read-only upstream pool, local run workspaces, and the downloaded
      // third-party bundle cache are not part of the product tree.
      'deepseek_harness/**', 'data/**', 'test/**', 'soloengine-vendor/**'],
  }).sort()
}
