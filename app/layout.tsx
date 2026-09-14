import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tu chatbot",
  description: "Configuración del chatbot",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={figtree.variable}>
      <body>{children}</body>
    </html>
  );
}
