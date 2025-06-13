
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
    if (authLoading) {
      toast({ title: "Sistema Ocupado", description: "El sistema de autenticación aún está cargando. Intenta en un momento.", variant: "default" });
      setIsProcessingLogin(false);
      return;
    }

    if (livenessVerificationPassed === false) {
      setIsProcessingLogin(false);
      return;
    }
    
    if (livenessVerificationPassed) { // Liveness fue exitosa
      if (users.length === 0) {
        toast({ 
          title: "Validación Humana Exitosa", 
          description: "Pasaste la verificación humana, pero no hay usuarios registrados. Por favor, regístrate.", 
          variant: "success", 
          duration: 7000 
        });
        setIsProcessingLogin(false);
        return;
      }
      // Si hay usuarios pero falta el descriptor o el dataUrl, es un error del proceso de captura/reconocimiento
      if (!faceDescriptor || !faceDataUrl) {
        toast({ title: "Rasgos Faciales No Claros", description: "No se pudieron procesar los rasgos faciales para el inicio de sesión. Intenta capturar tu rostro de nuevo.", variant: "destructive", duration: 7000 });
        setIsProcessingLogin(false);
        return;
      }
    } else { 
      // Liveness no pasó o no se definió (no debería llegar aquí si fue explícitamente false)
      // O si faceDescriptor/faceDataUrl faltan después de que liveness no se evaluó como explícitamente true
      if (!faceDescriptor || !faceDataUrl) {
        toast({ title: "Rasgos Faciales No Claros", description: "No se pudieron procesar los rasgos faciales para el inicio de sesión. Intenta capturar tu rostro de nuevo.", variant: "destructive", duration: 7000 });
        setIsProcessingLogin(false);
        return;
      }
    }
    
    setIsProcessingLogin(true); 
    try {
      const success = await loginWithFace(faceDataUrl!, faceDescriptor!); // faceDataUrl y faceDescriptor ya están validados arriba
      if (success) {
        toast({ title: "Inicio de Sesión Exitoso", description: "¡Bienvenido de nuevo!", variant: "success" });
        router.push('/dashboard');
      } else {
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
    
