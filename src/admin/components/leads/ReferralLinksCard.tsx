import { SectionCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { useToast } from "../../hooks/useToast";
import { REFERRAL_PAGES } from "../../../seo/referralPages";
import { PRODUCTION_ORIGIN } from "../../../seo/site";
import { referralCategoryLabel } from "../../../store/lib/referralTypes";

// "Referral links" at the top of Partner Leads: the public pages for people
// selling Pokémon cards, One Piece cards or video games, ready to copy into a
// text or a Marketplace reply, or to send from the phone's share sheet.
//
// Always the live geega-games.com address, even when the dashboard is opened
// from a preview deployment, since these are for sending to people. The list
// comes from REFERRAL_PAGES, so a new referral page shows up here on its own.

interface ReferralLink {
  key: string;
  /** "Pokémon cards" — same wording as the Leads table's "Selling" column. */
  label: string;
  /** Full address, e.g. https://geega-games.com/sell-pokemon-cards */
  url: string;
  /** The address without https://, for display. */
  displayUrl: string;
  /** Title for the share sheet (used as the subject when shared by email). */
  shareTitle: string;
}

const REFERRAL_LINKS: ReferralLink[] = REFERRAL_PAGES.map((page) => {
  const url = `${PRODUCTION_ORIGIN}${page.path}`;
  return {
    key: page.category,
    label: referralCategoryLabel(page.category),
    url,
    displayUrl: url.replace(/^https?:\/\//, ""),
    shareTitle: page.heading,
  };
});

/** The phone's share sheet (iPhone, Android, most desktop browsers but Firefox). */
function canShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

export function ReferralLinksCard() {
  const toast = useToast();
  const shareable = canShare();

  async function copy(link: ReferralLink) {
    try {
      await navigator.clipboard.writeText(link.url);
      toast.success(`${link.label} link copied.`);
    } catch {
      toast.error("Couldn't copy the link. Press and hold it to copy it instead.");
    }
  }

  async function share(link: ReferralLink) {
    try {
      await navigator.share({ title: link.shareTitle, url: link.url });
    } catch (err) {
      // Closing the share sheet without picking anything isn't an error.
      if ((err as { name?: unknown } | null)?.name === "AbortError") return;
      await copy(link);
    }
  }

  return (
    <SectionCard title="Referral links">
      <p className="gg-reflinks__intro">
        Send sellers to these pages. What they submit shows up in Leads below.
      </p>
      <ul className="gg-reflinks">
        {REFERRAL_LINKS.map((link) => (
          <li key={link.key} className="gg-reflinks__item">
            <div className="gg-reflinks__text">
              <span className="gg-reflinks__label">{link.label}</span>
              <a className="gg-reflinks__url" href={link.url} target="_blank" rel="noopener noreferrer">
                {link.displayUrl}
              </a>
            </div>
            <div className="gg-reflinks__actions">
              <Button
                size="sm"
                icon="copy"
                aria-label={`Copy the ${link.label} link`}
                onClick={() => void copy(link)}
              >
                Copy
              </Button>
              {shareable && (
                <Button
                  size="sm"
                  icon="share"
                  aria-label={`Share the ${link.label} link`}
                  onClick={() => void share(link)}
                >
                  Share
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
