
"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import FaceCapture from '@/components/face/face-capture';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';

export default function SignupForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [isProcessingSignup, setIsProcessingSignup] = useState(false);
  const { signup, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  // Esta función es llamada por FaceCapture DESPUÉS de la verificación de liveness (video) Y la captura final de la imagen
  const handleFaceVerifiedAndCaptured = async (faceDataUrl: string | null, faceDescriptor: number[] | null, livenessVerificationPassed?: boolean) => {
    // Para signup, livenessVerificationPassed usualmente será true si llegamos a la captura manual,
    // o FaceCapture manejará los errores de liveness directamente.
    // Si faceDataUrl o faceDescriptor son null aquí, es porque la captura manual falló.
    
    if (!name || !email) {
      toast({ title: "Información Faltante", description: "Por favor, completa tu nombre y correo electrónico.", variant: "destructive" });
      return;
    }
    if (!faceDataUrl || !faceDescriptor) {
      toast({ title: "Falta Captura Facial", description: "No se capturó una imagen facial o su descriptor. Intenta la verificación y captura de nuevo.", variant: "destructive", duration: 7000 });
      return;
    }

    if (livenessVerificationPassed === false) {
      // Esto es un caso de resguardo, FaceCapture debería haber mostrado un toast si la liveness falló.
      toast({ title: "Registro Fallido", description: "La verificación humana falló. Inténtalo de nuevo.", variant: "destructive" });
      setIsProcessingSignup(false);
      return;
    }

    setIsProcessingSignup(true);
    try {
      // Para signup, siempre pasamos el faceDataUrl y faceDescriptor de la captura manual.
      const success = await signup(name, email, faceDataUrl, faceDescriptor); 

      if (success) {
        toast({ title: "Registro Exitoso", description: "Tu cuenta ha sido creada. ¡Bienvenido!" });
        router.push('/dashboard');
      } else {
        // Los toasts de error son manejados en signup
        setIsProcessingSignup(false); // Asegurar que el estado de carga se desactive si el signup falla y no redirige
      }
    } catch (error) {
      console.error("Signup error:", error);
      toast({ title: "Error de Registro", description: "Ocurrió un error inesperado. Por favor, inténtalo de nuevo.", variant: "destructive" });
      setIsProcessingSignup(false);
    }
    // No se necesita finally aquí si el signup exitoso redirige.
  };

  return (
    <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
      <div>
        <Label htmlFor="name" className="font-medium text-foreground">Nombre Completo</Label>
        <Input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Juan Pérez"
          required
          className="mt-1"
          disabled={isProcessingSignup || authLoading}
        />
      </div>
      <div>
        <Label htmlFor="email" className="font-medium text-foreground">Dirección de Correo Electrónico</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@ejemplo.com"
          required
          className="mt-1"
          disabled={isProcessingSignup || authLoading}
        />
      </div>
      
      <div className="space-y-2">
        <Label className="font-medium text-foreground">Verificación y Registro Facial</Label>
        <p className="text-sm text-muted-foreground">
          Primero se realizará una verificación humana por video. Luego, podrás capturar tu rostro para el registro.
        </p>
        <FaceCapture 
            onFaceCaptured={handleFaceVerifiedAndCaptured} 
            initialButtonText="Iniciar Verificación Humana"
            mainCaptureButtonTextIfLive="Capturar Rostro y Crear Cuenta"
            context="signup" 
            // isParentProcessing no es tan relevante aquí como en login
        />
      </div>

      {isProcessingSignup && (
        <div className="flex items-center justify-center text-sm text-muted-foreground pt-2">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creando cuenta...
        </div>
       )}

      <p className="text-center text-sm text-muted-foreground pt-4">
        ¿Ya tienes una cuenta?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Iniciar Sesión
        </Link>
      </p>
    </form>
  );
}
