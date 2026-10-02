import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';

import { DemoRoute } from './routes/demo-route';
import { BoardsEntryRoute } from './routes/boards-entry-route';
import { BoardEditorRoute } from './routes/board-editor-route';
import { HomeRoute } from './routes/home-route';
import { NotFoundRoute } from './routes/not-found-route';
import { RootLayout } from './routes/root-layout';
import { RouteError } from './routes/route-error';
import { safeReturnPath } from '@/features/auth';
import type { AuthReturnPath } from '@/features/auth/return-path';
import { InviteRoute } from './routes/invite-route';
import { CheckpointRoute } from './routes/checkpoint-route';

const rootRoute = createRootRoute({
  component: RootLayout,
  errorComponent: RouteError,
  notFoundComponent: NotFoundRoute,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: (search: Record<string, unknown>): { returnTo?: AuthReturnPath } => {
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

const boardEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/boards/$boardId',
  component: BoardEditorRoute,
});

const demoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/demo',
  component: DemoRoute,
});

const checkpointRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/boards/$boardId/checkpoints/$checkpointId',
  component: CheckpointRoute,
});

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite/$token',
  component: InviteRoute,
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  boardsRoute,
  boardEditorRoute,
  checkpointRoute,
  demoRoute,
  inviteRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
  // Scroll restoration is durable. Exclude bearer paths and continuation queries from its keys.
  getScrollRestorationKey: (location) =>
    location.pathname.startsWith('/invite/') ? '/invite/:redacted' : location.pathname,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
