import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { HideVercelToolbar } from "@/components/HideVercelToolbar";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "FinOps CFO Dashboard",
  description: "Live AI spend, Smart Router savings, and workspace usage",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("finops-theme")==="light")document.documentElement.classList.remove("dark")}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-screen antialiased">
        <HideVercelToolbar />
        {children}
      </body>
    </html>
  );
}
