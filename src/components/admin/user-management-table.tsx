
"use client";

import { useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import type { User } from '@/types';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import FaceCapture from '@/components/face/face-capture';
import { useToast } from '@/hooks/use-toast';
import { Edit3, Loader2 } from 'lucide-react';
import Image from 'next/image';


export default function UserManagementTable() {
  const { users, updateUserFaceAdmin, loading: authLoading } = useAuth();
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [newFaceUri, setNewFaceUri] = useState<string | null>(null);
  const [newFaceDescriptor, setNewFaceDescriptor] = useState<number[] | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { toast } = useToast();

  const handleOpenUpdateDialog = (user: User) => {
    setSelectedUser(user);
    setNewFaceUri(null); 
    setNewFaceDescriptor(null);
    setIsDialogOpen(true);
  };

  const handleFaceCapturedInDialog = (dataUrl: string | null, descriptor: number[] | null, livenessVerificationPassed?: boolean) => {
    // Para admin_update, livenessVerificationPassed usualmente será true si llegamos a la captura manual.
    // FaceCapture maneja los toasts de error de liveness directamente.
    // Si dataUrl o descriptor son null, la captura manual falló.

    if (dataUrl && descriptor) {
      setNewFaceUri(dataUrl);
      setNewFaceDescriptor(descriptor);
      toast({ title: "Nuevo Rostro Procesado", description: "Nueva imagen facial y descriptor listos para actualizar." });
    } else if (dataUrl && !descriptor) {
      setNewFaceUri(dataUrl); // Guardamos el URI aunque falte el descriptor
      setNewFaceDescriptor(null);
      toast({ title: "Rostro Capturado (Sin Descriptor)", description: "Nueva imagen facial capturada, pero no se pudo calcular el descriptor. Intenta de nuevo para un reconocimiento fiable.", variant: "default", duration: 7000 });
    } else {
      // Caso donde dataUrl es null (posiblemente liveness falló y no se procedió, o captura manual cancelada/fallida)
      setNewFaceUri(null);
      setNewFaceDescriptor(null);
      if (livenessVerificationPassed === false) {
        // FaceCapture ya mostró el error de liveness, no es necesario otro toast aquí.
      } else {
        toast({ title: "Captura Fallida", description: "No se pudo capturar la nueva imagen facial.", variant: "destructive" });
      }
    }
  };

  const handleUpdateUserFace = async () => {
    if (!selectedUser || !newFaceUri) {
        toast({title: "Datos Faltantes", description: "No se capturó una nueva imagen facial.", variant: "destructive"});
        return;
    }
    if (!newFaceDescriptor) {
        toast({title: "Descriptor Faltante", description: "Falta el descriptor facial para la nueva imagen. Por favor, captura de nuevo con claridad.", variant: "destructive"});
        return;
    }


    setIsUpdating(true);
    try {
      const success = await updateUserFaceAdmin(selectedUser.id, newFaceUri, newFaceDescriptor);
      if (success) {
        toast({ title: "Rostro Actualizado", description: `El rostro de inicio de sesión y descriptor de ${selectedUser.name} han sido actualizados.` });
        setIsDialogOpen(false); 
      } else {
        // Los toasts de error son manejados por updateUserFaceAdmin en auth context
      }
    } catch (error) {
      console.error("Error updating face:", error);
      toast({ title: "Error", description: "Ocurrió un error inesperado.", variant: "destructive" });
    } finally {
      setIsUpdating(false);
    }
  };
  
  const getInitials = (name: string = "") => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase() || 'U';
  };

  if (authLoading) return <div className="flex justify-center items-center p-8"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!users || users.length === 0) return <p className="text-center text-muted-foreground p-8">No se encontraron usuarios.</p>;

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-headline font-bold mb-6 text-primary">Gestión de Usuarios</h1>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Avatar</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Correo Electrónico</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Descriptor</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={user.enhancedFaceImageUri} alt={user.name} data-ai-hint="rostro perfil"/>
                    <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                  </Avatar>
                </TableCell>
                <TableCell className="font-medium">{user.name}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>{user.isAdmin ? 'Admin' : 'Usuario'}</TableCell>
                <TableCell>{user.faceDescriptor ? 'Sí' : 'No'}</TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm" onClick={() => handleOpenUpdateDialog(user)}>
                    <Edit3 className="mr-2 h-4 w-4" /> Actualizar Rostro
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {selectedUser && (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Actualizar Rostro para {selectedUser.name}</DialogTitle>
              <DialogDescription>
                Captura una nueva imagen facial. Esto reemplazará el rostro de inicio de sesión existente y recalculará el descriptor.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div className="flex flex-col items-center">
                <p className="text-sm font-medium mb-1">Rostro Mejorado Actual:</p>
                <div className="w-32 h-32 rounded-md overflow-hidden border bg-muted mb-4">
                  {selectedUser.enhancedFaceImageUri ? (
                    <Image src={selectedUser.enhancedFaceImageUri} alt="Rostro actual" width={128} height={128} className="object-cover w-full h-full" data-ai-hint="rostro persona" />
                  ) : <div className="w-full h-full flex items-center justify-center text-muted-foreground">Sin Imagen</div>}
                </div>
                <FaceCapture 
                  onFaceCaptured={handleFaceCapturedInDialog} 
                  context="admin_update"
                  initialButtonText="Iniciar Verificación para Actualizar Rostro"
                  mainCaptureButtonTextIfLive="Capturar Nuevo Rostro"
                />
                {newFaceUri && newFaceDescriptor && <p className="text-xs text-green-600 mt-2">Nuevo rostro y descriptor capturados. Listo para actualizar.</p>}
                {newFaceUri && !newFaceDescriptor && <p className="text-xs text-amber-600 mt-2">Rostro capturado, descriptor falló. Intenta de nuevo.</p>}
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">Cancelar</Button>
              </DialogClose>
              <Button type="button" onClick={handleUpdateUserFace} disabled={isUpdating || !newFaceUri || !newFaceDescriptor}>
                {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {isUpdating ? 'Actualizando...' : 'Guardar Nuevo Rostro'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// Minimal Card component for structure
const Card: React.FC<{children: React.ReactNode, className?:string}> = ({children, className}) => (
  <div className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)}>
    {children}
  </div>
);

// Minimal cn utility if not globally available
const cn = (...inputs: any[]) => inputs.filter(Boolean).join(' ');
