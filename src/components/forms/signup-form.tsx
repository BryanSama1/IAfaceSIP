
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

  // Esta función es llamada por FaceCapture DESPUÉS de la verificación de liveness (video) 
  // Y la captura automática del fotograma para el registro.
  const handleFaceVerifiedAndCaptured = async (faceDataUrl: string | null, faceDescriptor: number[] | null, livenessVerificationPassed?: boolean) => {
    
    if (!name || !email) {
      toast({ title: "Información Faltante", description: "Por favor, completa tu nombre y correo electrónico.", variant: "destructive" });
      setIsProcessingSignup(false); // Asegurar que no quede en estado de carga si faltan datos
      return;
    }

    if (livenessVerificationPassed === false) {
      // FaceCapture ya debería haber mostrado un toast si la liveness falló.
      // No es necesario un toast adicional aquí, pero sí resetear el estado de carga.
      setIsProcessingSignup(false);
      return;
    }
    
    // Si liveness pasó (true), pero falta faceDataUrl o faceDescriptor, es un error en la captura/procesamiento del fotograma.
    if (livenessVerificationPassed && (!faceDataUrl || !faceDescriptor)) {
      toast({ title: "Registro Fallido", description: "No se pudo procesar el rostro para el registro. Intenta la verificación de nuevo.", variant: "destructive", duration: 7000 });
      setIsProcessingSignup(false);
      return;
    }

    // Si livenessVerificationPassed es undefined (no debería pasar si el flujo es correcto), o si faceDataUrl/Descriptor faltan
    if (livenessVerificationPassed === undefined || !faceDataUrl || !faceDescriptor) {
        toast({ title: "Error de Registro", description: "Ocurrió un problema con la captura facial. Inténtalo de nuevo.", variant: "destructive" });
        setIsProcessingSignup(false);
        return;
    }


    setIsProcessingSignup(true);
    try {
      // Para signup, siempre pasamos el faceDataUrl y faceDescriptor de la captura automática post-liveness.
      const success = await signup(name, email, faceDataUrl, faceDescriptor); 

      if (success) {
        toast({ title: "Registro Exitoso", description: "Tu cuenta ha sido creada. ¡Bienvenido!", variant: "success" });
        router.push('/dashboard');
      } else {
        // Los toasts de error son manejados en auth-context/signup
        setIsProcessingSignup(false); 
      }
    } catch (error) {
      console.error("Signup error:", error);
      toast({ title: "Error de Registro", description: "Ocurrió un error inesperado. Por favor, inténtalo de nuevo.", variant: "destructive" });
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
          Se verificará que eres una persona real y se capturará tu rostro para el registro.
        </p>
        <FaceCapture 
            onFaceCaptured={handleFaceVerifiedAndCaptured} 
            initialButtonText="Iniciar Verificación y Registrar Cuenta"
            // mainCaptureButtonTextIfLive ya no es relevante para signup
            context="signup" 
            isParentProcessing={isProcessingSignup || authLoading}
        />
      </div>

      {isProcessingSignup && !authLoading && ( // Muestra solo si esta forma está procesando
        <div className="flex items-center justify-center text-sm text-muted-foreground pt-2">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creando cuenta...
        </div>
       )}
       {authLoading && ( // Muestra si el contexto de auth está cargando (podría ser por otra razón)
        <div className="flex items-center justify-center text-sm text-muted-foreground pt-2">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando sistema de autenticación...
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
