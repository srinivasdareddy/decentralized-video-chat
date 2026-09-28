import { Link, useLocation } from "react-router";
import { LogoMark } from "./logo";

export function SiteHeader() {
  const { pathname } = useLocation();
  return (
    <header className="site-header">
      <div className="container site-header-inner">
        <Link to="/" className="brand">
          <LogoMark size={22} />
          <span>Zipcall</span>
        </Link>
        {pathname !== "/newcall" && (
          <Link to="/newcall" className="button button-primary button-small">
            Start a call
          </Link>
        )}
      </div>
    </header>
  );
}
