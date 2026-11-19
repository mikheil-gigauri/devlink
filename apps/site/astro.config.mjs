// The project website (ADR 0011): a landing page of its own, and Starlight for the docs.
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

const repo = 'https://github.com/mikheil-gigauri/devlink';

export default defineConfig({
  site: 'https://mikheil-gigauri.github.io',
  base: '/devlink',
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'devlink',
      description:
        'Test unreleased npm libraries inside real consumer apps, installed the way they will be released.',
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: repo }],
      editLink: { baseUrl: `${repo}/edit/main/apps/site/` },
      customCss: [
        '@fontsource-variable/schibsted-grotesk',
        '@fontsource-variable/martian-mono',
        './src/styles/theme.css',
      ],
      sidebar: [
        {
          label: 'Guides',
          items: [
            { label: 'Getting started', link: '/guides/getting-started/' },
            { label: 'How it works', link: '/guides/how-it-works/' },
            { label: 'Package managers', link: '/guides/package-managers/' },
            { label: 'Frameworks and caches', link: '/guides/frameworks/' },
            { label: 'Menu bar app', link: '/guides/menu-bar/' },
            { label: 'The commit guard', link: '/guides/commit-guard/' },
            { label: 'Troubleshooting', link: '/guides/troubleshooting/' },
            { label: 'Compared with npm link and yalc', link: '/guides/comparison/' },
          ],
        },
        { label: 'Reference', items: [{ label: 'CLI', link: '/reference/cli/' }] },
        { label: 'Design decisions', items: [{ autogenerate: { directory: 'design' } }] },
      ],
    }),
  ],
});
