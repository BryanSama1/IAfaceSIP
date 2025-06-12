
"use client";
import ProtectedPage from '@/components/auth/protected-page';
import { useAuth } from '@/contexts/auth-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import Image from 'next/image';
import { CheckCircle } from 'lucide-react';

export default function DashboardPage() {
  const { user } = useAuth();

  if (!user) return null; 

  const getInitials = (name: string = "") => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase() || 'U';
  };

  return (
    <ProtectedPage>
      <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <Card className="max-w-2xl mx-auto shadow-lg">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <Avatar className="h-24 w-24 border-4 border-primary">
                <AvatarImage src={user.enhancedFaceImageUri} alt={user.name} data-ai-hint="rostro perfil" />
                <AvatarFallback className="text-3xl">{getInitials(user.name)}</AvatarFallback>
              </Avatar>
            </div>
            <CardTitle className="text-3xl font-headline">¡Bienvenido, {user.name}!</CardTitle>
            <CardDescription className="text-lg text-green-600 flex items-center justify-center gap-2">
              <CheckCircle className="h-5 w-5" /> Has iniciado sesión exitosamente.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <p className="text-center text-muted-foreground">
              Este es tu panel de FaceSIP. Aquí están los detalles asociados con tu cuenta:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
              <div className="flex flex-col items-center p-4 border rounded-lg bg-card-foreground/5">
                <h3 className="font-semibold mb-3 text-center text-primary">Rostro Original Capturado</h3>
                <div className="aspect-square w-full max-w-[200px] rounded-md overflow-hidden border-2 border-primary/20 bg-muted shadow-md">
                  {user.faceImageUri ? (
                    <Image src={user.faceImageUri} alt="Rostro original" width={200} height={200} className="object-cover w-full h-full" data-ai-hint="rostro persona"/>
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">Sin imagen</div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-2">Esta es la imagen cruda capturada durante el registro.</p>
              </div>
              <div className="flex flex-col items-center p-4 border rounded-lg bg-card-foreground/5">
                <h3 className="font-semibold mb-3 text-center text-primary">Rostro Mejorado para Inicio de Sesión</h3>
                 <div className="aspect-square w-full max-w-[200px] rounded-md overflow-hidden border-2 border-primary/20 bg-muted shadow-md">
                  {user.enhancedFaceImageUri ? (
                     <Image src={user.enhancedFaceImageUri} alt="Rostro mejorado" width={200} height={200} className="object-cover w-full h-full" data-ai-hint="rostro perfil" />
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">Sin imagen</div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-2">Esta imagen mejorada por IA se usa para el inicio de sesión.</p>
              </div>
            </div>
             {user.isAdmin && (
                <p className="text-center text-accent-foreground bg-accent/80 p-2 rounded-md font-semibold mt-6">
                  Tienes privilegios de administrador. Puedes gestionar usuarios desde el Panel de Administración.
                </p>
              )}
          </CardContent>
        </Card>
      </div>
    </ProtectedPage>
  );
}
