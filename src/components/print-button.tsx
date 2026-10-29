'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function PrintButton({ label = 'Print / save as PDF' }: { label?: string }) {
  return (
    <Button size="sm" variant="secondary" onClick={() => window.print()}>
      <Printer className="size-3.5" /> {label}
    </Button>
  );
}
