"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "react-toastify";

type PageState =
  | { mode: "loading" }
  | { mode: "otp"; tempToken: string; provider: string };

export default function AuthErrorPage() {
  const params = useSearchParams();
  const router = useRouter();

  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const pageState = useMemo<PageState>(() => {
    const error = params.get("error") || "";

    if (error.startsWith("2fa:")) {
      const [, tempToken, provider] = error.split(":");

      return {
        mode: "otp",
        tempToken,
        provider,
      };
    }

    return { mode: "loading" };
  }, [params]);

  useEffect(() => {
    const error = params.get("error") || "";

    if (error.startsWith("2fa:")) {
      return;
    }

    if (error) {
      const messages: Record<string, string> = {
        OAuthAccountNotLinked:
          "That email is already registered with a different sign-in method.",
        AccessDenied: "Access denied. Please try again.",
        CredentialsSignin: "Invalid email or password.",
      };

      toast.error(
        messages[error] ??
          "Something went wrong signing in. Please try again."
      );

      router.replace("/register");
      return;
    }

    router.replace("/register");
  }, [params, router]);

  async function handleSubmit() {
    if (submittingRef.current) {
      return;
    }

    submittingRef.current = true;

    if (pageState.mode !== "otp") {
      submittingRef.current = false;
      return;
    }

    if (!otp || otp.length < 6) {
      setOtpError("Enter the 6-digit code we sent you.");
      submittingRef.current = false;
      return;
    }

    setSubmitting(true);
    setOtpError("");

    try {
      const res = await signIn("otp", {
        tempToken: pageState.tempToken,
        otp,
        provider: pageState.provider,
        redirect: false,
      });

      if (res?.error) {
        toast.error("Invalid or expired OTP");
        setOtpError(res.error);
        return;
      }
      toast.success("Login successful!");
      setTimeout(() => {
        router.push("/user/dashboard");
      }, 800);
    } catch (err) {
      console.error("OTP submit failed:", err);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  if (pageState.mode !== "otp") {
    return <p style={{ padding: 24 }}>Redirecting…</p>;
  }

  return (
    <div style={{ maxWidth: 360, margin: "80px auto", padding: 24 }}>
      <h2>Verify your identity</h2>

      <p>Enter the 6-digit code sent to your phone to finish signing in.</p>

      {otpError && (
        <p style={{ color: "#ef4444" }}>
          {otpError}
        </p>
      )}

      <input
        value={otp}
        onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
        maxLength={6}
        inputMode="numeric"
        autoFocus
        style={{
          fontSize: 20,
          letterSpacing: 6,
          textAlign: "center",
          width: "100%",
          padding: 10,
          margin: "16px 0",
        }}
      />

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting}
        style={{
          width: "100%",
          padding: 10,
        }}
      >
        {submitting ? "Verifying..." : "Verify"}
      </button>
    </div>
  );
}