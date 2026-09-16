"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  FiGrid,
  FiShoppingBag,
  FiHeart,
  FiBell,
  FiHelpCircle,
  FiSettings,
  FiTrash2,
  FiAlertTriangle,
  FiUser,
  FiPhone,
  FiMail,
  FiLock,
  FiMoreHorizontal,
  FiEdit2,
  FiCheck,
  FiCamera,
  FiLogOut,
  FiChevronDown,
  FiMapPin,
  FiEye,
  FiEyeOff,
  FiMenu,
  FiX,
  FiAlertCircle,
  FiShield,
} from "react-icons/fi";
import { toast } from "react-toastify";

import { deleteAccountWithReauth, reauthFetch } from "@/lib/accountActions";

const PRIMARY = "#C0392B";

export default function UserSettings() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("settings");
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [securityNotifs, setSecurityNotifs] = useState<{ id: string; type: string; createdAt: string; read: boolean }[]>([]);
  const [notifSeen, setNotifSeen] = useState(false);

  //active session state
  const [showSessionsModal, setShowSessionsModal] = useState(false);
  const [sessions, setSessions] = useState<
    {
      id: string;
      deviceLabel: string | null;
      ipAddress: string | null;
      lastActiveAt: string;
      isCurrent: boolean;
    }[]
  >([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // Change Password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [isSubmittingPw, setIsSubmittingPw] = useState(false);

  const { data: session, update: updateSession } = useSession();
  const router = useRouter();
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const notifDropdownRef = useRef<HTMLDivElement>(null);

    // 2FA state
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(session?.user?.twoFactorEnabled ?? false);
  const [show2FAModal, setShow2FAModal] = useState(false);
  const [tfaOtp, setTfaOtp] = useState("");
  const [tfaRequesting, setTfaRequesting] = useState(false);
  const [tfaConfirming, setTfaConfirming] = useState(false);
  const [tfaError, setTfaError] = useState("");
  const [showDisable2FAModal, setShowDisable2FAModal] = useState(false);
  const [tfaDisabling, setTfaDisabling] = useState(false);

  //phone otp state for save changes
  const [showPhoneOtpModal, setShowPhoneOtpModal] = useState(false);
  const [phoneOtp, setPhoneOtp] = useState("");
  const [phoneOtpError, setPhoneOtpError] = useState("");
  const [pendingPhone, setPendingPhone] = useState("");
  const [confirmingPhone, setConfirmingPhone] = useState(false);

 //avatar change
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
 
  const token = session?.accessToken;
  const isOAuthUser = session?.user?.provider !==  undefined && session.user.provider !== "credentials";

  function activityLabel(type: string) {
    switch (type) {
      case "PASSWORD_CHANGED": return "Password changed";
      case "TWO_FA_ENABLED": return "Two-factor authentication enabled";
      case "TWO_FA_DISABLED": return "Two-factor authentication disabled";
      case "PHONE_CHANGED": return "Phone number changed";
      default: return type;
    }
  }

  // Compute profile-completeness notifications (reused from Navbar logic)
  const notifications: string[] = session
    ? ([
        !session.user?.phone && "Add your phone number",
        !session.user?.address && "Add your address",
        ...securityNotifs.filter((n) => !n.read).map((n) => activityLabel(n.type)),
      ].filter(Boolean) as string[])
    : [];
  const notificationCount = notifications.length;

  const sidebarItems = [
    { id: "dashboard", icon: FiGrid, label: "Dashboard", href: "/user/dashboard" },
    { id: "orders", icon: FiShoppingBag, label: "My Orders", href: "/user/orders" },
    { id: "wishlist", icon: FiHeart, label: "Wishlist", href: "/user/wishlist" },
    { id: "notification", icon: FiBell, label: "Notifications", href: "/user/notifications" },
    { id: "help", icon: FiHelpCircle, label: "Help & Support", href: "/user/help" },
    { id: "settings", icon: FiSettings, label: "Settings", href: "/user/settings" },
  ];

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(e.target as Node)) {
        setShowProfileDropdown(false);
      }
      if (notifDropdownRef.current && !notifDropdownRef.current.contains(e.target as Node)) {
        setShowNotifDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

 // Prevent body scroll when mobile sidebar is open
  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [sidebarOpen]);

  // Reconcile 2FA state with DB truth on mount (session JWT can go stale)
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch("/api/user/profile/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (typeof data.twoFactorEnabled === "boolean" && data.twoFactorEnabled !== session?.user?.twoFactorEnabled) {
          setTwoFactorEnabled(data.twoFactorEnabled);
          await updateSession({ user: { ...session?.user, twoFactorEnabled: data.twoFactorEnabled } });
        }
      } catch {
        // silent â€” non-critical background sync
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token) return;
    fetch("/api/user/notifications/security", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : []))
      .then(setSecurityNotifs)
      .catch(() => {});
  }, [token]);

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await deleteAccountWithReauth(token);
      if (res.status === 499) return; // user cancelled the confirmation
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.message || "Failed to delete account");
      }
      toast.success("Account deleted successfully.");
      await signOut({ redirect: false });
      router.push("/");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setDeleteError(msg);
      setDeleting(false);
    }
  }

  async function handlePasswordUpdate() {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error("Please fill in all fields.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match!");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }
    setIsSubmittingPw(true);
    try {
      const res = await fetch("/api/user/profile/password", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || "Failed to update password.");
      }
      toast.success("Password updated successfully!");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong!");
    } finally {
      setIsSubmittingPw(false);
    }
  }

  //image in avatar helper
  function getImageUrl(image?: string | null) {
  if (!image) return "";
  return image.startsWith("http")
    ? image
    : `${process.env.NEXT_PUBLIC_API_URL}${image}`;
  }

  const userInitials = session?.user?.name
    ? session.user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "U";

  const [profileForm, setProfileForm] = useState({
      name: session?.user?.name || "",
      phone: session?.user?.phone || "",
      address: session?.user?.address || "",
    });
    const [savingProfile, setSavingProfile] = useState(false);

  const sessionSnapshot = `${session?.user?.name || ""}|${session?.user?.phone || ""}|${session?.user?.address || ""}|${session?.user?.twoFactorEnabled ?? ""}`;
      const [lastSessionSnapshot, setLastSessionSnapshot] = useState(sessionSnapshot);

      if (!isEditing && sessionSnapshot !== lastSessionSnapshot) {
        setLastSessionSnapshot(sessionSnapshot);
        setProfileForm({
          name: session?.user?.name || "",
          phone: session?.user?.phone || "",
          address: session?.user?.address || "",
        });
        setTwoFactorEnabled(session?.user?.twoFactorEnabled ?? false);
      }

  const profileFields = [
    { key: "name", icon: FiUser, label: "Full Name", value: profileForm.name, type: "text", editable: true },
    { key: "phone", icon: FiPhone, label: "Phone Number", value: profileForm.phone, type: "tel", editable: true },
    { key: "email", icon: FiMail, label: "Email Address", value: session?.user?.email || "â€”", type: "email", editable: false },
    { key: "address", icon: FiMapPin, label: "Address", value: profileForm.address, type: "text", editable: true },
  ];


  //avatar change
  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5MB.");
      return;
    }

    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch("/api/user/profile/avatar", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || "Failed to upload photo.");
      }
      const data = await res.json();
      await updateSession({ user: { ...session?.user, image: data.image } });
      toast.success("Profile photo updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong!");
    } finally {
      setUploadingAvatar(false);
    }
  }
  
