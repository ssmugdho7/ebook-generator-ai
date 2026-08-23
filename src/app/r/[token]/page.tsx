import type { Metadata } from "next";
import SharedReader from "@/components/SharedReader";

export const metadata: Metadata = {
  title: "Shared ebook",
  robots: { index: false },
};

export default async function SharedEbookPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <SharedReader token={token} />;
}
