
"use client";

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppLogo } from '@/components/common/app-logo';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';
import { Home, UserCircle, Users, LogOut, ShieldCheck } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";


export default function AppHeader() {
  const { user, logout } = useAuth();
  const router = useRouter();

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const getInitials = (name: string = "") => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase() || 'U';
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-card shadow-sm">
      <div className="container mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        <AppLogo />
        <nav className="flex items-center gap-4">
          {user && (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard">
                  <Home className="mr-2 h-4 w-4" /> Panel
                </Link>
              </Button>
              {user.isAdmin && (
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/admin/users">
                    <ShieldCheck className="mr-2 h-4 w-4" /> Panel de Admin
                  </Link>
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-9 w-9 rounded-full">
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={user.enhancedFaceImageUri} alt={user.name} data-ai-hint="foto perfil" />
                      <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">{user.name}</p>
                      <p className="text-xs leading-none text-muted-foreground">
                        {user.email}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Cerrar Sesión
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