//profile save
  async function handleProfileSave() {
    const phoneChanged = profileForm.phone !== (session?.user?.phone || "");

    setSavingProfile(true);
    try {
      const res = await fetch("/api/user/profile/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: profileForm.name,
          address: profileForm.address,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || "Failed to update profile.");
      }

      if (phoneChanged && profileForm.phone) {
        const phoneRes = await reauthFetch(
          "/api/user/profile/phone/request",
          token,
          { phone: profileForm.phone },
        );
        if (phoneRes.status === 499) return; // user cancelled the confirmation
        if (!phoneRes.ok) {
          const data = await phoneRes.json().catch(() => null);
          setProfileForm((prev) => ({ ...prev, phone: session?.user?.phone || "" }));
          throw new Error(data?.message || "Failed to update phone number.");
        }
        setPendingPhone(profileForm.phone);
        setPhoneOtp("");
        setPhoneOtpError("");
        setShowPhoneOtpModal(true);
        toast.success("Profile updated. Enter the code sent to your new number to confirm it.");
        setIsEditing(false);
        return;
      }

      toast.success("Profile updated successfully!");
      setIsEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong!");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleConfirmPhoneOtp() {
    if (!phoneOtp || phoneOtp.length < 6) {
      setPhoneOtpError("Enter the 6-digit code we sent you.");
      return;
    }
    setConfirmingPhone(true);
    setPhoneOtpError("");
    try {
      const res = await fetch("/api/user/profile/phone/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ otp: phoneOtp }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || "Invalid or expired code.");
      }
      toast.success("Phone number verified.");
      setShowPhoneOtpModal(false);
      await updateSession({ user: { ...session?.user, phone: pendingPhone } });
    } catch (err) {
      setPhoneOtpError(err instanceof Error ? err.message : "Something went wrong!");
    } finally {
      setConfirmingPhone(false);
    }
  }

