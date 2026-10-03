import { useEffect, useState } from 'react';
import type { CodeContent } from '@archboard/contracts';
import type { ThemedToken } from 'shiki/types';

import { useTheme } from '@/app/theme/theme-provider';
import { highlightScheduler, MAX_HIGHLIGHT_CHARACTERS } from './highlight-scheduler';

interface HighlightedCodeProps {
  readonly code: string;
  readonly language: CodeContent['language'];
}

export function HighlightedCode({ code, language }: HighlightedCodeProps) {
  const { resolvedTheme } = useTheme();
  const highlightKey = `${resolvedTheme}:${language}:${code}`;
  const [highlight, setHighlight] = useState<{
    readonly key: string;
    readonly lines: readonly (readonly ThemedToken[])[];
  }>({ key: '', lines: [] });

  useEffect(() => {
    let active = true;
    if (code.length === 0 || code.length > MAX_HIGHLIGHT_CHARACTERS) return;
    const cancel = highlightScheduler.schedule(async () => {
      await import('shiki/bundle/web')
        .then(({ codeToTokens }) =>
          active
            ? codeToTokens(code, {
                lang: language,
                theme: resolvedTheme === 'dark' ? 'github-dark-default' : 'github-light-default',
              })
            : null,
        )
        .then((result) => {
          if (active && result !== null) setHighlight({ key: highlightKey, lines: result.tokens });
        })
        .catch(() => {
          if (active) setHighlight({ key: highlightKey, lines: [] });
        });
    });
    return () => {
      active = false;
      cancel?.();
    };
  }, [code, highlightKey, language, resolvedTheme]);

  if (code.length === 0) return <span className="text-muted-foreground">No code yet</span>;
  if (highlight.key !== highlightKey || highlight.lines.length === 0) return <>{code}</>;
  return highlight.lines.map((line, lineIndex) => (
    <span className="block min-h-[18px]" key={lineIndex}>
      {line.map((token, tokenIndex) => (
        <span
          // Shiki supplies theme-derived token colors; user content remains React text.
          style={{ color: token.color }}
          key={`${lineIndex}-${tokenIndex}`}
        >
          {token.content}
        </span>
      ))}
    </span>
  ));
}
