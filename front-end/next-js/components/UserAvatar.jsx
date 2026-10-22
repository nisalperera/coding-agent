"use client";

import Image from "next/image";
import { useState } from "react";

const SIZE_CLASSES = {
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-20 w-20 text-2xl",
};

const IMAGE_SIZES = {
    sm: "32px",
    md: "40px",
    lg: "80px",
};

function getInitials(name, email) {
    const source = name?.trim() || email?.trim() || "User";
    const words = source.split(/\s+/).filter(Boolean);

    return words
        .slice(0, 2)
        .map((word) => word.charAt(0))
        .join("")
        .toUpperCase();
}

function AvatarContent({
    name,
    email,
    image,
    size,
    className,
}) {
    const [imageFailed, setImageFailed] = useState(false);
    const initials = getInitials(name, email);
    const resolvedSize = SIZE_CLASSES[size] ? size : "md";

    return (
        <span
            className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-blue-600 to-violet-600 font-bold tracking-wide text-white ${SIZE_CLASSES[resolvedSize]} ${className}`}
            aria-hidden="true"
        >
            {image && !imageFailed ? (
                <Image
                    src={image}
                    alt=""
                    fill
                    sizes={IMAGE_SIZES[resolvedSize]}
                    className="object-cover"
                    onError={() => setImageFailed(true)}
                />
            ) : (
                initials
            )}
        </span>
    );
}

export default function UserAvatar({
    user,
    size = "md",
    className = "",
}) {
    const name = user?.name ?? "Signed in user";
    const email = user?.email ?? "";
    const image = user?.image ?? user?.picture ?? null;

    return (
        <AvatarContent
            key={image || "no-image"}
            name={name}
            email={email}
            image={image}
            size={size}
            className={className}
        />
    );
}
