import AuthLayout from '@/components/layout/auth-layout';
import SignupForm from '@/components/forms/signup-form';

export default function SignupPage() {
  return (
    <AuthLayout title="Crea Tu Cuenta" subtitle="Únete a FaceSIP con un rápido escaneo facial.">
      <SignupForm />
    </AuthLayout>
  );
}
