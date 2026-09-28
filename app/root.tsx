import "@fontsource-variable/inter";
import "./styles/global.css";
import type { ReactNode } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from "react-router";
import type { Route } from "./+types/root";
import { MessagePanel } from "./components/message-panel";
import { pageMeta } from "./lib/meta";

/**
 * Pages with their own `meta` replace this. It's what the app shell served
 * for call links carries, so shared links get a sensible preview.
 */
export const meta: Route.MetaFunction = ({ error }) => {
  if (error) {
    const notFound = isRouteErrorResponse(error) && error.status === 404;
    return [{ title: notFound ? "Page not found · Zipcall" : "Something went wrong · Zipcall" }];
  }
  return pageMeta({
    title: "You're invited to a call · Zipcall",
    description:
      "Open the link to join the video call in your browser. No downloads or sign-up needed.",
  });
};

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
  { rel: "manifest", href: "/manifest.webmanifest" },
];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0b0c0e" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

/** Shown while the app loads on pages that aren't pre-rendered, like calls. */
export function HydrateFallback() {
  return (
    <div className="page-loading" role="status">
      <div className="spinner" />
      <span className="visually-hidden">Loading</span>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  if (!notFound) console.error(error);
  return (
    <main className="message-page">
      <MessagePanel
        title={notFound ? "Page not found" : "Something went wrong"}
        description={
          notFound
            ? "The page you're looking for doesn't exist."
            : "Zipcall ran into an unexpected problem. Reloading the page usually fixes it."
        }
        actions={
          <a className="button button-primary" href="/newcall">
            Start a new call
          </a>
        }
      />
    </main>
  );
}
