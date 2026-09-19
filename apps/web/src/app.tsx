import { RouterProvider } from '@tanstack/react-router';

import { router } from './app/router.js';

export function App() {
  return <RouterProvider router={router} />;
}
