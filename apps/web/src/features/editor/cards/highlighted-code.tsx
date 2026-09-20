import { useEffect, useState } from 'react';
import type { CodeContent } from '@archboard/contracts';
import type { ThemedToken } from 'shiki/types';

import { useTheme } from '@/app/theme/theme-provider';

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
    void import('shiki/bundle/web')
      .then(({ codeToTokens }) =>
        codeToTokens(code, {
          lang: language,
          theme: resolvedTheme === 'dark' ? 'github-dark-default' : 'github-light-default',
        }),
      )
      .then((result) => {
        if (active) setHighlight({ key: highlightKey, lines: result.tokens });
      })
      .catch(() => {
        if (active) setHighlight({ key: highlightKey, lines: [] });
      });
    return () => {
      active = false;
    };
  }, [code, highlightKey, language, resolvedTheme]);

  if (code.length === 0) return <span className="text-muted-foreground">No code yet</span>;
  if (highlight.key !== highlightKey || highlight.lines.length === 0) return <>{code}</>;
  return highlight.lines.map((line, lineIndex) => (
    <span className="block min-h-4" key={lineIndex}>
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
