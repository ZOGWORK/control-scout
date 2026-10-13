// Ported from Control Point (src/components/ui-kit/sonner.tsx): shadcn/ui Sonner toaster, themed with our tokens.
import { Toaster as SonnerToaster, type ToasterProps } from 'sonner';
import { useTheme } from '../../hooks/useTheme';

export function Toaster(props: ToasterProps) {
  const { resolved } = useTheme();
  return (
    <SonnerToaster
      theme={resolved}
      position="bottom-right"
      offset={{ bottom: '1.5rem', right: '1.5rem' }}
      mobileOffset={{ bottom: '5.5rem' }}
      closeButton
      toastOptions={{
        classNames: {
          toast: 'group !rounded-xl !border !border-border !bg-popover !text-popover-foreground !shadow-xl',
          description: '!text-muted-foreground',
          actionButton: '!bg-accent !text-accent-ink',
          cancelButton: '!bg-muted !text-muted-foreground',
        },
      }}
      style={{ zIndex: 115 } as React.CSSProperties}
      {...props}
    />
  );
}
export { toast } from 'sonner';
