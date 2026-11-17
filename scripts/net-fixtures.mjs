// Recorded server answers for checking plugins with network access (#280): plugins/<name>/net-fixtures.json or
// plugins/<name>/test/net-fixtures.json lists { host, path, match?, status?, contentType?, file } with files relative
// to the fixtures file. Returns the answers for checkPlugin, or [] without a fixtures file.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function loadNetFixtures(dir) {
  const f = [join(dir, 'net-fixtures.json'), join(dir, 'test', 'net-fixtures.json')].find((x) => existsSync(x));
  if (!f) return [];
  const { answers } = JSON.parse(readFileSync(f, 'utf8'));
  return answers.map(({ file, ...a }) => ({ ...a, text: readFileSync(join(dirname(f), file), 'utf8') }));
}
