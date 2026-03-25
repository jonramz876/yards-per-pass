// app/card/[slug]/page.tsx — redirects to the stat card image
import { redirect } from "next/navigation";

export default function CardPage({ params }: { params: { slug: string } }) {
  // The OG image is at /card/[slug]/opengraph-image
  // This page just redirects to the image directly
  redirect(`/card/${params.slug}/opengraph-image`);
}
