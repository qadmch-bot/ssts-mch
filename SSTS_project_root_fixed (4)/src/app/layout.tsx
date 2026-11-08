import type { Metadata, Viewport } from "next";
import "./globals.css";
import { StoreProvider } from "@/lib/store";
import { ToastProvider } from "@/components/toast";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "Sepsis Surveillance & Tracking System | Maternity & Children Hospital – Hafar Al Batin",
  description: "Sepsis case, Hour-1 Bundle, laboratory and outcome tracking — Quality & Patient Safety",
  icons: { icon: "/cluster-mark.png" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b2a55" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <StoreProvider>
          <ToastProvider>
            <AppShell>{children}</AppShell>
          </ToastProvider>
        </StoreProvider>
      </body>
    </html>
  );
}
