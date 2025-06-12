import AuthLayout from '@/components/layout/auth-layout';
import LoginForm from '@/components/forms/login-form';

export default function LoginPage() {
  return (
    <AuthLayout title="¡Bienvenido de Nuevo!" subtitle="Inicia sesión usando tu rostro.">
      <LoginForm />
    </AuthLayout>
  );
}
