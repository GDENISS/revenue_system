"use client";

import dynamic from "next/dynamic";
import { Loader } from "./lib/shared";

const Shell = dynamic(() => import("./Shell"), {
  ssr: false,
  loading: () => (
    <div className="grid min-h-screen place-items-center bg-[var(--background)] text-[var(--on-surface)]">
      <Loader label="Loading GeoRevenue OS" scale="l" />
    </div>
  ),
});

export default function Page() {
  return <Shell />;
}
