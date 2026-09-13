import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const cookieOptions = {
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

export async function updateSession(request: NextRequest) {
  if (
    request.nextUrl.pathname.startsWith("/auth/callback") ||
    request.nextUrl.pathname.startsWith("/auth/session") ||
    request.nextUrl.pathname.startsWith("/invite") ||
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/v1")
  ) {
    const pass = NextResponse.next();
    pass.headers.set("x-vercel-skip-toolbar", "1");
    return pass;
  }

  let response = NextResponse.next({ request });
  response.headers.set("x-vercel-skip-toolbar", "1");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    "";

  const supabase = createServerClient(url, key, {
    cookieOptions,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        response.headers.set("x-vercel-skip-toolbar", "1");
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, { ...cookieOptions, ...options });
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return response;
    }
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.search = "";
    redirect.searchParams.set(
      "space",
      request.nextUrl.pathname.startsWith("/developer") ? "developer" : "cfo",
    );
    const redirected = NextResponse.redirect(redirect);
    redirected.headers.set("x-vercel-skip-toolbar", "1");
    return redirected;
  }

  return response;
}
