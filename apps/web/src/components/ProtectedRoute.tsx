import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { Role } from "@gpp/shared";

type ProtectedRouteProps = {
  isAuthenticated: boolean;
  userRole?: Role;
  allowedRoles: Role[];
};

export function ProtectedRoute({
  isAuthenticated,
  userRole,
  allowedRoles
}: ProtectedRouteProps): JSX.Element {
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/auth" replace state={{ from: location }} />;
  }

  if (!userRole || !allowedRoles.includes(userRole)) {
    return <Navigate to="/forbidden" replace />;
  }

  return <Outlet />;
}
