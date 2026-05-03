import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

type Variant = "horizontal" | "stacked" | "icon" | "monochrome" | "light";

const SOURCES: Record<Variant, string> = {
  horizontal: "/brand/logo-horizontal.svg",
  stacked: "/brand/logo-main.svg",
  icon: "/brand/logo-icon.svg",
  monochrome: "/brand/logo-monochrome.svg",
  light: "/brand/logo-light.svg",
};

const ASPECT: Record<Variant, [number, number]> = {
  horizontal: [4154, 1879], // ~2.21:1
  stacked: [2142, 2227],    // ~0.96:1
  icon: [2012, 1779],       // ~1.13:1
  monochrome: [2142, 2227],
  light: [2012, 1779],
};

/**
 * Home4U-Logo. Default: Icon (4U-Haus) — ideal für Header.
 * `horizontal` → mit "HOME"-Schriftzug rechts daneben.
 * `stacked` → groß / Hero, Schriftzug unter dem Mark.
 */
export function Logo({
  variant = "icon",
  className,
  width,
  alt = "Home4U",
  priority,
}: {
  variant?: Variant;
  className?: string;
  /** Anzeige-Breite in Pixel. Höhe wird über Aspect-Ratio berechnet. */
  width?: number;
  alt?: string;
  priority?: boolean;
}) {
  const [w, h] = ASPECT[variant];
  const renderWidth = width ?? (variant === "icon" ? 36 : 140);
  const renderHeight = Math.round((renderWidth * h) / w);
  return (
    <Image
      src={SOURCES[variant]}
      alt={alt}
      width={renderWidth}
      height={renderHeight}
      priority={priority}
      className={cn("select-none", className)}
    />
  );
}

/**
 * Klickbares Brand-Lockup für die Header-Zeile.
 * Default: Icon + Wortmarke "Home4U" in Navy.
 */
export function BrandLockup({
  className,
  iconSize = 32,
  showWordmark = true,
  href = "/",
}: {
  className?: string;
  iconSize?: number;
  showWordmark?: boolean;
  href?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2.5 group focus-visible:outline-none flex-shrink-0",
        className
      )}
      aria-label="Home4U Startseite"
    >
      <Logo
        variant="icon"
        width={iconSize}
        priority
        className="transition-transform group-hover:-translate-y-px"
      />
      {showWordmark && (
        <span className="font-semibold tracking-tight text-[var(--brand-navy)] text-lg whitespace-nowrap">
          Home<span className="text-[var(--brand-gold)]">4</span>U
        </span>
      )}
    </Link>
  );
}
