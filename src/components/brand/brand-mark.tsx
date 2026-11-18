import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * The round Deccan Filings logo (from the website's logo-icon). Sized
 * in CSS pixels; a 2x source is picked so it stays sharp on high-DPI
 * screens. The image is already trimmed to a circle with transparent
 * corners, so it sits cleanly on light and dark backgrounds.
 */
export function BrandMark({
  size = 32,
  className,
  priority = false,
}: {
  size?: number;
  className?: string;
  priority?: boolean;
}) {
  const src =
    size <= 32
      ? "/branding/deccan-filings-icon-64.png"
      : "/branding/deccan-filings-icon-128.png";
  return (
    <Image
      src={src}
      alt="Deccan Filings"
      width={size}
      height={size}
      priority={priority}
      className={cn("shrink-0 rounded-full", className)}
    />
  );
}
