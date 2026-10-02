import AppBar from "@components/layout/AppBar";
import GuestBar from "@components/layout/GuestBar";
import ResponsiveHeader from "@components/layout/ResponsiveHeader";
import type { ReactNode } from "react";
import { useLocation } from "react-router";
import { cn } from "@/lib/utils";
import { useIsDesktop } from "@hooks/useIsDesktop";
import { useAppSelector } from "@store/hooks";

/** Pages for someone not yet signed in, which carry no navigation of their own. */
const AUTH_PAGES = ["/login", "/register", "/forgot-password", "/reset-password"];

export default function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const isDesktop = useIsDesktop();
  // A loaded user is the only signal available: the session lives in httpOnly
  // cookies no script here can read.
  const user = useAppSelector((state) => state.auth.user);

  // Creating a habit hides the bar on mobile — the form needs the room — but
  // keeps it on desktop, where it sits beside the content.
  const hideOnMobile = [...AUTH_PAGES, "/createhabit"].some((path) =>
    location.pathname.startsWith(path),
  );
  const hideOnDesktop = AUTH_PAGES.some((path) =>
    location.pathname.startsWith(path),
  );
  const hidden = isDesktop ? hideOnDesktop : hideOnMobile;

  /**
   * Explore is readable with no account, and this layout was written for
   * someone who has one. A signed-out visitor gets neither the navigation —
   * every destination in it is behind `ProtectedRoute` — nor the header, which
   * draws their avatar and their day.
   */
  const signedIn = Boolean(user);
  /**
   * Except on the pages for signing in. Their header is only a title and a
   * back button — nothing of anyone's — and on a phone it is the only title
   * they have, since the page's own heading is shown from tablet width up.
   * Hiding it from everyone signed out left the login form without a heading
   * and the registration form without its way back.
   */
  const onAuthPage = AUTH_PAGES.some((path) => location.pathname.startsWith(path));
  const showAppBar = signedIn && !hidden;
  const showGuestBar = !signedIn && !hideOnDesktop;

  return (
    <div
      className={cn(
        "min-h-screen w-full bg-canvas",
        signedIn &&
          !(hideOnMobile && hideOnDesktop) &&
          "md:grid md:grid-cols-[minmax(160px,240px)_1fr]",
      )}
    >
      <a
        href="#main"
        className={cn(
          "sr-only focus:not-sr-only",
          "focus:fixed focus:top-3 focus:left-3 focus:z-50",
          "focus:bg-surface focus:text-ink focus:body-bold",
          "focus:px-4 focus:py-3 focus:rounded-xl focus:shadow-lifted",
        )}
      >
        Skip to content
      </a>

      {showAppBar && <AppBar />}

      <div className="w-full max-w-full box-border">
        {signedIn || onAuthPage ? <ResponsiveHeader /> : showGuestBar && <GuestBar />}
        <main id="main" tabIndex={-1} className="outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
