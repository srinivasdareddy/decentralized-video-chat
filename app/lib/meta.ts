import type { MetaDescriptor } from "react-router";

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
    { name: "twitter:card", content: "summary" },
  ];
}
