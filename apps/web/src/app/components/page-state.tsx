import type { ReactNode } from 'react';

import { BrandMark } from './brand-mark';
import { ThemeControl } from './theme-control';

interface PageStateProps {
  readonly title: string;
  readonly description: ReactNode;
  readonly icon?: ReactNode;
  readonly role?: 'alert' | 'status';
  readonly children?: ReactNode;
}

export function PageState({ title, description, icon, role, children }: PageStateProps) {
  return (
    <main className="mx-auto flex min-h-full max-w-xl flex-col justify-center px-6 py-8 text-center">
      <div className="mb-8 flex items-center justify-between">
        <BrandMark />
        <ThemeControl />
      </div>
      <div
        className="grid justify-items-center"
        role={role}
        aria-live={role === 'alert' ? 'assertive' : role === 'status' ? 'polite' : undefined}
      >
        {icon}
        <h1 className="mt-4 text-3xl leading-10 font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-base leading-6 text-muted-foreground">{description}</p>
      </div>
      {children ? <div className="mt-6 flex flex-wrap justify-center gap-3">{children}</div> : null}
    </main>
  );
}
