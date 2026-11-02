import "./App.css";
import "./foilShimmer.css";
import "./store/store.css";
import "./store/brand-refresh.css";
import Footer from "./Footer";
import { RouterProvider, useRouter, matchRoute } from "./store/lib/router";
import { AuthProvider } from "./store/lib/AuthContext";
import { PageViewTracker } from "./store/lib/pageViews";
import { AttributionTracker } from "./store/lib/attributionStore";
import { CartProvider } from "./store/lib/CartContext";
import { WishlistProvider } from "./store/lib/WishlistContext";
import Header from "./store/components/Header";
import SignupNudge from "./store/components/SignupNudge";
import { Suspense, type ReactElement } from "react";
import { lazyPage, type LazyPage } from "./store/lib/lazyPage";
import { FOR_STORES_PATH, REFERRAL_PARTNERS_PATH, SELL_HUB_PATH } from "./store/lib/partnerTypes";
import { REFERRAL_PAGES } from "./seo/referralPages";
import { ST_LOUIS_PATH } from "./seo/sellAreas";
import { TRADE_PATH } from "./store/lib/trades";
import { TRADE_CENTER_PATH, TRADE_IN_PATH } from "./store/lib/tradeCenter";

// Every page is its own chunk (see src/store/lib/lazyPage.tsx), so a visitor
// downloads the page they opened, not the whole store.
const ShopPage = lazyPage(() => import("./store/pages/ShopPage"));
const ShopSetsPage = lazyPage(() => import("./store/pages/ShopSetsPage"));
const ShopSetPage = lazyPage(() => import("./store/pages/ShopSetPage"));
const CardDetailPage = lazyPage(() => import("./store/pages/CardDetailPage"));
const ShopPicksPage = lazyPage(() => import("./store/pages/ShopPicksPage"));
const LoginPage = lazyPage(() => import("./store/pages/AuthPages").then((m) => ({ default: m.LoginPage })));
const SignupPage = lazyPage(() => import("./store/pages/AuthPages").then((m) => ({ default: m.SignupPage })));
const ForgotPasswordPage = lazyPage(() =>
  import("./store/pages/AuthPages").then((m) => ({ default: m.ForgotPasswordPage })),
);
const ResetPasswordPage = lazyPage(() =>
  import("./store/pages/AuthPages").then((m) => ({ default: m.ResetPasswordPage })),
);
const HomePage = lazyPage(() => import("./store/pages/StaticPages").then((m) => ({ default: m.HomePage })));
const ConditionGuidePage = lazyPage(() =>
  import("./store/pages/StaticPages").then((m) => ({ default: m.ConditionGuidePage })),
);
const ShippingPage = lazyPage(() => import("./store/pages/StaticPages").then((m) => ({ default: m.ShippingPage })));
const ReturnsPage = lazyPage(() => import("./store/pages/StaticPages").then((m) => ({ default: m.ReturnsPage })));
const ContactPage = lazyPage(() => import("./store/pages/StaticPages").then((m) => ({ default: m.ContactPage })));
const AboutPage = lazyPage(() => import("./store/pages/StaticPages").then((m) => ({ default: m.AboutPage })));
const NotFoundPage = lazyPage(() => import("./store/pages/StaticPages").then((m) => ({ default: m.NotFoundPage })));
const PrivacyPage = lazyPage(() => import("./store/pages/PrivacyPage").then((m) => ({ default: m.PrivacyPage })));
const TermsPage = lazyPage(() => import("./store/pages/TermsPage").then((m) => ({ default: m.TermsPage })));
const CheckoutPage = lazyPage(() => import("./store/pages/CheckoutPage"));
const SellPage = lazyPage(() => import("./store/pages/SellPage"));
const SellCollectionPage = lazyPage(() => import("./store/pages/SellCollectionPage"));
const SellStLouisPage = lazyPage(() => import("./store/pages/SellStLouisPage"));
const SellAreaPage = lazyPage(() => import("./store/pages/SellAreaPage"));
const GuidePage = lazyPage(() => import("./store/pages/GuidePages").then((m) => ({ default: m.GuidePage })));
const GuidesIndexPage = lazyPage(() =>
  import("./store/pages/GuidePages").then((m) => ({ default: m.GuidesIndexPage })),
);
const SellReferralPage = lazyPage(() => import("./store/pages/SellReferralPage"));
const ForStoresPage = lazyPage(() =>
  import("./store/pages/PartnerProgramPages").then((m) => ({ default: m.ForStoresPage })),
);
const ReferralPartnersPage = lazyPage(() =>
  import("./store/pages/PartnerProgramPages").then((m) => ({ default: m.ReferralPartnersPage })),
);
const SellHubPage = lazyPage(() =>
  import("./store/pages/PartnerProgramPages").then((m) => ({ default: m.SellHubPage })),
);
const AccountPage = lazyPage(() => import("./store/pages/AccountPages").then((m) => ({ default: m.AccountPage })));
const TrackOrderPage = lazyPage(() => import("./store/pages/TrackOrderPage"));
const RespondToOfferPage = lazyPage(() => import("./store/pages/RespondToOfferPage"));
const CollectionSortingPage = lazyPage(() => import("./store/pages/CollectionSortingPage"));
const SortingQuotePage = lazyPage(() => import("./store/pages/SortingQuotePage"));
const TradeSummaryPage = lazyPage(() => import("./store/pages/TradeSummaryPage"));
const TradeCardsPage = lazyPage(() => import("./store/pages/TradeCardsPage"));
const TradeInPage = lazyPage(() => import("./store/pages/TradeInPage"));
const KioskPage = lazyPage(() => import("./store/pages/KioskPage"));
const YardSalePage = lazyPage(() => import("./store/pages/YardSalePage"));
const ConsignSignPage = lazyPage(() => import("./store/pages/ConsignSignPage"));

