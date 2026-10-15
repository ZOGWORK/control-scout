// A modal that is a centred dialog on desktop and a bottom sheet on phones
// (thumb-reachable, full width), for the filter builder and the column picker.
import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, Sheet, SheetContent, SheetDescription, SheetTitle } from "../ui/overlay";
import { useMediaQuery } from "../../lib/meta";
import { cn } from "../cn";

export function Panel({ open, onOpenChange, title, description, children, footer, className }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const phone = useMediaQuery("(max-width: 639px)");
  const body = (
    <>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      {footer && <div className="shrink-0 border-t border-line pt-3">{footer}</div>}
    </>
  );
  if (phone) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className={cn("h-[92dvh] max-h-[92dvh] gap-3 p-4 pt-5", className)}>
          <div aria-hidden className="mx-auto -mt-2 h-1 w-10 shrink-0 rounded-full bg-text-base/20" />
          <div className="pr-8">
            <SheetTitle>{title}</SheetTitle>
            {description && <SheetDescription className="mt-1">{description}</SheetDescription>}
          </div>
          {body}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("flex h-[min(46rem,calc(100dvh-4rem))] max-w-3xl flex-col gap-3 overflow-hidden", className)}>
        <div className="pr-8">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription className="mt-1">{description}</DialogDescription>}
        </div>
        {body}
      </DialogContent>
    </Dialog>
  );
}
