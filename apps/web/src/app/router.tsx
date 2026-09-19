import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';

import { DemoRoute } from './routes/demo-route';
import { HomeRoute } from './routes/home-route';
import { NotFoundRoute } from './routes/not-found-route';
import { RootLayout } from './routes/root-layout';
import { RouteError } from './routes/route-error';

const rootRoute = createRootRoute({
  component: RootLayout,
  errorComponent: RouteError,
  notFoundComponent: NotFoundRoute,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomeRoute,
});

const demoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/demo',
  component: DemoRoute,
});

const routeTree = rootRoute.addChildren([homeRoute, demoRoute]);

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