const ALL_PAGES: LazyPage<never>[] = [
  ShopPage, ShopSetsPage, ShopSetPage, CardDetailPage, ShopPicksPage, LoginPage, SignupPage,
  ForgotPasswordPage, ResetPasswordPage, HomePage, ConditionGuidePage, ShippingPage, ReturnsPage,
  ContactPage, AboutPage, NotFoundPage, PrivacyPage, TermsPage, CheckoutPage, SellPage,
  SellCollectionPage, SellStLouisPage, SellAreaPage, GuidePage, GuidesIndexPage, SellReferralPage,
  ForStoresPage, ReferralPartnersPage, SellHubPage, AccountPage, TrackOrderPage, RespondToOfferPage,
  CollectionSortingPage, SortingQuotePage, TradeSummaryPage, TradeCardsPage, TradeInPage, KioskPage,
  YardSalePage, ConsignSignPage,
] as LazyPage<never>[];

/** The page element for a storefront path (kiosk and yard sale aside). */
function routeFor(path: string): ReactElement {
  if (path === "/" || path === "") return <HomePage />;
  if (path === "/shop") return <ShopPage />;
  if (path === "/shop/sets") return <ShopSetsPage />;
  if (path === "/shop/picks") return <ShopPicksPage />;
  const setMatch = matchRoute("/shop/set/:code", path);
  if (setMatch) return <ShopSetPage code={setMatch.code} />;
  const cardMatch = matchRoute("/shop/card/:slug", path);
  if (cardMatch) return <CardDetailPage slug={cardMatch.slug} />;
  if (path === "/login") return <LoginPage />;
  if (path === "/signup") return <SignupPage />;
  if (path === "/forgot-password") return <ForgotPasswordPage />;
  if (path === "/reset-password") return <ResetPasswordPage />;
  if (path === "/checkout") return <CheckoutPage />;
  if (path === "/track-order") return <TrackOrderPage />;
  if (path === "/sell/offer") return <RespondToOfferPage />;
  if (path === "/collection-sorting") return <CollectionSortingPage />;
  if (path === "/collection-sorting/quote") return <SortingQuotePage />;
  if (path === TRADE_PATH) return <TradeSummaryPage />;
  if (path === "/consign/sign") return <ConsignSignPage />;
  if (path === TRADE_CENTER_PATH) return <TradeCardsPage />;
  if (path === TRADE_IN_PATH) return <TradeInPage />;
  if (path === "/sell") return <SellPage />;
  if (path === "/sell-my-collection") return <SellCollectionPage />;
  if (path === ST_LOUIS_PATH) return <SellStLouisPage />;
  const areaMatch = matchRoute("/sell-magic-cards/:slug", path);
  if (areaMatch) return <SellAreaPage slug={areaMatch.slug} />;
  const referralPage = REFERRAL_PAGES.find((p) => p.path === path);
  if (referralPage) return <SellReferralPage category={referralPage.category} />;
  if (path === SELL_HUB_PATH) return <SellHubPage />;
  if (path === FOR_STORES_PATH) return <ForStoresPage />;
  if (path === REFERRAL_PARTNERS_PATH) return <ReferralPartnersPage />;
  if (path === "/guides") return <GuidesIndexPage />;
  const guideMatch = matchRoute("/guides/:slug", path);
  if (guideMatch) return <GuidePage slug={guideMatch.slug} />;
  if (path === "/condition-guide") return <ConditionGuidePage />;
  if (path === "/shipping") return <ShippingPage />;
  if (path === "/returns") return <ReturnsPage />;
  if (path === "/contact") return <ContactPage />;
  if (path === "/about") return <AboutPage />;
  if (path === "/privacy") return <PrivacyPage />;
  if (path === "/terms") return <TermsPage />;
  if (path === "/account" || path.startsWith("/account/")) {
    return <AccountPage />;
  }
  return <NotFoundPage />;
}

