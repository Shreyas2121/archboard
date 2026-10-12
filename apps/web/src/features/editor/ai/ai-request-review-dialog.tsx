import type { AiCreateRun } from '@archboard/contracts';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { AiContextReview } from './ai-context-review';
import { AI_JSON_INDENT } from './ai-review-model';

export function AiRequestReviewDialog({ review }: { readonly review: AiCreateRun }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-9 w-full min-w-0 whitespace-normal"
        >
          View full request
        </Button>
      </DialogTrigger>
      <DialogContent className="min-w-0 overflow-x-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Review what will be sent</DialogTitle>
          <DialogDescription>
            These instructions and context are sent to Archboard’s cloud AI service only when you
            choose Generate or Request guidance. Review the content for secrets before sending.
          </DialogDescription>
        </DialogHeader>
        <p className="min-w-0 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
          {review.prompt}
        </p>
        {review.context && <AiContextReview context={review.context} />}
        <Collapsible className="min-w-0">
          <CollapsibleTrigger asChild>
            <Button type="button" variant="outline" className="h-auto min-h-9 whitespace-normal">
              View request JSON
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="min-w-0">
            <pre className="mt-3 max-h-96 min-w-0 overflow-auto whitespace-pre-wrap rounded-md border p-3 text-xs [overflow-wrap:anywhere]">
              {JSON.stringify(review, null, AI_JSON_INDENT)}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </DialogContent>
    </Dialog>
  );
}
