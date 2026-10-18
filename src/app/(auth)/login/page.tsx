import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEV_SEED_USERS } from "@/db/seed-credentials";
import { getSessionUser } from "@/lib/auth/session";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/");

  // Server component, so seed credentials only ever appear in rendered dev
  // HTML — they are never part of the client bundle or production responses.
  const showDevHint = process.env.NODE_ENV !== "production";

  return (
    <main className="bg-muted/40 flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Medical Store POS</CardTitle>
          <CardDescription>Sign in with your staff account.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>

      {showDevHint ? (
        <div className="text-muted-foreground w-full max-w-sm rounded-md border border-dashed p-3 text-xs">
          <p className="mb-1 font-medium">
            Development seed logins (see src/db/seed-credentials.ts)
          </p>
          <ul className="space-y-0.5">
            {DEV_SEED_USERS.map((devUser) => (
              <li key={devUser.id}>
                {devUser.role}: {devUser.email} / {devUser.password}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </main>
  );
}
