import type { CurrentUser, Role } from "@gpp/shared";

type RoleShellProps = {
  title: string;
  expectedRole: Role;
  user: CurrentUser;
  apiMessage: string | null;
};

export function RoleShell({ title, expectedRole, user, apiMessage }: RoleShellProps): JSX.Element {
  return (
    <section className="card role-shell">
      <h2>{title}</h2>
      <p className="subtext">Protected route shell for {expectedRole} users.</p>
      <ul className="meta-list">
        <li>User: {user.name}</li>
        <li>Email: {user.email}</li>
        <li>Role: {user.role}</li>
      </ul>
      {apiMessage ? <p className="success-inline">API says: {apiMessage}</p> : null}
    </section>
  );
}
