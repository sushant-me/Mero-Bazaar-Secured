import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Facebook from "next-auth/providers/facebook";
import Credentials from "next-auth/providers/credentials";
import type { OAuthProfile } from "next-auth/jwt";
import { cookies, headers } from "next/headers";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),

    Facebook({
      clientId: process.env.FACEBOOK_APP_ID!,
      clientSecret: process.env.FACEBOOK_APP_SECRET!,
    }),

    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
      },

      async authorize(credentials) {
        if (!credentials) return null;

        const { email, password } = credentials as {
          email: string;
          password: string;
        };

        const res = await fetch(`${API_URL}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });

        const data = await res.json();

        if (res.ok && data?.requiresTwoFactor) {
          const cookieStore = await cookies();
          cookieStore.set(
            "pending_2fa",
            JSON.stringify({ tempToken: data.tempToken, provider: "credentials" }),
            { httpOnly: true, maxAge: 300, path: "/" },
          );
          return null;
        }

        if (!res.ok || !data?.user) return null;

        return {
          id: data.user.id,
          name: data.user.name ?? data.user.email.split("@")[0],
          email: data.user.email,
          role: data.user.role,
          twoFactorEnabled: data.user.twoFactorEnabled ?? false,
          accessToken: data.accessToken ?? data.access_token,
        };
      },
    }),

    Credentials({
      id: "otp",
      name: "OTP",
      credentials: {
        tempToken: { label: "tempToken", type: "text" },
        otp: { label: "otp", type: "text" },
        provider: { label: "provider", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials) return null;

        const { tempToken, otp, provider } = credentials as {
          tempToken: string;
          otp: string;
          provider?: string;
        };

        const res = await fetch(`${API_URL}/api/auth/2fa/verify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ tempToken, otp }),
        });

        const data = await res.json();

        const accessToken = data?.accessToken ?? data?.access_token;

        if (!res.ok) {
          return null;
        }

        const profileRes = await fetch(`${API_URL}/api/user/profile/me`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        const profile = profileRes.ok ? await profileRes.json() : {};

        return {
          id: data.user.id,
          email: data.user.email,
          name: profile.name ?? data.user.email.split("@")[0],
          image: profile.image ?? undefined,
          phone: profile.phone ?? null,
          address: profile.address ?? null,
          role: data.user.role,
          twoFactorEnabled: true,
          accessToken,
          provider: provider || "credentials",
        };
      },
    }),
  ],

  pages: {
    signIn: "/register",
    error: "/register",
  },

  callbacks: {
    async signIn({ user, account, profile }) {
      if (account && account.provider !== "credentials" && account.provider !== "otp") {
        const p = profile as OAuthProfile;
        const email = p?.email;
        const name = p?.name;
        const image =
          account.provider === "facebook"
            ? (typeof p?.picture === "object" ? p.picture?.data?.url : undefined)
            : (typeof p?.picture === "string" ? p.picture : p?.image);

        const emailVerified =
          account.provider === "google"
            ? (profile as OAuthProfile & { email_verified?: boolean })?.email_verified !== false
            : true;

        if (!email || !emailVerified) {
          console.error(`Unverified or missing email from ${account.provider}`);
          return false;
        }

        const cookieStore = await cookies();
        const headerList = await headers();
        const pendingRole = cookieStore.get("pending_role")?.value;
        const role = pendingRole === "VENDOR" ? "VENDOR" : "USER";
        const userAgent = headerList.get("user-agent") ?? undefined;
        const ipAddress = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;

        const res = await fetch(`${API_URL}/api/user/oauth-sync`, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "x-internal-secret": process.env.INTERNAL_API_SECRET!, 
          },
          body: JSON.stringify({ email, name, image, role, userAgent, ipAddress, provider: account.provider }),
        });
        const dbUser = await res.json();
        if (!res.ok) {
          console.error(
            "oauth-sync failed",
            account.provider,
            (dbUser as { id?: string } | null)?.id,
          );
          return false;
        }

        if (dbUser.requiresTwoFactor) {
          cookieStore.set(
            "pending_2fa",
            JSON.stringify({ tempToken: dbUser.tempToken, provider: account.provider }),
            { httpOnly: true, maxAge: 300, path: "/" },
          );
          return false;
        }

        // Stash the synced DB user on the `user` object so jwt() can read it below.
        user.dbUser = dbUser;
        user.provider = account.provider;
        user.oauthImage = image;
      }
      return true;
    },

    async jwt({ token, user, trigger, session }) {
      if (trigger === "update" && session) {
        token.name = session.user?.name ?? session.name ?? token.name;
        token.picture = session.user?.image ?? session.image ?? token.picture;
        token.phone = session.user?.phone ?? session.phone ?? token.phone;
        token.address = session.user?.address ?? session.address ?? token.address;
        token.twoFactorEnabled =
          session.user?.twoFactorEnabled ?? session.twoFactorEnabled ?? token.twoFactorEnabled;
        return token;
      }

      if (user) {
        const dbUser = user.dbUser;
        if (dbUser) {
          token.id = dbUser.id;
          token.name = dbUser.name;
          token.role = dbUser.role;
          token.phone = dbUser.phone ?? null;
          token.address = dbUser.address ?? null;
          token.picture = dbUser.image ?? user.oauthImage;
          token.provider = user.provider;
          token.accessToken = dbUser.accessToken ?? dbUser.access_token ?? token.accessToken;
          token.twoFactorEnabled = dbUser.twoFactorEnabled ?? false;
        } else {
          token.id = user.id;
          token.role = user.role;
          token.accessToken = user.accessToken ?? token.accessToken;
          token.phone = user.phone ?? null;
          token.address = user.address ?? null;
          token.provider = user.provider ?? "credentials";
          token.twoFactorEnabled = user.twoFactorEnabled ?? false;
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.name = token.name as string;
        session.user.email = token.email as string;
        session.user.role = token.role as string;
        session.user.image = (token.picture as string) ?? session.user.image;
        session.user.phone = (token.phone as string) ?? null;
        session.user.address = (token.address as string) ?? null;
        session.user.provider = token.provider as string;
        session.user.twoFactorEnabled = token.twoFactorEnabled as boolean;
      }
      if (typeof token.accessToken === "string") {
        session.accessToken = token.accessToken;
      }
      return session;
    },
  },
});