import type { MetaDescriptor } from "react-router";

/**
 * The link-preview image. Crawlers need an absolute URL, which the server
 * fills in when it sends the page (see server/pages.ts).
 */
export const PREVIEW_IMAGE = "/og-image.png";

/** Title, description, and link-preview tags for a page. */
export function pageMeta({
  title,
  description,
}: {
  title: string;
  description: string;
}): MetaDescriptor[] {
  return [
    { title },
    { name: "description", content: description },
    { property: "og:site_name", content: "Zipcall" },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: PREVIEW_IMAGE },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: "Zipcall: video calls, straight from your browser." },
    { name: "twitter:card", content: "summary_large_image" },
  ];
}
