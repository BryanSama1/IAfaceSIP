"use client";

import { ReactNode, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import PageSpinner from '@/components/common/page-spinner';
import AppHeader from '@/components/layout/app-header';

interface ProtectedPageProps {
  children: ReactNode;
  adminOnly?: boolean;
}

export default function ProtectedPage({ children, adminOnly = false }: ProtectedPageProps) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.replace('/login');
      } else if (adminOnly && !user.isAdmin) {
        router.replace('/dashboard'); // Redirect non-admins from admin pages
      }
    }
  }, [user, loading, adminOnly, router]);

  if (loading || !user || (adminOnly && !user.isAdmin)) {
    return <PageSpinner />;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main className="flex-1">{children}</main>
    </div>
  );
}
