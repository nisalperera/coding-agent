"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "../styles/ProfileMenu.module.css";

function getInitials(name, email) {
    const source = name?.trim() || email?.trim() || "User";
    const words = source.split(/\s+/).filter(Boolean);

    return words
        .slice(0, 2)
        .map((word) => word.charAt(0))
        .join("")
        .toUpperCase();
}

function Avatar({ name, email, image, large = false }) {
    const [imageFailed, setImageFailed] = useState(false);
    const initials = getInitials(name, email);

    useEffect(() => {
        setImageFailed(false);
    }, [image]);

    return (
        <span
            className={`${styles.avatar} ${large ? styles.avatarLarge : ""}`}
            aria-hidden="true"
        >
            {image && !imageFailed ? (
                <Image
                    src={image}
                    alt=""
                    fill
                    sizes={large ? "42px" : "32px"}
                    className={styles.avatarImage}
                    onError={() => setImageFailed(true)}
                />
            ) : (
                <span className={styles.avatarFallback}>{initials}</span>
            )}
        </span>
    );
}

export default function ProfileMenu({ user, onLogout }) {
    const [open, setOpen] = useState(false);
    const menuRef = useRef(null);
    const triggerRef = useRef(null);

    const name = user?.name ?? "Signed in user";
    const email = user?.email ?? "";
    const image = user?.image ?? user?.picture ?? null;

    useEffect(() => {
        function handleOutsideClick(event) {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setOpen(false);
            }
        }

        function handleEscape(event) {
            if (event.key === "Escape") {
                setOpen(false);
                triggerRef.current?.focus();
            }
        }

        document.addEventListener("mousedown", handleOutsideClick);
        document.addEventListener("keydown", handleEscape);

        return () => {
            document.removeEventListener("mousedown", handleOutsideClick);
            document.removeEventListener("keydown", handleEscape);
        };
    }, []);

    function closeMenu() {
        setOpen(false);
    }

    async function handleLogout() {
        closeMenu();

        if (onLogout) {
            await onLogout();
        }
    }

    return (
        <div ref={menuRef} className={styles.menu}>
            <button
                ref={triggerRef}
                type="button"
                className={styles.trigger}
                aria-label="Open account menu"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls="profile-menu-panel"
                onClick={() => setOpen((current) => !current)}
            >
                <Avatar name={name} email={email} image={image} />
            </button>

            {open && (
                <div
                    id="profile-menu-panel"
                    className={styles.panel}
                    role="menu"
                    aria-label="Account menu"
                >
                    <div className={styles.identity}>
                        <Avatar name={name} email={email} image={image} large />

                        <div className={styles.identityText}>
                            <strong>{name}</strong>
                            {email && <span>{email}</span>}
                        </div>
                    </div>

                    <div className={styles.divider} />

                    <Link
                        href="/profile"
                        className={styles.menuItem}
                        role="menuitem"
                        onClick={closeMenu}
                    >
                        Profile
                    </Link>

                    <Link
                        href="/settings"
                        className={styles.menuItem}
                        role="menuitem"
                        onClick={closeMenu}
                    >
                        Settings
                    </Link>

                    <div className={styles.divider} />

                    <button
                        type="button"
                        className={`${styles.menuItem} ${styles.logoutItem}`}
                        role="menuitem"
                        onClick={handleLogout}
                    >
                        Logout
                    </button>
                </div>
            )}
        </div>
    );
}