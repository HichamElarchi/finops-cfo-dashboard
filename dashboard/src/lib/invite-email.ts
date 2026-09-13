import type { User } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabase>>;

async function findAuthUser(admin: AdminClient, email: string): Promise<User | null> {
  const lowered = email.toLowerCase();
  const adminApi = admin.auth.admin as typeof admin.auth.admin & {
    getUserByEmail?: (value: string) => Promise<{
      data: { user: User } | User | null;
      error: { message: string } | null;
    }>;
  };

  if (typeof adminApi.getUserByEmail === "function") {
    const { data, error } = await adminApi.getUserByEmail(lowered);
    const user = data && "user" in data ? data.user : data;
    if (!error && user && "id" in user) {
      return user;
    }
  }

  for (let page = 1; page <= 5; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      break;
    }
    const found = data.users.find((user) => user.email?.toLowerCase() === lowered);
    if (found) {
      return found;
    }
    if (data.users.length < 200) {
      break;
    }
  }
  return null;
}

export async function findInvitedAuthUser(email: string) {
  const admin = createAdminSupabase();
  if (!admin) {
    return { admin: null, user: null };
  }
  return { admin, user: await findAuthUser(admin, email) };
}

export async function registerInvitedDeveloper(options: {
  developerEmail: string;
  cfoEmail: string;
}): Promise<{ ok: boolean; created: boolean; error?: string }> {
  const admin = createAdminSupabase();
  if (!admin) {
    return { ok: false, created: false, error: "Missing server Auth key." };
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: options.developerEmail,
    email_confirm: true,
    user_metadata: {
      role: "developer",
      invited_by: options.cfoEmail,
      password_set: false,
    },
  });

  if (!error && data.user) {
    return { ok: true, created: true };
  }

  if (error && /already|registered|exists/i.test(error.message)) {
    const existing = await findAuthUser(admin, options.developerEmail);
    if (existing) {
      await admin.auth.admin.updateUserById(existing.id, {
        email_confirm: true,
        user_metadata: {
          ...(existing.user_metadata ?? {}),
          invited_by: options.cfoEmail,
        },
      });
    }
    return { ok: true, created: false };
  }

  return { ok: false, created: false, error: error?.message || "Could not register developer." };
}
