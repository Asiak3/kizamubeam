import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// The manual is hosted next to the product website on GitHub Pages:
//   https://negurvulkan.github.io/kizamubeam/docs/
// Both values can be overridden at build time (empty values are ignored), so moving the manual to its own
// domain later (e.g. https://docs.kizamubeam.com/) needs no code change:
//   DOCS_URL=https://docs.kizamubeam.com DOCS_BASE_URL=/ npm run build
const url = process.env.DOCS_URL || 'https://negurvulkan.github.io';
const baseUrl = process.env.DOCS_BASE_URL || '/kizamubeam/docs/';
// Product website, used for links back to it (download page etc.).
const website = process.env.WEBSITE_URL || 'https://negurvulkan.github.io/kizamubeam/';

const repo = 'https://github.com/negurvulkan/kizamubeam';
const discord = 'https://discord.gg/SSr8VHh7EJ';

const config: Config = {
  title: 'KizamuBeam Manual',
  tagline: 'Design, engrave, cut. Free laser software for macOS, Windows and Linux.',
  favicon: 'img/favicon.ico',

  url,
  baseUrl,

  organizationName: 'negurvulkan',
  projectName: 'kizamubeam',

  onBrokenLinks: 'throw',
  onBrokenAnchors: 'warn',

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'de', 'it'],
    localeConfigs: {
      en: {label: 'English', htmlLang: 'en'},
      de: {label: 'Deutsch', htmlLang: 'de'},
      it: {label: 'Italiano', htmlLang: 'it'},
    },
  },

  presets: [
    [
      'classic',
      {
        docs: {
          // Docs-only site: the manual starts at the base URL.
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl: ({locale, docPath}) =>
            locale === 'en'
              ? `${repo}/edit/main/manual/docs/${docPath}`
              : `${repo}/edit/main/manual/i18n/${locale}/docusaurus-plugin-content-docs/current/${docPath}`,
          showLastUpdateTime: false,
          // Versioning: the working copy is the manual for the current major
          // release. Before a new major release, freeze it with
          // `npm run docusaurus docs:version 2.x` (see README.md).
          lastVersion: 'current',
          versions: {
            current: {label: '2.x'},
          },
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themes: [
    '@docusaurus/theme-mermaid',
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        language: ['en', 'de', 'it'],
        docsRouteBasePath: '/',
        indexBlog: false,
        highlightSearchTermsOnTargetPage: true,
        explicitSearchResultPath: true,
      },
    ],
  ],

  themeConfig: {
    image: 'img/og-image.png',
    colorMode: {
      defaultMode: 'light',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'KizamuBeam',
      logo: {
        alt: 'KizamuBeam',
        src: 'img/logo.webp',
        srcDark: 'img/logo-dark.webp',
      },
      items: [
        {type: 'docSidebar', sidebarId: 'manual', position: 'left', label: 'Manual'},
        {type: 'docsVersionDropdown', position: 'right'},
        {type: 'localeDropdown', position: 'right'},
        {href: website, label: 'Website', position: 'right'},
        {href: repo, label: 'GitHub', position: 'right'},
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Manual',
          items: [
            {label: 'Getting started', to: '/getting-started/installation'},
            {label: 'Keyboard shortcuts', to: '/reference/keyboard-shortcuts'},
            {label: 'Contributing to the manual', to: '/contributing'},
          ],
        },
        {
          title: 'KizamuBeam',
          items: [
            {label: 'Website', href: website},
            {label: 'Download', href: `${repo}/releases`},
          ],
        },
        {
          title: 'Community',
          items: [
            {label: 'Discord', href: discord},
            {label: 'GitHub', href: repo},
            {label: 'Report an issue', href: `${repo}/issues`},
          ],
        },
      ],
      copyright:
        '© 2026 Hanjo Winter · Free software under GPL-3.0-or-later · Developed with assistance from Claude Code.',
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['powershell'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
