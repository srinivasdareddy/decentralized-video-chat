import { Link } from "react-router";
import { LogoMark } from "./logo";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container site-footer-inner">
        <div className="site-footer-start">
          <div className="brand brand-muted">
            <LogoMark size={18} />
            <span>Zipcall</span>
          </div>
          <Link to="/privacy">Privacy</Link>
        </div>
        {/* Attribution required by the CC BY-NC 4.0 license. */}
        <p>
          Based on <a href="https://github.com/ianramzy/decentralized-video-chat">Zipcall</a> by{" "}
          <a href="https://ianramzy.com">Ian Ramzy</a>, used under{" "}
          <a href="https://creativecommons.org/licenses/by-nc/4.0/">CC BY-NC 4.0</a>.
        </p>
      </div>
    </footer>
  );
}
