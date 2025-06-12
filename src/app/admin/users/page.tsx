"use client";
import ProtectedPage from '@/components/auth/protected-page';
import UserManagementTable from '@/components/admin/user-management-table';

export default function AdminUsersPage() {
  return (
    <ProtectedPage adminOnly={true}>
      <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <UserManagementTable />
      </div>
    </ProtectedPage>
  );
}
