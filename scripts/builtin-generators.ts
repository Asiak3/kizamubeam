// Register the generators that come with the app from their source, for Node tests that compute without plugins.
// In the app they are plugins of the core pack (src/plugins/core.ts); scripts/core-plugins-test.ts checks that both
// give the same results.
import { register } from '../src/generators/index';
import { BUILTIN_GENERATORS } from '../src/generators/builtin';

for (const g of BUILTIN_GENERATORS) register(g);
