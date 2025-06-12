
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
  const [isProcessingSignup, setIsProcessingSignup] = useState(false); // Renamed for clarity
  const { signup, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  // This function is called by FaceCapture AFTER liveness check and final image capture
  const handleFaceVerifiedAndCaptured = async (faceDataUrl: string, faceDescriptor: number[] | null) => {
    if (!name || !email) {
      toast({ title: "Información Faltante", description: "Por favor, completa tu nombre y correo electrónico.", variant: "destructive" });
      return;
    }
    if (!faceDescriptor) {
      toast({ title: "Falta Descriptor Facial", description: "Descriptor facial no disponible. Intenta la verificación y captura de nuevo.", variant: "destructive", duration: 7000 });
      return;
    }

    setIsProcessingSignup(true);
    try {
      // Signup now expects the descriptor
      const success = await signup(name, email, faceDataUrl, faceDescriptor); 

      if (success) {
        toast({ title: "Registro Exitoso", description: "Tu cuenta ha sido creada. ¡Bienvenido!" });
        router.push('/dashboard');
      } else {
        // Error toasts handled in signup
      }
    } catch (error) {
      console.error("Signup error:", error);
      toast({ title: "Error de Registro", description: "Ocurrió un error inesperado. Por favor, inténtalo de nuevo.", variant: "destructive" });
    } finally {
      setIsProcessingSignup(false);
    }
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
            mainCaptureButtonTextIfLive="Capturar Rostro y Crear Cuenta"
            context="signup" 
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