function Routes() {
  const { path } = useRouter();
  return routeFor(path);
}

/** Standalone pages that render without the storefront chrome (see App). */
function standaloneFor(pathname: string): ReactElement | null {
  if (pathname === "/kiosk") return <KioskPage />;
  if (pathname === "/yard-sale") return <YardSalePage />;
  return null;
}

/**
 * Load the code of the page at `pathname` before the first render, so the
 * prerendered HTML stays on screen until the real page can replace it
 * (src/main.tsx). Never rejects: a failed load is retried when React renders it.
 */
export function preloadRoute(pathname: string): Promise<void> {
  const element = standaloneFor(pathname) ?? routeFor(pathname);
  const page = element.type as Partial<LazyPage<never>>;
  return page.preload ? page.preload().catch(() => undefined) : Promise.resolve();
}

/** Load every page's code: the build-time prerender renders them all synchronously. */
export function preloadAllPages(): Promise<void> {
  return Promise.all(ALL_PAGES.map((page) => page.preload())).then(() => undefined);
}

export default function App() {
  // The in-store kiosk is deliberately standalone: no signed-in account, no
  // cart, no header/footer chrome — just the kiosk experience on whatever
  // computer in the shop has this URL open, so a customer's kiosk session
  // can never touch or be confused with someone else's account/cart.
  // The yard sale page (the QR code at our yard sale) is standalone the same
  // way: shoppers' phones send a pickup list, never touch a cart or checkout.
  const standalone = standaloneFor(window.location.pathname);
  if (standalone) return <Suspense fallback={null}>{standalone}</Suspense>;

  return <Storefront />;
}

/**
 * The storefront with all of its chrome. `initialPath` is only passed by the
 * build-time prerender (src/prerender.tsx), which renders this exact tree to
 * static HTML so crawlers get real markup; the browser reads the location.
 */
export function Storefront({ initialPath }: { initialPath?: string }) {
  return (
    <AuthProvider>
      <CartProvider>
        <WishlistProvider>
          <RouterProvider initialPath={initialPath}>
            <PageViewTracker />
            <AttributionTracker />
            <div className="app">
              <a className="skip-link" href="#main">
                Skip to content
              </a>
              <Header />
              <main id="main">
                {/* Covers moving to a page whose code hasn't loaded yet. */}
                <Suspense fallback={<div className="gg-page gg-page-loading" aria-busy="true" />}>
                  <Routes />
                </Suspense>
              </main>
              <Footer />
              <SignupNudge />
            </div>
          </RouterProvider>
        </WishlistProvider>
      </CartProvider>
    </AuthProvider>
  );
}
