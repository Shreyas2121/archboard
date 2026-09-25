import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';

import { DemoRoute } from './routes/demo-route';
import { BoardsEntryRoute } from './routes/boards-entry-route';
import { HomeRoute } from './routes/home-route';
import { NotFoundRoute } from './routes/not-found-route';
import { RootLayout } from './routes/root-layout';
import { RouteError } from './routes/route-error';
import { safeReturnPath } from '@/features/auth';

const rootRoute = createRootRoute({
  component: RootLayout,
  errorComponent: RouteError,
  notFoundComponent: NotFoundRoute,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: (search: Record<string, unknown>): { returnTo?: '/boards' } => {
    const returnTo = safeReturnPath(search.returnTo);
    return returnTo ? { returnTo } : {};
  },
  component: HomeRoute,
});

const boardsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/boards',
  component: BoardsEntryRoute,
});

const demoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/demo',
  component: DemoRoute,
});

const routeTree = rootRoute.addChildren([homeRoute, boardsRoute, demoRoute]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