//revoke function for active session
  async function loadSessions() {
    setLoadingSessions(true);
    try {
      const res = await fetch("/api/sessions/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load sessions.");
      const data = await res.json();
      setSessions(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong!");
    } finally {
      setLoadingSessions(false);
    }
  }

  async function handleRevokeSession(id: string) {
    setRevokingId(id);
    try {
      const res = await fetch(`/api/sessions/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to revoke session.");
      setSessions((prev) => prev.filter((s) => s.id !== id));
      toast.success("Session revoked.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong!");
    } finally {
      setRevokingId(null);
    }
  }

  // request an OTP to enable 2FA
async function handleRequestEnable2FA() {
  setTfaRequesting(true);
  setTfaError("");
  try {
    const res = await fetch("/api/user/2fa/enable", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      if (data?.message === "Two-factor is already enabled.") {
        setTwoFactorEnabled(true);
        await updateSession({ user: { ...session?.user, twoFactorEnabled: true } });
        return;
      }
      throw new Error(data?.message || "Failed to start 2FA setup.");
    }
    setTfaOtp("");
    setShow2FAModal(true);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Something went wrong!");
  } finally {
    setTfaRequesting(false);
  }
}

// confirm the OTP to actually turn 2FA on
async function handleConfirmEnable2FA() {
  if (!tfaOtp || tfaOtp.length < 6) {
    setTfaError("Enter the 6-digit code we sent you.");
    return;
  }
  setTfaConfirming(true);
  setTfaError("");
  try {
    const res = await fetch("/api/user/2fa/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ otp: tfaOtp }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.message || "Invalid or expired code.");
    }
    setTwoFactorEnabled(true);
    setShow2FAModal(false);
    toast.success("Two-factor authentication enabled.");
    await updateSession({ user: { ...session?.user, twoFactorEnabled: true } });
  } catch (err) {
    setTfaError(err instanceof Error ? err.message : "Something went wrong!");
  } finally {
    setTfaConfirming(false);
  }
}

// Disable â€” requires step-up reauthentication (current password or OTP) per policy
async function handleDisable2FA() {
  setTfaDisabling(true);
  try {
    const res = await reauthFetch("/api/user/2fa/disable", token);
    if (res.status === 499) return; // user cancelled the confirmation
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.message || "Failed to disable 2FA.");
    }
    setTwoFactorEnabled(false);
    setShowDisable2FAModal(false);
    toast.success("Two-factor authentication disabled.");
    await updateSession({ user: { ...session?.user, twoFactorEnabled: false } });
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Something went wrong!");
  } finally {
    setTfaDisabling(false);
  }
}

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }

        html, body {
          overflow-x: hidden;
          max-width: 100vw;
        }

        .ud-page {
          min-height: 100vh;
          min-height: 100dvh;
          background: #f1f5f9;
          display: flex;
          font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        }

        /* â”€â”€ Sidebar â”€â”€ */
        .ud-sidebar {
          width: 260px;
          background: #ffffff;
          border-right: 1px solid #e8ecf0;
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          transition: width 0.3s ease, transform 0.3s ease;
          position: fixed;
          height: 100vh;
          height: 100dvh;
          left: 0;
          top: 0;
          z-index: 100;
          box-shadow: 2px 0 8px rgba(0,0,0,0.04);
        }

        .ud-sidebar.collapsed {
          width: 72px;
        }

        .ud-sidebar-header {
          padding: 20px 20px;
          display: flex;
          align-items: center;
          gap: 10px;
          border-bottom: 1px solid #f0f2f5;
          min-height: 72px;
          overflow: hidden;
        }

        .ud-sidebar-logo-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
          text-decoration: none;
          flex-shrink: 0;
        }

        .ud-sidebar-logo-icon {
          width: 36px;
          height: 36px;
          flex-shrink: 0;
        }

        .ud-sidebar-logo-text {
          display: flex;
          flex-direction: column;
          line-height: 1.1;
          opacity: 1;
          transition: opacity 0.2s, width 0.2s;
          white-space: nowrap;
          overflow: hidden;
        }

        .ud-sidebar.collapsed .ud-sidebar-logo-text {
          opacity: 0;
          width: 0;
        }

        .ud-logo-line1 {
          font-size: 14px;
          font-weight: 800;
          color: ${PRIMARY};
          letter-spacing: -0.3px;
        }

        .ud-logo-line2 {
          font-size: 11px;
          font-weight: 600;
          color: #888;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }

        .ud-nav-section {
          padding: 16px 12px;
          flex: 1;
          overflow-y: auto;
        }

        .ud-nav-label {
          font-size: 10px;
          font-weight: 700;
          color: #b0b8c4;
          text-transform: uppercase;
          letter-spacing: 1.2px;
          padding: 0 12px;
          margin-bottom: 8px;
          white-space: nowrap;
        }

        .ud-sidebar.collapsed .ud-nav-label {
          display: none;
        }

        .ud-nav-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 14px;
          color: #5a6478;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          border: none;
          background: none;
          width: 100%;
          text-align: left;
          font-family: inherit;
          text-decoration: none;
          border-radius: 10px;
          margin-bottom: 2px;
          position: relative;
          white-space: nowrap;
        }

        .ud-nav-item:hover {
          background: #f4f6fb;
          color: #1e293b;
        }

        .ud-nav-item.active {
          background: #fff5f5;
          color: ${PRIMARY};
          font-weight: 600;
        }

        .ud-nav-item.active::before {
          content: "";
          position: absolute;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          width: 3px;
          height: 20px;
          background: ${PRIMARY};
          border-radius: 0 3px 3px 0;
        }

        .ud-nav-icon {
          font-size: 18px;
          width: 22px;
          display: flex;
          justify-content: center;
          flex-shrink: 0;
        }

        .ud-nav-text {
          opacity: 1;
          transition: opacity 0.2s;
        }

        .ud-sidebar.collapsed .ud-nav-text {
          opacity: 0;
          width: 0;
          overflow: hidden;
        }

        .ud-sidebar-footer {
          padding: 16px;
          border-top: 1px solid #f0f2f5;
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .ud-sidebar-avatar {
          width: 38px;
          height: 38px;
          border-radius: 50%;
          background: linear-gradient(135deg, ${PRIMARY}, #e74c3c);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-size: 14px;
          font-weight: 600;
          flex-shrink: 0;
          overflow: hidden;
        }

        .ud-sidebar-user {
          opacity: 1;
          transition: opacity 0.2s;
          overflow: hidden;
        }

        .ud-sidebar.collapsed .ud-sidebar-user {
          opacity: 0;
          width: 0;
        }

        .ud-sidebar-name {
          font-size: 13px;
          font-weight: 600;
          color: #1e293b;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 160px;
        }

        .ud-sidebar-role {
          font-size: 11px;
          color: #94a3b8;
          margin-top: 1px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 160px;
        }

        /* â”€â”€ Main Area â”€â”€ */
        .ud-main-area {
          flex: 1;
          margin-left: 260px;
          display: flex;
          flex-direction: column;
          min-height: 100vh;
          min-height: 100dvh;
          transition: margin-left 0.3s ease;
          width: calc(100% - 260px);
          min-width: 0;
        }

        .ud-sidebar.collapsed ~ .ud-main-area {
          margin-left: 72px;
          width: calc(100% - 72px);
        }

        /* â”€â”€ Top Header â”€â”€ */
        .ud-topbar {
          background: #fff;
          border-bottom: 1px solid #e2e8f0;
          padding: 0 32px;
          height: 64px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          position: sticky;
          top: 0;
          z-index: 50;
          gap: 16px;
        }

        .ud-topbar-left {
          display: flex;
          align-items: center;
          gap: 16px;
          flex: 1;
          min-width: 0;
        }

        .ud-toggle-btn {
          width: 36px;
          height: 36px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          background: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: #64748b;
          transition: all 0.2s;
          flex-shrink: 0;
        }

        .ud-toggle-btn:hover {
          background: #f8fafc;
          color: #334155;
          border-color: #cbd5e1;
        }

        .ud-breadcrumb {
          font-size: 20px;
          font-weight: 700;
          color: #1e293b;
          letter-spacing: -0.3px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .ud-topbar-right {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-shrink: 0;
        }

        .ud-icon-btn {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          border: 1px solid #e2e8f0;
          background: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: #64748b;
          transition: all 0.2s;
          position: relative;
          text-decoration: none;
          flex-shrink: 0;
        }

        .ud-icon-btn:hover {
          background: #f8fafc;
          color: #334155;
          border-color: #cbd5e1;
        }

        .ud-badge {
          position: absolute;
          top: -2px;
          right: -2px;
          width: 18px;
          height: 18px;
          background: #ef4444;
          color: #fff;
          font-size: 10px;
          font-weight: 700;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 2px solid #fff;
        }

        /* â”€â”€ Profile Avatar Dropdown â”€â”€ */
        .ud-profile-wrap {
          position: relative;
        }

        .ud-profile-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 5px 10px 5px 5px;
          border-radius: 40px;
          border: 1.5px solid #e2e8f0;
          background: #fff;
          cursor: pointer;
          transition: all 0.2s;
          font-family: inherit;
        }

        .ud-profile-btn:hover {
          border-color: #cbd5e1;
          background: #f8fafc;
        }

        .ud-profile-btn-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: linear-gradient(135deg, ${PRIMARY}, #e74c3c);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-size: 12px;
          font-weight: 700;
          overflow: hidden;
          flex-shrink: 0;
        }

        .ud-profile-btn-name {
          font-size: 13px;
          font-weight: 600;
          color: #1e293b;
          max-width: 120px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .ud-profile-chevron {
          color: #94a3b8;
          transition: transform 0.2s;
          flex-shrink: 0;
        }

        .ud-profile-chevron.open {
          transform: rotate(180deg);
        }

        .ud-profile-dropdown {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.1);
          min-width: 200px;
          z-index: 999;
          overflow: hidden;
          animation: dropdownIn 0.15s ease;
        }

        @keyframes dropdownIn {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .ud-dropdown-header {
          padding: 14px 16px 12px;
          border-bottom: 1px solid #f1f5f9;
        }

        .ud-dropdown-username {
          font-size: 14px;
          font-weight: 700;
          color: #1e293b;
        }

        .ud-dropdown-email {
          font-size: 12px;
          color: #94a3b8;
          margin-top: 2px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .ud-dropdown-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 11px 16px;
          font-size: 14px;
          font-weight: 500;
          color: #475569;
          cursor: pointer;
          transition: all 0.15s;
          border: none;
          background: none;
          width: 100%;
          text-align: left;
          font-family: inherit;
          text-decoration: none;
        }

        .ud-dropdown-item:hover {
          background: #f8fafc;
          color: #1e293b;
        }

        .ud-dropdown-item.logout {
          color: #ef4444;
        }

        .ud-dropdown-item.logout:hover {
          background: #fef2f2;
          color: #dc2626;
        }

        .ud-dropdown-divider {
          height: 1px;
          background: #f1f5f9;
          margin: 0;
        }

        /* â”€â”€ Main Content â”€â”€ */
        .ud-main {
          flex: 1;
          padding: 28px 32px;
          overflow-y: auto;
          min-width: 0;
        }

        /* Profile Header */
        .ud-profile-header {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          padding: 32px;
          margin-bottom: 24px;
          display: flex;
          align-items: center;
          gap: 24px;
          position: relative;
          flex-wrap: wrap;
        }

        .ud-profile-avatar-wrap {
          position: relative;
          flex-shrink: 0;
        }

        .ud-profile-avatar {
          width: 80px;
          height: 80px;
          border-radius: 50%;
          background: linear-gradient(135deg, ${PRIMARY}, #e74c3c);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-size: 28px;
          font-weight: 700;
          overflow: hidden;
        }

        .ud-avatar-edit {
          position: absolute;
          bottom: 0;
          right: 0;
          width: 28px;
          height: 28px;
          background: #fff;
          border: 2px solid #e2e8f0;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: #64748b;
          transition: all 0.2s;
        }

        .ud-avatar-edit:hover {
          border-color: ${PRIMARY};
          color: ${PRIMARY};
        }

        .ud-profile-info {
          flex: 1;
          min-width: 0;
        }

        .ud-profile-name {
          font-size: 22px;
          font-weight: 700;
          color: #1e293b;
          letter-spacing: -0.3px;
          margin-bottom: 4px;
        }

        .ud-profile-role {
          font-size: 14px;
          color: #64748b;
          font-weight: 500;
        }

        .ud-profile-actions {
          display: flex;
          gap: 10px;
          flex-shrink: 0;
        }

        .ud-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 10px 20px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          border: none;
          font-family: inherit;
        }

        .ud-btn-primary {
          background: #4f46e5;
          color: #fff;
        }

        .ud-btn-primary:hover {
          background: #4338ca;
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25);
        }

        .ud-btn-ghost {
          background: #f1f5f9;
          color: #475569;
          border: 1px solid #e2e8f0;
        }

        .ud-btn-ghost:hover {
          background: #e2e8f0;
        }

        /* Section Title */
        .ud-section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
          gap: 12px;
          flex-wrap: wrap;
        }

        .ud-section-title {
          font-size: 16px;
          font-weight: 700;
          color: #1e293b;
          letter-spacing: -0.2px;
        }

        /* Form Card */
        .ud-form-card {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 24px;
          width: 100%;
        }

        .ud-form-row {
          display: flex;
          align-items: center;
          gap: 0;
          padding: 0 24px;
          border-bottom: 1px solid #f8fafc;
          transition: background 0.2s;
        }

        .ud-form-row:hover {
          background: #fafbfc;
        }

        .ud-form-row:last-child {
          border-bottom: none;
        }

        .ud-form-label {
          flex: 0 0 180px;
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 13px;
          color: #475569;
          font-weight: 600;
          padding: 18px 0;
          flex-shrink: 0;
        }

        .ud-form-label svg {
          color: #94a3b8;
        }

        .ud-form-value {
          flex: 1;
          font-size: 14px;
          color: #1e293b;
          font-weight: 500;
          padding: 18px 0;
          min-width: 0;
        }

        .ud-form-input {
          flex: 1;
          padding: 10px 14px;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          font-size: 14px;
          font-family: inherit;
          color: #1e293b;
          outline: none;
          transition: all 0.2s;
          min-width: 0;
        }

        .ud-form-input:focus {
          border-color: #6366f1;
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        }

        /* Security Card */
        .ud-security-card {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 24px;
          margin-bottom: 24px;
          width: 100%;
        }

        .ud-security-title {
          font-size: 14px;
          font-weight: 700;
          color: #1e293b;
          margin-bottom: 16px;
        }

        .ud-security-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 0;
          border-bottom: 1px solid #f8fafc;
          gap: 12px;
          flex-wrap: wrap;
        }

        .ud-security-row:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }

        .ud-security-info {
          flex: 1;
          min-width: 0;
        }

        .ud-security-info h4 {
          font-size: 14px;
          font-weight: 600;
          color: #1e293b;
          margin-bottom: 3px;
        }

        .ud-security-info p {
          font-size: 12px;
          color: #64748b;
        }

        /* Change Password Card */
        .ud-pw-card {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 28px;
          margin-bottom: 24px;
          width: 100%;
        }

        .ud-pw-oauth-msg {
          font-size: 14px;
          color: #64748b;
          padding: 16px 0;
          line-height: 1.6;
        }

        .ud-pw-fields {
          display: flex;
          flex-direction: column;
          gap: 16px;
          margin-bottom: 20px;
        }

        .ud-pw-field-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .ud-pw-label {
          font-size: 13px;
          font-weight: 600;
          color: #475569;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .ud-pw-input-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }

        .ud-pw-input {
          width: 100%;
          padding: 11px 44px 11px 14px;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          font-size: 14px;
          font-family: inherit;
          color: #1e293b;
          outline: none;
          transition: all 0.2s;
          background: #fafbfc;
        }

        .ud-pw-input:focus {
          border-color: #6366f1;
          background: #fff;
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        }

        .ud-pw-eye-btn {
          position: absolute;
          right: 12px;
          background: none;
          border: none;
          cursor: pointer;
          color: #94a3b8;
          padding: 4px;
          display: flex;
          align-items: center;
          border-radius: 4px;
          transition: color 0.2s;
          font-size: 15px;
        }

        .ud-pw-eye-btn:hover {
          color: #6366f1;
        }

        .ud-pw-submit-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 11px 24px;
          background: ${PRIMARY};
          color: #fff;
          border: none;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.2s;
        }

        .ud-pw-submit-btn:hover:not(:disabled) {
          background: #a93226;
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(192,57,43,0.25);
        }

        .ud-pw-submit-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        /* Delete Account sidebar button */
        .ud-nav-item.danger {
          color: rgba(239,68,68,0.7);
        }
        .ud-nav-item.danger:hover {
          background: rgba(239,68,68,0.06);
          color: #ef4444;
        }

        /* â”€â”€ Backdrop (mobile overlay) â”€â”€ */
        .ud-backdrop {
          display: none;
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.45);
          backdrop-filter: blur(2px);
          z-index: 99;
          animation: backdropIn 0.2s ease;
        }
        @keyframes backdropIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }

        /* Mobile sidebar close button */
        .ud-sidebar-close {
          display: none;
          position: absolute;
          top: 18px;
          right: 16px;
          width: 32px;
          height: 32px;
          border: none;
          background: #f1f5f9;
          border-radius: 8px;
          cursor: pointer;
          align-items: center;
          justify-content: center;
          color: #64748b;
          transition: all 0.2s;
          z-index: 1;
        }
        .ud-sidebar-close:hover {
          background: #e2e8f0;
          color: #1e293b;
        }

        /* Hamburger - hidden on desktop */
        .ud-hamburger {
          display: none;
          width: 38px;
          height: 38px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          background: #fff;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: #64748b;
          transition: all 0.2s;
          flex-shrink: 0;
        }
        .ud-hamburger:hover {
          background: #f8fafc;
          color: #334155;
          border-color: #cbd5e1;
        }

        /* Desktop toggle - hidden on mobile */
        .ud-desktop-toggle {
          display: flex;
        }

        /* â”€â”€ Responsive â”€â”€ */

        /* Tablet + Mobile: overlay sidebar */
        @media (max-width: 1023px) {
          .ud-sidebar {
            transform: translateX(-100%);
            width: 280px !important;
            z-index: 200;
          }
          .ud-sidebar.mobile-open {
            transform: translateX(0);
            box-shadow: 4px 0 32px rgba(0,0,0,0.15);
          }
          .ud-backdrop.active {
            display: block;
          }
          .ud-sidebar.mobile-open .ud-sidebar-close {
            display: flex;
          }
          .ud-hamburger {
            display: flex;
          }
          .ud-desktop-toggle {
            display: none;
          }
          .ud-main-area {
            margin-left: 0 !important;
            width: 100% !important;
          }
          .ud-main {
            padding: 20px 20px 32px;
          }
          .ud-topbar {
            padding: 0 20px;
          }
        }

        /* Mobile: < 768px */
        @media (max-width: 767px) {
          .ud-main {
            padding: 16px;
          }
          .ud-topbar {
            padding: 0 16px;
            height: 56px;
          }
          .ud-breadcrumb {
            font-size: 18px;
          }

          /* Profile header */
          .ud-profile-header {
            flex-direction: column;
            text-align: center;
            padding: 24px;
            gap: 16px;
          }
          .ud-profile-avatar {
            width: 64px;
            height: 64px;
            font-size: 22px;
          }
          .ud-profile-name {
            font-size: 18px;
          }
          .ud-profile-actions {
            width: 100%;
            justify-content: center;
          }

          /* Form rows */
          .ud-form-row {
            flex-direction: column;
            align-items: flex-start;
            padding: 14px 16px;
            gap: 6px;
          }
          .ud-form-label {
            flex: none;
            padding: 0;
            font-size: 12px;
          }
          .ud-form-value {
            padding: 0;
            font-size: 13px;
          }
          .ud-form-input {
            width: 100%;
          }

          /* Security rows */
          .ud-security-row {
            flex-direction: column;
            align-items: flex-start;
            gap: 10px;
          }
          .ud-security-info h4 {
            font-size: 13px;
          }
          .ud-security-info p {
            font-size: 11px;
          }

          /* Password card */
          .ud-pw-card {
            padding: 20px;
          }
          .ud-pw-input {
            padding: 10px 40px 10px 12px;
            font-size: 13px;
          }

          /* Profile btn */
          .ud-profile-btn-name {
            display: none;
          }
        }

        /* Small mobile: < 480px */
        @media (max-width: 480px) {
          .ud-main {
            padding: 12px;
          }
          .ud-topbar {
            padding: 0 12px;
          }
          .ud-profile-header {
            padding: 20px;
          }
          .ud-profile-avatar {
            width: 56px;
            height: 56px;
            font-size: 20px;
          }
          .ud-avatar-edit {
            width: 24px;
            height: 24px;
          }
          .ud-btn {
            padding: 8px 16px;
            font-size: 12px;
          }
          .ud-pw-card {
            padding: 16px;
          }
          .ud-section-title {
            font-size: 14px;
          }
        }

        /* â”€â”€ Delete Account Modal â”€â”€ */
        .ud-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          backdrop-filter: blur(4px);
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          animation: fadeIn 0.2s ease;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .ud-modal {
          background: #fff;
          border-radius: 16px;
          padding: 32px;
          width: 100%;
          max-width: 420px;
          box-shadow: 0 25px 50px rgba(0,0,0,0.25);
          animation: slideUp 0.25s ease;
        }
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        .ud-modal-icon {
          width: 56px;
          height: 56px;
          border-radius: 14px;
          background: #fef2f2;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ef4444;
          margin: 0 auto 20px;
        }
        .ud-modal-title {
          font-size: 18px;
          font-weight: 700;
          color: #1e293b;
          text-align: center;
          margin-bottom: 8px;
        }
        .ud-modal-body {
          font-size: 14px;
          color: #64748b;
          text-align: center;
          line-height: 1.6;
          margin-bottom: 24px;
        }
        .ud-modal-body strong { color: #ef4444; }
        .ud-modal-error {
          font-size: 13px;
          color: #ef4444;
          background: #fef2f2;
          border-radius: 8px;
          padding: 10px 14px;
          margin-bottom: 16px;
          text-align: center;
        }
        .ud-modal-actions {
          display: flex;
          gap: 12px;
        }
        .ud-modal-cancel {
          flex: 1;
          padding: 11px 0;
          border-radius: 10px;
          border: 1.5px solid #e2e8f0;
          background: #fff;
          color: #475569;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          font-family: inherit;
        }
        .ud-modal-cancel:hover {
          background: #f8fafc;
          border-color: #cbd5e1;
        }
        .ud-modal-delete {
          flex: 1;
          padding: 11px 0;
          border-radius: 10px;
          border: none;
          background: #ef4444;
          color: #fff;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          font-family: inherit;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .ud-modal-delete:hover:not(:disabled) { background: #dc2626; }
        .ud-modal-delete:disabled { opacity: 0.7; cursor: not-allowed; }
      `}</style>

      {/* â”€â”€ Mobile Backdrop â”€â”€ */}
      <div
        className={`ud-backdrop ${sidebarOpen ? "active" : ""}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />

      <div className="ud-page">
        {/* â”€â”€ Sidebar â”€â”€ */}
        <aside className={`ud-sidebar ${sidebarOpen ? "mobile-open" : ""} ${sidebarCollapsed ? "collapsed" : ""}`}>
          {/* Mobile close button */}
          <button
            type="button"
            className="ud-sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <FiX size={18} />
          </button>

          {/* Logo */}
          <div className="ud-sidebar-header">
            <Link href="/" className="ud-sidebar-logo-wrap">
              <svg className="ud-sidebar-logo-icon" viewBox="0 0 38 38" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="38" height="38" rx="8" fill={PRIMARY} />
                <path
                  d="M10 10 C10 10, 14 8, 19 13 C24 18, 28 10, 28 10
                     M10 28 C10 28, 14 30, 19 25 C24 20, 28 28, 28 28
                     M10 10 Q10 19 10 28
                     M28 10 Q28 19 28 28
                     M14 19 C14 19 16 22 19 22 C22 22 24 19 24 19"
                  stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"
                />
                <circle cx="19" cy="19" r="3" fill="#fff" opacity="0.9" />
              </svg>
              <div className="ud-sidebar-logo-text">
                <span className="ud-logo-line1">HamroNepal</span>
                <span className="ud-logo-line2">Bazaar</span>
              </div>
            </Link>
          </div>

          <div className="ud-nav-section">
            <div className="ud-nav-label">Menu</div>
            {sidebarItems.slice(0, 4).map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className={`ud-nav-item ${activeTab === item.id ? "active" : ""}`}
                onClick={() => { setActiveTab(item.id); setSidebarOpen(false); }}
              >
                <span className="ud-nav-icon">
                  <item.icon size={18} />
                </span>
                <span className="ud-nav-text">{item.label}</span>
              </Link>
            ))}

            <div className="ud-nav-label" style={{ marginTop: 16 }}>Account</div>
            {sidebarItems.slice(4).map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className={`ud-nav-item ${activeTab === item.id ? "active" : ""}`}
                onClick={() => { setActiveTab(item.id); setSidebarOpen(false); }}
              >
                <span className="ud-nav-icon">
                  <item.icon size={18} />
                </span>
                <span className="ud-nav-text">{item.label}</span>
              </Link>
            ))}

            {/* Delete Account */}
            <button
              type="button"
              className="ud-nav-item danger"
              onClick={() => { setShowDeleteModal(true); setSidebarOpen(false); }}
              title="Delete Account"
            >
              <span className="ud-nav-icon">
                <FiTrash2 size={18} />
              </span>
              <span className="ud-nav-text">Delete Account</span>
            </button>
          </div>

          {/* Sidebar footer intentionally left empty */}
        </aside>

        {/* â”€â”€ Main Area â”€â”€ */}
        <div className="ud-main-area">
          {/* Top Header */}
          <header className="ud-topbar">
            <div className="ud-topbar-left">
              {/* Hamburger - mobile only */}
              <button
                type="button"
                className="ud-hamburger"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open sidebar"
              >
                <FiMenu size={20} />
              </button>
              {/* Desktop toggle - desktop only */}
              <button
                type="button"
                className="ud-toggle-btn ud-desktop-toggle"
                onClick={() => setSidebarCollapsed((prev) => !prev)}
                title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                <FiMoreHorizontal size={18} />
              </button>
              <h1 className="ud-breadcrumb">Settings</h1>
            </div>
            <div className="ud-topbar-right">
              {/* Notifications Bell */}
              <div style={{ position: "relative" }} ref={notifDropdownRef}>
                <button
                  type="button"
                  className="ud-icon-btn"
                  title="Notifications"
                  onClick={() => {
                    setShowNotifDropdown((v) => !v);
                    setNotifSeen(true);
                    if (securityNotifs.some((n) => !n.read)) {
                      fetch("/api/user/notifications/security/mark-read", {
                        method: "POST",
                        headers: { Authorization: `Bearer ${token}` },
                      }).then(() => {
                       setSecurityNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
                      });
                    }

                  }}
                >
                  <FiBell size={18} />
                  {notificationCount > 0 && !notifSeen && (
                    <span className="ud-badge">{notificationCount}</span>
                  )}
                </button>

                {showNotifDropdown && (
                  <div style={{
                    position: "absolute",
                    top: "calc(100% + 10px)",
                    right: 0,
                    background: "#fff",
                    border: "1px solid #e2e8f0",
                    borderRadius: "12px",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.1)",
                    minWidth: "280px",
                    zIndex: 999,
                    overflow: "hidden",
                    animation: "dropdownIn 0.15s ease",
                  }}>
                    <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9", fontWeight: 700, fontSize: "13px", color: "#1e293b" }}>
                      Notifications
                    </div>
                    {notifications.length > 0 ? (
                      notifications.map((msg, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            padding: "12px 16px",
                            fontSize: "13px",
                            color: "#475569",
                            borderBottom: i < notifications.length - 1 ? "1px solid #f8fafc" : "none",
                          }}
                        >
                          <FiAlertCircle size={15} color="#f59e0b" style={{ flexShrink: 0 }} />
                          {msg}
                        </div>
                      ))
                    ) : (
                      <div style={{ padding: "16px", fontSize: "13px", color: "#94a3b8", textAlign: "center" }}>
                        You&apos;re all caught up âœ“
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Profile Avatar Dropdown */}
              <div className="ud-profile-wrap" ref={profileDropdownRef}>
                <button
                  type="button"
                  className="ud-profile-btn"
                  onClick={() => setShowProfileDropdown((prev) => !prev)}
                >
                  <div className="ud-profile-btn-avatar">
                    {session?.user?.image
                      ? <img src={getImageUrl(session.user.image)} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : userInitials
                    }
                  </div>
                  <FiChevronDown size={14} className={`ud-profile-chevron ${showProfileDropdown ? "open" : ""}`} />
                </button>

                {showProfileDropdown && (
                  <div className="ud-profile-dropdown">
                    <div className="ud-dropdown-header">
                      <div className="ud-dropdown-username">{session?.user?.name || "User"}</div>
                      <div className="ud-dropdown-email">{session?.user?.email || ""}</div>
                    </div>
                    <Link
                      href="/user/dashboard"
                      className="ud-dropdown-item"
                      onClick={() => setShowProfileDropdown(false)}
                    >
                      <FiUser size={15} />
                      Dashboard
                    </Link>
                    <div className="ud-dropdown-divider" />
                    <button
                      type="button"
                      className="ud-dropdown-item logout"
                      onClick={() => signOut({ callbackUrl: "/" })}
                    >
                      <FiLogOut size={15} />
                      Logout
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* Main Content */}
          <main className="ud-main">
            {/* Profile Header */}
            <div className="ud-profile-header">
              <div className="ud-profile-avatar-wrap">
                <div className="ud-profile-avatar">
                  {session?.user?.image
                    ? <img src={getImageUrl(session.user.image)} alt="avatar" style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} />
                    : userInitials}
                </div>
                <button
                  type="button"
                  className="ud-avatar-edit"
                  title="Change photo"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  style={{ cursor: uploadingAvatar ? "wait" : "pointer" }}
                >
                  <FiCamera size={12} />
                </button>
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={handleAvatarChange}
                  style={{ display: "none" }}
                />
              </div>

              <div className="ud-profile-info">
                <div className="ud-profile-name">{session?.user?.name || "User"}</div>
                <div className="ud-profile-role">Member Â· Kathmandu, Nepal</div>
              </div>
              
              <div className="ud-profile-actions">
                <button
                  type="button"
                  className={`ud-btn ${isEditing ? "ud-btn-primary" : "ud-btn-ghost"}`}
                  onClick={() => (isEditing ? handleProfileSave() : setIsEditing(true))}
                  disabled={savingProfile}
                >
                  {isEditing ? (
                    <>
                      <FiCheck size={14} /> {savingProfile ? "Saving..." : "Save Changes"}
                    </>
                  ) : (
                    <>
                      <FiEdit2 size={14} /> Edit Profile
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Account Details â€” Password field removed */}
            <div className="ud-section-header">
              <h3 className="ud-section-title">Account Information</h3>
            </div>

            <div className="ud-form-card">
              {profileFields.map((field) => (
                <div key={field.key} className="ud-form-row">
                  <div className="ud-form-label">
                    <field.icon size={16} />
                    {field.label}
                  </div>
                  {isEditing && field.editable ? (
                    <input
                      type={field.type}
                      className="ud-form-input"
                      value={field.value}
                      onChange={(e) => setProfileForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    />
                  ) : (
                    <div className="ud-form-value">{field.value || "-"}</div>
                  )}
                </div>
              ))}
            </div>

            {/* Security Section */}
            <div className="ud-section-header">
              <h3 className="ud-section-title">Security</h3>
            </div>
            <div className="ud-security-card">
              <div className="ud-security-row">
                <div className="ud-security-info">
                  <h4>Two-Factor Authentication</h4>
                  <p>
                    {twoFactorEnabled
                      ? "Your account is protected with an extra verification step."
                      : "Add an extra layer of security to your account"}
                  </p>
                </div>
                {twoFactorEnabled ? (
                  <button type="button" className="ud-btn ud-btn-ghost" style={{ color: "#ef4444" }} onClick={() => setShowDisable2FAModal(true)}>
                    Disable
                  </button>
                ) : (
                  <button type="button" className="ud-btn ud-btn-ghost" onClick={handleRequestEnable2FA} disabled={tfaRequesting}>
                    {tfaRequesting ? "Sending code..." : "Enable"}
                  </button>
                )}
              </div>

              <div className="ud-security-row">
                <div className="ud-security-info">
                  <h4>Active Sessions</h4>
                  <p>Manage devices where you&apos;re currently logged in</p>
                </div>
                <button type="button" className="ud-btn ud-btn-ghost" onClick={() => { setShowSessionsModal(true); loadSessions(); }}>
                  Manage
                </button>
              </div>
              </div>

            {/* Change Password Section */}
            <div className="ud-section-header">
              <h3 className="ud-section-title">Change Password</h3>
            </div>
            <div className="ud-pw-card">
              {isOAuthUser ? (
                <p className="ud-pw-oauth-msg">
                  You signed in with {session?.user?.provider || "a social account"}. Password management
                  is handled by your {session?.user?.provider || "social"} account and cannot be changed here.
                </p>
              ) : (
                <>
                  <div className="ud-pw-fields">
                    <div className="ud-pw-field-group">
                      <label className="ud-pw-label">
                        <FiLock size={14} />
                        Current Password
                      </label>
                      <div className="ud-pw-input-wrap">
                        <input
                          type={showCurrentPw ? "text" : "password"}
                          className="ud-pw-input"
                          placeholder="Enter current password"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          autoComplete="current-password"
                        />
                        <button
                          type="button"
                          className="ud-pw-eye-btn"
                          onClick={() => setShowCurrentPw((p) => !p)}
                          title={showCurrentPw ? "Hide" : "Show"}
                        >
                          {showCurrentPw ? <FiEyeOff size={15} /> : <FiEye size={15} />}
                        </button>
                      </div>
                    </div>

                    <div className="ud-pw-field-group">
                      <label className="ud-pw-label">
                        <FiLock size={14} />
                        New Password
                      </label>
                      <div className="ud-pw-input-wrap">
                        <input
                          type={showNewPw ? "text" : "password"}
                          className="ud-pw-input"
                          placeholder="At least 8 characters"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          autoComplete="new-password"
                        />
                        <button
                          type="button"
                          className="ud-pw-eye-btn"
                          onClick={() => setShowNewPw((p) => !p)}
                          title={showNewPw ? "Hide" : "Show"}
                        >
                          {showNewPw ? <FiEyeOff size={15} /> : <FiEye size={15} />}
                        </button>
                      </div>
                    </div>

                    <div className="ud-pw-field-group">
                      <label className="ud-pw-label">
                        <FiLock size={14} />
                        Confirm New Password
                      </label>
                      <div className="ud-pw-input-wrap">
                        <input
                          type={showConfirmPw ? "text" : "password"}
                          className="ud-pw-input"
                          placeholder="Repeat new password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          autoComplete="new-password"
                        />
                        <button
                          type="button"
                          className="ud-pw-eye-btn"
                          onClick={() => setShowConfirmPw((p) => !p)}
                          title={showConfirmPw ? "Hide" : "Show"}
                        >
                          {showConfirmPw ? <FiEyeOff size={15} /> : <FiEye size={15} />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="ud-pw-submit-btn"
                    onClick={handlePasswordUpdate}
                    disabled={isSubmittingPw}
                  >
                    <FiLock size={14} />
                    {isSubmittingPw ? "Updating..." : "Update Password"}
                  </button>
                </>
              )}
            </div>
          </main>
        </div>
      </div>

    {/* â”€â”€ Delete Account Confirmation Modal â”€â”€ */}
    {showDeleteModal && (
      <div className="ud-modal-overlay" onClick={() => !deleting && setShowDeleteModal(false)}>
        <div className="ud-modal" onClick={(e) => e.stopPropagation()}>
          <div className="ud-modal-icon">
            <FiAlertTriangle size={26} />
          </div>
          <div className="ud-modal-title">Delete Your Account?</div>
          <div className="ud-modal-body">
            This action is <strong>permanent and irreversible</strong>. All your orders,
            wishlist, and personal data will be permanently deleted.
          </div>
          {deleteError && (
            <div className="ud-modal-error">{deleteError}</div>
          )}
          <div className="ud-modal-actions">
            <button
              type="button"
              className="ud-modal-cancel"
              onClick={() => { setShowDeleteModal(false); setDeleteError(""); }}
              disabled={deleting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="ud-modal-delete"
              onClick={handleDeleteAccount}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                  Deleting...
                </>
              ) : (
                <>
                  <FiTrash2 size={15} />
                  Yes, Delete Account
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* â”€â”€ Active Sessions Modal â”€â”€ */}
    {showSessionsModal && (
      <div className="ud-modal-overlay" onClick={() => setShowSessionsModal(false)}>
        <div className="ud-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
          <div className="ud-modal-title" style={{ marginBottom: 16 }}>Active Sessions</div>

          {loadingSessions ? (
            <div style={{ textAlign: "center", padding: "20px 0", color: "#94a3b8", fontSize: 13 }}>
              Loading...
            </div>
          ) : sessions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "20px 0", color: "#94a3b8", fontSize: 13 }}>
              No active sessions found.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20, maxHeight: "50vh", overflowY: "auto", paddingRight: 4 }}>
              {sessions.map((s) => (
                <div
                  key={s.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 14px",
                    border: "1px solid #e2e8f0",
                    borderRadius: 10,
                    gap: 12,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", display: "flex", alignItems: "center", gap: 6 }}>
                      {s.deviceLabel || "Unknown device"}
                      {s.isCurrent && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#16a34a", background: "#f0fdf4", padding: "2px 6px", borderRadius: 6 }}>
                          This device
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                      {s.ipAddress || "Unknown IP"} Â· Last active {new Date(s.lastActiveAt).toLocaleString()}
                    </div>
                  </div>
                  {!s.isCurrent && (
                    <button
                      type="button"
                      className="ud-btn ud-btn-ghost"
                      style={{ flexShrink: 0, color: "#ef4444" }}
                      onClick={() => handleRevokeSession(s.id)}
                      disabled={revokingId === s.id}
                    >
                      {revokingId === s.id ? "Revoking..." : "Revoke"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            className="ud-modal-cancel"
            style={{ width: "100%" }}
            onClick={() => setShowSessionsModal(false)}
          >
            Close
          </button>
        </div>
      </div>
    )}

    
        {/* â”€â”€ Enable 2FA â€” Verify OTP Modal â”€â”€ */}
        {show2FAModal && (
          <div className="ud-modal-overlay" onClick={() => !tfaConfirming && setShow2FAModal(false)}>
            <div className="ud-modal" onClick={(e) => e.stopPropagation()}>
              <div className="ud-modal-icon" style={{ background: "#eef2ff", color: "#4f46e5" }}>
                <FiShield size={26} />
              </div>
              <div className="ud-modal-title">Verify Your Identity</div>
              <div className="ud-modal-body">
                Enter the 6-digit code we sent you to finish enabling two-factor authentication.
              </div>

              {tfaError && <div className="ud-modal-error">{tfaError}</div>}

              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                className="ud-form-input"
                placeholder="000000"
                value={tfaOtp}
                onChange={(e) => setTfaOtp(e.target.value.replace(/\D/g, ""))}
                style={{ textAlign: "center", fontSize: 20, letterSpacing: 6, marginBottom: 20 }}
                autoFocus
              />

              <div className="ud-modal-actions">
                <button
                  type="button"
                  className="ud-modal-cancel"
                  onClick={() => { setShow2FAModal(false); setTfaError(""); }}
                  disabled={tfaConfirming}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="ud-pw-submit-btn"
                  style={{ flex: 1, justifyContent: "center" }}
                  onClick={handleConfirmEnable2FA}
                  disabled={tfaConfirming}
                >
                  {tfaConfirming ? "Verifying..." : "Verify & Enable"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* â”€â”€ Disable 2FA Confirmation Modal â”€â”€ */}
        {showDisable2FAModal && (
          <div className="ud-modal-overlay" onClick={() => !tfaDisabling && setShowDisable2FAModal(false)}>
            <div className="ud-modal" onClick={(e) => e.stopPropagation()}>
              <div className="ud-modal-icon">
                <FiAlertTriangle size={26} />
              </div>
              <div className="ud-modal-title">Disable Two-Factor Authentication?</div>
              <div className="ud-modal-body">
                This will <strong>remove the extra verification step</strong> when you log in.
                Your account will rely on your password alone.
              </div>
              <div className="ud-modal-actions">
                <button
                  type="button"
                  className="ud-modal-cancel"
                  onClick={() => setShowDisable2FAModal(false)}
                  disabled={tfaDisabling}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="ud-modal-delete"
                  onClick={handleDisable2FA}
                  disabled={tfaDisabling}
                >
                  {tfaDisabling ? "Disabling..." : "Yes, Disable"}
                </button>
              </div>
            </div>
          </div>
        )}
 
 {/* â”€â”€ Phone OTP Verification Modal â”€â”€ */}
        {showPhoneOtpModal && (
          <div className="ud-modal-overlay" onClick={() => !confirmingPhone && setShowPhoneOtpModal(false)}>
            <div className="ud-modal" onClick={(e) => e.stopPropagation()}>
              <div className="ud-modal-icon" style={{ background: "#eef2ff", color: "#4f46e5" }}>
                <FiPhone size={26} />
              </div>
              <div className="ud-modal-title">Verify New Phone Number</div>
              <div className="ud-modal-body">
                Enter the 6-digit code sent to {pendingPhone} to confirm this number.
              </div>

              {phoneOtpError && <div className="ud-modal-error">{phoneOtpError}</div>}

              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                className="ud-form-input"
                placeholder="000000"
                value={phoneOtp}
                onChange={(e) => setPhoneOtp(e.target.value.replace(/\D/g, ""))}
                style={{ textAlign: "center", fontSize: 20, letterSpacing: 6, marginBottom: 20 }}
                autoFocus
              />

              <div className="ud-modal-actions">
              <button
                  type="button"
                  className="ud-modal-cancel"
                  onClick={() => {
                    setShowPhoneOtpModal(false);
                    setPhoneOtpError("");
                    setProfileForm((prev) => ({ ...prev, phone: session?.user?.phone || "" }));
                  }}
                  disabled={confirmingPhone}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="ud-pw-submit-btn"
                  style={{ flex: 1, justifyContent: "center" }}
                  onClick={handleConfirmPhoneOtp}
                  disabled={confirmingPhone}
                >
                  {confirmingPhone ? "Verifying..." : "Verify"}
                </button>
              </div>
            </div>
          </div>
        )}
  </>
);
}
