import { Smile } from 'lucide-react'; // Using Smile as a generic logo icon
import Link from 'next/link';

export function AppLogo() {
  return (
    <Link href="/" className="flex items-center gap-2 text-primary hover:opacity-80 transition-opacity">
      <Smile className="h-8 w-8" />
      <span className="text-2xl font-headline font-semibold">FaceSIP</span>
    </Link>
  );
}
