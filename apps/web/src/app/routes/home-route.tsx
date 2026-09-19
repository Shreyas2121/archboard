import { Link } from '@tanstack/react-router';
import { ArrowRight, Database, GitBranch, Laptop } from 'lucide-react';

import { BrandMark } from '@/app/components/brand-mark';
import { Button } from '@/components/ui/button';

const FEATURES = [
  {
    title: 'Local by design',
    description: 'Your architecture workspace lives on this device.',
    icon: Database,
  },
  {
    title: 'Built for systems',
    description: 'Shape components, boundaries, data, and their relationships.',
    icon: GitBranch,
  },
  {
    title: 'No account required',
    description: 'Open the demo and start mapping without a sign-in step.',
    icon: Laptop,
  },
] as const;

export function HomeRoute() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[90rem] flex-col px-5 sm:px-8 lg:px-12">
      <header className="flex h-20 items-center justify-between border-b border-border/70">
        <Link
          className="flex items-center gap-2.5 text-sm font-semibold tracking-tight"
          to="/"
          aria-label="Archboard home"
        >
          <BrandMark />
          <span>Archboard</span>
        </Link>
        <Button asChild variant="outline">
          <Link to="/demo">Open local demo</Link>
        </Button>
      </header>
      <main>
        <section
          className="grid min-h-[38rem] content-center border-b border-border/70 py-20 lg:min-h-[43rem] lg:grid-cols-[minmax(0,56rem)_1fr]"
          aria-labelledby="hero-title"
        >
          <div>
            <p className="mb-5 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Architecture, made tangible
            </p>
            <h1
              id="hero-title"
              className="max-w-4xl text-balance text-5xl font-semibold leading-[0.96] tracking-[-0.055em] sm:text-7xl lg:text-[6rem]"
            >
              Think in systems.
              <br />
              See the whole board.
            </h1>
            <p className="mt-7 max-w-2xl text-pretty text-lg leading-8 text-muted-foreground sm:text-xl">
              A focused local workspace for drawing the software you have and the software you are
              building next.
            </p>
            <Button asChild size="default" className="mt-9 h-11 gap-2 px-4">
              <Link to="/demo">
                Enter the workspace <ArrowRight />
              </Link>
            </Button>
          </div>
          <div className="mt-14 hidden place-self-end lg:block" aria-hidden="true">
            <div className="grid size-52 rotate-3 grid-cols-2 gap-3 rounded-3xl border border-border bg-card p-5 shadow-2xl shadow-primary/10">
              <span className="rounded-xl bg-primary/12 ring-1 ring-primary/20" />
              <span className="rounded-xl bg-muted ring-1 ring-border" />
              <span className="col-span-2 rounded-xl bg-foreground/5 ring-1 ring-border" />
            </div>
          </div>
        </section>
        <section
          className="grid border-b border-border/70 md:grid-cols-3"
          aria-labelledby="features-title"
        >
          <h2 id="features-title" className="sr-only">
            Why Archboard
          </h2>
          {FEATURES.map((feature, index) => (
            <article
              className="relative min-h-64 border-b border-border/70 p-7 last:border-b-0 md:border-r md:border-b-0 md:last:border-r-0 lg:p-9"
              key={feature.title}
            >
              <span className="absolute right-7 top-7 font-mono text-xs text-muted-foreground">
                0{index + 1}
              </span>
              <feature.icon className="mb-12 size-6 text-primary" aria-hidden="true" />
              <h3 className="text-lg font-semibold tracking-tight">{feature.title}</h3>
              <p className="mt-2 max-w-xs leading-6 text-muted-foreground">{feature.description}</p>
            </article>
          ))}
        </section>
      </main>
      <footer className="flex items-center justify-between py-6 text-xs text-muted-foreground">
        <span>Local-first architecture workspace</span>
        <span>Phase 2</span>
      </footer>
    </div>
  );
}
