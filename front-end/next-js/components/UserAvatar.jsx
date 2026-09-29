"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

function getInitials(name, email) {
    const source = name?.trim() || email?.trim() || "User";
    const words = source.split(/\s+/).filter(Boolean);

    return words
        .slice(0, 2)
        .map((word) => word.charAt(0))
        .join("")
        .toUpperCase();
}

export default function UserAvatar({
    user,
    size = "md",
    className = "",
}) {
    const [imageFailed, setImageFailed] = useState(false);

    const name = user?.name ?? "Signed in user";
    const email = user?.email ?? "";
    const image = user?.image ?? user?.picture ?? null;
    const initials = getInitials(name, email);

    const sizeClasses = {
        sm: "h-8 w-8 text-xs",
        md: "h-10 w-10 text-sm",
        lg: "h-20 w-20 text-2xl",
    };

    useEffect(() => {
        setImageFailed(false);
    }, [image]);

    return (
        <span
            className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-blue-600 to-violet-600 font-bold tracking-wide text-white ${sizeClasses[size]} ${className}`}
            aria-hidden="true"
        >
            {image && !imageFailed ? (
                <Image
                    src={image}
                    alt=""
                    fill
                    sizes={
                        size === "lg"
                            ? "80px"
                            : size === "md"
                                ? "40px"
                                : "32px"
                    }
                    className="object-cover"
                    onError={() => setImageFailed(true)}
                />
            ) : (
                initials
            )}
        </span>
    );
}
