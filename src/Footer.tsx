import { FOOTER_GROUPS, SITE } from "./siteConfig";

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
                      <a href={link.href}>{link.label}</a>
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
