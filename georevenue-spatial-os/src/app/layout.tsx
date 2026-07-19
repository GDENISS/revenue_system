import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

const ARCGIS_VERSION = "4.32";
const CALCITE_VERSION = "2.13.2";

export const metadata: Metadata = {
  title: "GeoRevenue Spatial OS",
  description: "Spatial-first revenue management dashboard powered by ArcGIS Maps SDK and Calcite Design System.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <link
          id="esri-theme-css"
          rel="stylesheet"
          href={`https://js.arcgis.com/${ARCGIS_VERSION}/esri/themes/light/main.css`}
        />
        <link
          rel="stylesheet"
          href={`https://js.arcgis.com/calcite-components/${CALCITE_VERSION}/calcite.css`}
        />
        <Script
          type="module"
          crossOrigin="anonymous"
          src={`https://js.arcgis.com/calcite-components/${CALCITE_VERSION}/calcite.esm.js`}
          strategy="beforeInteractive"
        />
        <Script
          src={`https://js.arcgis.com/${ARCGIS_VERSION}/`}
          strategy="beforeInteractive"
        />
      </head>
      <body className="min-h-full flex flex-col font-sans" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
