import { useState } from 'react';
import { Copy } from 'lucide-react';
import type { AiDiagramFocus } from '@archboard/contracts';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { BrowserClipboard } from '@/platform/clipboard';
import { createLocalContextPrompt } from './ai-local-context-prompt';
import { AI_DIAGRAM_FOCUS_OPTIONS } from './ai-diagram-focus';

export function AiLocalContextPromptCard({
  focus,
  instructions,
  disabled,
}: {
  readonly focus: AiDiagramFocus;
  readonly instructions: string;
  readonly disabled: boolean;
}) {
  const [clipboard] = useState(() => new BrowserClipboard());
  const [copying, setCopying] = useState(false);
  const [notice, setNotice] = useState<{ prompt: string; message: string } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const prompt = createLocalContextPrompt(focus, instructions);
  const currentNotice = notice?.prompt === prompt ? notice.message : '';
  async function copy() {
    setCopying(true);
    const result = await clipboard.writeText(prompt);
    setNotice({
      prompt,
      message: result.systemWritten
        ? 'Prompt copied. Paste it into your AI tool with the project folder open.'
        : 'Clipboard access was denied. Select and copy the prompt below.',
    });
    if (!result.systemWritten) setExpanded(true);
    setCopying(false);
  }
  return (
    <div className="grid min-w-0 gap-2 rounded-lg border bg-card p-3">
      <h4 className="text-sm font-medium">Diagram an existing project</h4>
      <p className="text-xs leading-5 text-muted-foreground">
        Copy these instructions into an AI tool opened in your project folder. It will create
        archboard.project-context.json for {AI_DIAGRAM_FOCUS_OPTIONS[focus].label.toLowerCase()}.
        Review that file, then upload it below.
      </p>
      <Button
        type="button"
        variant="outline"
        className="h-auto min-h-9 whitespace-normal"
        disabled={disabled || copying}
        onClick={() => void copy()}
      >
        <Copy aria-hidden="true" />
        {copying ? 'Copying…' : 'Copy prompt for local AI'}
      </Button>
      {currentNotice && (
        <p role="status" aria-live="polite" className="text-xs leading-5">
          {currentNotice}
        </p>
      )}
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm">
            {expanded ? 'Hide prompt' : 'View prompt'}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-2 pt-2">
          <Label htmlFor="ai-local-context-prompt">Prompt for your project AI</Label>
          <Textarea
            id="ai-local-context-prompt"
            value={prompt}
            readOnly
            className="max-h-80 min-h-40"
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
