"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FiLock, FiEye, FiEyeOff, FiAlertTriangle } from "react-icons/fi";
import { toast } from "react-toastify";

function ResetPasswordForm() {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const isValidToken = !!token;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!newPassword || !confirmPassword) {
      toast.error("Please fill in all fields.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/user/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || "Failed to reset password.");
      }

      toast.success("Password reset successfully! Redirecting to login...");
      setTimeout(() => router.push("/login"), 2000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong!");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }

        html, body {
          overflow-x: hidden;
        }

        .rp-page {
          min-height: 100vh;
          min-height: 100dvh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #ffffff;
          font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          padding: 20px;
        }

        .rp-card {
          width: 100%;
          max-width: 420px;
          text-align: center;
        }

        /* ── Shared Title Styles ── */
        .rp-title {
          font-size: 28px;
          font-weight: 700;
          margin-bottom: 10px;
          letter-spacing: -0.5px;
        }

        .rp-title.teal {
          color: #2d6a7a;
        }

        .rp-title.red {
          color: #ef4444;
        }

        .rp-subtitle {
          font-size: 15px;
          color: #64748b;
          margin-bottom: 36px;
          font-weight: 400;
        }

        /* ── Error Icon ── */
        .rp-error-icon {
          width: 64px;
          height: 64px;
          border-radius: 50%;
          background: #fef2f2;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ef4444;
          margin: 0 auto 20px;
        }

        /* ── Form Styles ── */
        .rp-form {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .rp-input-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }

        .rp-input {
          width: 100%;
          padding: 14px 48px 14px 48px;
          border: none;
          border-radius: 12px;
          background: #f0ecec;
          font-size: 14px;
          font-family: inherit;
          color: #1e293b;
          outline: none;
          transition: all 0.2s;
        }

        .rp-input::placeholder {
          color: #94a3b8;
        }

        .rp-input:focus {
          background: #e8e4e4;
          box-shadow: 0 0 0 2px rgba(192, 57, 43, 0.15);
        }

        .rp-input-icon {
          position: absolute;
          left: 16px;
          color: #1e293b;
          font-size: 18px;
          display: flex;
          align-items: center;
        }

        .rp-eye-btn {
          position: absolute;
          right: 16px;
          background: none;
          border: none;
          cursor: pointer;
          color: #1e293b;
          padding: 4px;
          display: flex;
          align-items: center;
          border-radius: 4px;
          transition: color 0.2s;
          font-size: 18px;
        }

        .rp-eye-btn:hover {
          color: #64748b;
        }

        .rp-submit-btn {
          width: 100%;
          padding: 14px 24px;
          margin-top: 10px;
          border: none;
          border-radius: 12px;
          background: #f56565;
          color: #fff;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.2s;
        }

        .rp-submit-btn:hover:not(:disabled) {
          background: #e53e3e;
          transform: translateY(-1px);
          box-shadow: 0 4px 16px rgba(245, 101, 101, 0.35);
        }

        .rp-submit-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        /* Mobile */
        @media (max-width: 480px) {
          .rp-title {
            font-size: 24px;
          }
          .rp-subtitle {
            font-size: 14px;
            margin-bottom: 28px;
          }
          .rp-input {
            padding: 12px 44px 12px 44px;
            font-size: 16px;
          }
          .rp-submit-btn {
            padding: 12px 20px;
            font-size: 14px;
          }
        }
      `}</style>

      <div className="rp-page">
        <div className="rp-card">
          {isValidToken === false ? (
            /* ── INVALID TOKEN STATE ── */
            <>
              <div className="rp-error-icon">
                <FiAlertTriangle size={28} />
              </div>
              <h1 className="rp-title red">Invalid Link</h1>
              <p className="rp-subtitle">
                This password reset link is invalid or has expired.
              </p>
              <button
                type="button"
                className="rp-submit-btn"
                onClick={() => router.push("/forgot-password")}
              >
                Request New Link
              </button>
            </>
          ) : (
            /* ── RESET PASSWORD FORM ── */
            <>
              <h1 className="rp-title teal">Reset Password</h1>
              <p className="rp-subtitle">Enter your new password below</p>

              <form className="rp-form" onSubmit={handleSubmit}>
                <div className="rp-input-wrap">
                  <span className="rp-input-icon">
                    <FiLock size={18} />
                  </span>
                  <input
                    type={showNewPw ? "text" : "password"}
                    className="rp-input"
                    placeholder="New Password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    disabled={isSubmitting}
                  />
                  <button
                    type="button"
                    className="rp-eye-btn"
                    onClick={() => setShowNewPw((p) => !p)}
                    tabIndex={-1}
                  >
                    {showNewPw ? <FiEyeOff size={18} /> : <FiEye size={18} />}
                  </button>
                </div>

                <div className="rp-input-wrap">
                  <span className="rp-input-icon">
                    <FiLock size={18} />
                  </span>
                  <input
                    type={showConfirmPw ? "text" : "password"}
                    className="rp-input"
                    placeholder="Confirm new Password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    disabled={isSubmitting}
                  />
                  <button
                    type="button"
                    className="rp-eye-btn"
                    onClick={() => setShowConfirmPw((p) => !p)}
                    tabIndex={-1}
                  >
                    {showConfirmPw ? <FiEyeOff size={18} /> : <FiEye size={18} />}
                  </button>
                </div>

                <button
                  type="submit"
                  className="rp-submit-btn"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Resetting..." : "Reset Password"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </>
  );
}


export default function ResetPassword() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}