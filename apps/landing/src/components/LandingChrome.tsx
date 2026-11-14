import { IconArrowRight, IconBrandGithub } from '@tabler/icons-react';
import {
  Button,
  LandingFooter as KitLandingFooter,
  ProductHero,
  ProductHeroOrbit,
  SiteHeader,
} from '@vvedantb/ui';
import { NAV_LINKS } from '../content';
import { DOCS_URL, GITHUB_URL } from '../links';
import { LandingCta as KitLandingCta } from './kit';
import { ThemeToggle } from './ThemeToggle';
import { Wordmark } from './Wordmark';

const github = { href: GITHUB_URL, label: 'Redline on GitHub', icon: <IconBrandGithub size={18} /> };

export function LandingNav() {
  return (
    <SiteHeader
      brand={<Wordmark />}
      homeHref="#top"
      homeLabel="Redline, back to top"
      links={NAV_LINKS}
      githubUrl={GITHUB_URL}
      githubLabel="Redline on GitHub"
      actions={<ThemeToggle />}
      cta={
        <Button asChild size="sm" className="rounded-full">
          <a href={DOCS_URL} target="_blank" rel="noreferrer">
            Install
            <IconArrowRight size={14} aria-hidden />
          </a>
        </Button>
      }
    />
  );
}

export function LandingHero() {
  return (
    <ProductHero
      title="See what changed. On every page."
      tagline="Redline builds two commits, screenshots each page, and outlines changed elements in your running app. Dev-only, local, no backend."
      primaryCta={{ label: 'Install', href: DOCS_URL, target: '_blank', rel: 'noreferrer' }}
      secondaryCta={{ label: 'View on GitHub', href: GITHUB_URL, target: '_blank', rel: 'noreferrer' }}
      visual={<ProductHeroOrbit accent="var(--redline)" />}
      showProductOf={false}
    />
  );
}

export function LandingCta() {
  return (
    <KitLandingCta
      title="Add Redline to your project"
      description="Install the package, run redline compare, and read the report."
      action={
        <Button asChild size="lg" className="sm:min-w-40">
          <a href={DOCS_URL} target="_blank" rel="noreferrer">
            Read the docs
            <IconArrowRight size={16} aria-hidden />
          </a>
        </Button>
      }
    />
  );
}

export function LandingFooter() {
  return (
    <KitLandingFooter
      brand={<Wordmark />}
      tagline="Built for local dev. No backend, no auth."
      links={NAV_LINKS}
      github={github}
    />
  );
}
