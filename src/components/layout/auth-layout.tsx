import { ReactNode } from 'react';
import { AppLogo } from '@/components/common/app-logo';

interface AuthLayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
}

export default function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 sm:p-6 md:p-8 bg-gradient-to-br from-background to-secondary">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="mb-6 inline-block">
            <AppLogo />
          </div>
          <h1 className="text-3xl font-headline font-bold tracking-tight text-primary sm:text-4xl">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-2xl sm:p-8">
          {children}
        </div>
      </div>
    </main>
  );
}
