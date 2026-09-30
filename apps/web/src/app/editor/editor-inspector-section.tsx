import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

export function EditorInspectorSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen className="border-t">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="group h-10 w-full justify-between rounded-none px-4"
        >
          <span>{title}</span>
          <ChevronDown aria-hidden="true" className="group-data-[state=open]:rotate-180" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent forceMount className="data-closed:hidden">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
