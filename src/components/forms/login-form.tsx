
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
  const [isProcessingLogin, setIsProcessingLogin] = useState(false);
  const { loginWithFace, users, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const handleFaceVerifiedAndCaptured = async (faceDataUrl: string | null, faceDescriptor: number[] | null, livenessVerificationPassed?: boolean) => {
    // El parámetro `faceDataUrl` ahora puede ser `null` si la liveness falla antes de la captura del frame.
    
    if (authLoading) {
      toast({ title: "Sistema Ocupado", description: "El sistema de autenticación aún está cargando. Intenta en un momento.", variant: "default" });
      setIsProcessingLogin(false);
      return;
    }

    if (livenessVerificationPassed === false) {
      // FaceCapture ya debería haber mostrado un toast sobre la falla de liveness.
      // Simplemente detenemos el procesamiento aquí.
      setIsProcessingLogin(false);
      return;
    }
    
    // En este punto, livenessVerificationPassed es true o undefined (si el contexto no era login y no se pasó).
    // Para login, asumimos que si llegamos aquí, livenessVerificationPassed fue true.

    if (users.length === 0 && !authLoading) {
      if (livenessVerificationPassed) { // Solo mostramos este mensaje si la validación humana pasó
        toast({ 
          title: "Validación Humana Exitosa", 
          description: "Pasaste la verificación humana, pero no hay usuarios registrados. Por favor, regístrate.", 
          variant: "default", // Los toasts default no son inherentemente verdes, pero son positivos.
          duration: 7000 
        });
      } else {
        // Este caso no debería ocurrir si livenessVerificationPassed es false (se retorna antes)
        // o si es undefined (no es contexto de login). Pero por si acaso:
        toast({ title: "Inicio de Sesión No Posible", description: "No hay usuarios registrados. Por favor, regístrate.", variant: "destructive" });
      }
      setIsProcessingLogin(false);
      return;
    }

    if (!faceDescriptor || !faceDataUrl) {
      // Este toast es rojo porque es un fallo en la capacidad de procesar el rostro para el login
      toast({ title: "Rasgos Faciales No Claros", description: "No se pudieron procesar los rasgos faciales para el inicio de sesión. Intenta capturar tu rostro de nuevo.", variant: "destructive", duration: 7000 });
      setIsProcessingLogin(false);
      return;
    }
    
    setIsProcessingLogin(true); 
    try {
      const success = await loginWithFace(faceDataUrl, faceDescriptor);
      if (success) {
        toast({ title: "Inicio de Sesión Exitoso", description: "¡Bienvenido de nuevo!" });
        router.push('/dashboard');
      } else {
        // Los toasts de error son manejados en loginWithFace, pero aseguramos que el procesamiento se detenga
        setIsProcessingLogin(false); 
      }
    } catch (error) {
      console.error("Login error:", error);
      toast({ title: "Error de Inicio de Sesión", description: "Ocurrió un error inesperado. Por favor, inténtalo de nuevo.", variant: "destructive" });
      setIsProcessingLogin(false);
    } 
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label className="font-medium text-foreground text-center block">Inicia Sesión con Tu Rostro</Label>
        <p className="text-sm text-muted-foreground text-center mb-4">
          Se verificará que eres una persona real con un video corto, luego se reconocerá tu rostro.
        </p>
        <FaceCapture
          onFaceCaptured={handleFaceVerifiedAndCaptured}
          initialButtonText="Iniciar Verificación y Acceder"
          context="login"
          isParentProcessing={isProcessingLogin}
        />
      </div>

      <p className="text-center text-sm text-muted-foreground pt-4">
        ¿No tienes una cuenta?{' '}
        <Link href="/signup" className="font-medium text-primary hover:underline">
          Regístrate
        </Link>
      </p>
    </div>
  );
}
    
