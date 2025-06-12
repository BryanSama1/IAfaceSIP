
"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import FaceCapture from '@/components/face/face-capture';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';

export default function LoginForm() {
  const [isProcessingLogin, setIsProcessingLogin] = useState(false); // Renamed for clarity
  const { loginWithFace, users, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  // This function is called by FaceCapture AFTER liveness check and final image capture
  const handleFaceVerifiedAndCaptured = async (faceDataUrl: string, faceDescriptor: number[] | null) => {
    if (authLoading) {
      toast({ title: "Sistema Ocupado", description: "El sistema de autenticación aún está cargando. Intenta en un momento.", variant: "default" });
      return;
    }
     if (users.length === 0 && !authLoading) { // Check users length only if not loading
      toast({ title: "Inicio de Sesión No Posible", description: "No hay usuarios registrados. Por favor, regístrate.", variant: "destructive" });
      return;
    }
    if (!faceDescriptor) {
      toast({ title: "Rasgos Faciales No Claros", description: "No se pudieron procesar los rasgos faciales para el inicio de sesión. Intenta capturar tu rostro de nuevo.", variant: "destructive", duration: 7000 });
      return;
    }
    
    setIsProcessingLogin(true);
    try {
      const success = await loginWithFace(faceDataUrl, faceDescriptor); // loginWithFace now uses the descriptor
      if (success) {
        toast({ title: "Inicio de Sesión Exitoso", description: "¡Bienvenido de nuevo!" });
        router.push('/dashboard');
      } else {
        // Error toasts are handled in loginWithFace
      }
    } catch (error) {
      console.error("Login error:", error);
      toast({ title: "Error de Inicio de Sesión", description: "Ocurrió un error inesperado. Por favor, inténtalo de nuevo.", variant: "destructive" });
    } finally {
      setIsProcessingLogin(false);
    }
  };
  
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label className="font-medium text-foreground text-center block">Inicia Sesión con Tu Rostro</Label>
        <p className="text-sm text-muted-foreground text-center mb-4">
          Primero se realizará una verificación humana por video, luego podrás capturar tu rostro para el reconocimiento.
        </p>
        <FaceCapture 
          onFaceCaptured={handleFaceVerifiedAndCaptured} 
          mainCaptureButtonTextIfLive="Capturar Rostro y Entrar"
          context="login"
        />
        
        {!authLoading && users.length === 0 && !isProcessingLogin && (
           <p className="text-xs text-amber-600 text-center pt-2">No hay usuarios registrados. Por favor, regístrate.</p>
        )}
      </div>

       {isProcessingLogin && (
        <div className="flex items-center justify-center text-sm text-muted-foreground pt-2">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verificando credenciales...
        </div>
       )}

      <p className="text-center text-sm text-muted-foreground pt-4">
        ¿No tienes una cuenta?{' '}
        <Link href="/signup" className="font-medium text-primary hover:underline">
          Regístrate
        </Link>
      </p>
    </div>
  );
}
