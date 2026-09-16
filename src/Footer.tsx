import type { ReactNode } from "react";
import { FOOTER_GROUPS, SITE } from "./siteConfig";
import { Link } from "./store/lib/router";

/** Internal SPA routes get client-side navigation; anything else (#anchors,
 * external URLs) stays a plain anchor. */
function FooterLinkAnchor({ href, children }: { href: string; children: ReactNode }) {
  if (href.startsWith("/")) {
    return <Link to={href}>{children}</Link>;
  }
  return <a href={href}>{children}</a>;
}

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <img
            src="/logo.png"
            alt="Geega Games"
            width={140}
            height={124}
            className="footer-logo"
          />
          <p className="footer-tagline">{SITE.tagline}</p>
          {SITE.supportEmail ? (
            <p className="footer-support">
              <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>
            </p>
          ) : null}
        </div>

        <nav className="footer-links" aria-label="Footer">
          {FOOTER_GROUPS.map((group) => (
            <div className="footer-col" key={group.title}>
              <h3>{group.title}</h3>
              <ul>
                {group.links.map((link) => (
                  <li key={link.label}>
                    {link.href ? (
                      <FooterLinkAnchor href={link.href}>{link.label}</FooterLinkAnchor>
                    ) : (
                      <span className="footer-soon">
                        {link.label}
                        <span className="soon-tag">soon</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <div className="footer-bottom">
        <span>
          &copy; {new Date().getFullYear()} {SITE.name}
        </span>
        <span>Checkout &amp; accounts go live at launch</span>
      </div>
    </footer>
  );
}
