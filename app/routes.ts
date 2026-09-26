import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  layout("routes/marketing-layout.tsx", [
    index("routes/home.tsx"),
    route("newcall", "routes/new-call.tsx"),
    route("notsupported", "routes/not-supported.tsx"),
    route("notsupportedios", "routes/not-supported-ios.tsx"),
  ]),
  route("join/:room", "routes/call.tsx"),
] satisfies RouteConfig;
