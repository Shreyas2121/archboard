import { useEffect, useState } from 'react';

const NARROW_SCREEN_QUERY = '(max-width: 767px)';

export function useNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_SCREEN_QUERY).matches);

  useEffect(() => {
    const media = window.matchMedia(NARROW_SCREEN_QUERY);
    const synchronize = (): void => setNarrow(media.matches);
    synchronize();
    media.addEventListener('change', synchronize);
    return () => media.removeEventListener('change', synchronize);
  }, []);

  return narrow;
}
