import { renderToReadableStream } from "react-dom/server";
import { ServerRouter, type EntryContext } from "react-router";

/**
 * Renders pages to HTML. With `ssr: false` this only runs at build time, to
 * pre-render the static pages and the app shell used for calls.
 *
 * Defining it ourselves also stops React Router from adding its default
 * entry's `isbot` dependency on every build.
 */
export default async function handleRequest(
  request: Request,
  status: number,
  headers: Headers,
  routerContext: EntryContext,
): Promise<Response> {
  let responseStatus = status;
  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      onError(error: unknown) {
        responseStatus = 500;
        console.error(error);
      },
    },
  );
  // Pre-rendered pages must be complete, so wait for everything to render.
  await body.allReady;
  headers.set("Content-Type", "text/html");
  return new Response(body, { headers, status: responseStatus });
}
