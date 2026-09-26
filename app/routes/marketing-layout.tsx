import "../styles/marketing.css";
import { Outlet } from "react-router";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";

/** Shared header and footer for the landing, new call, and help pages. */
export default function MarketingLayout() {
  return (
    <div className="site">
      <SiteHeader />
      <main className="site-main">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
