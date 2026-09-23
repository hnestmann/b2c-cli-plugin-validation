/*
 * Copyright (c) 2026, the b2c-plugin-validation authors.
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const fixturesDir = path.join(here, 'fixtures');

export function fixture(...parts: string[]): string {
  return path.join(fixturesDir, ...parts);
}
