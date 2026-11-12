// Was die Oberfläche beim Laden erwartet, für Node nachgebildet
const g = globalThis as Record<string, unknown>;
// The tests expect the German UI texts. Node 21+ has its own navigator with the system language,
// so set the language on it instead of only creating a navigator when there is none.
const lang = { language: 'de', languages: ['de'] };
if (g.navigator) for (const [key, value] of Object.entries(lang)) Object.defineProperty(g.navigator, key, { value, configurable: true });
else g.navigator = lang;
g.localStorage = { getItem: () => null, setItem() {} };
g.window ??= globalThis;
g.document ??= { createElement: () => ({ getContext: () => null, style: {} }), documentElement: { lang: 'de', dataset: {} } };
