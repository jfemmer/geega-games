import "./App.css";
import "./store/store.css";
import "./store/brand-refresh.css";
import Footer from "./Footer";
import { RouterProvider, useRouter, matchRoute } from "./store/lib/router";
import { AuthProvider } from "./store/lib/AuthContext";
import { PageViewTracker } from "./store/lib/pageViews";
import { CartProvider } from "./store/lib/CartContext";
import { WishlistProvider } from "./store/lib/WishlistContext";
import Header from "./store/components/Header";
import SignupNudge from "./store/components/SignupNudge";
import ShopPage from "./store/pages/ShopPage";
import ShopSetsPage from "./store/pages/ShopSetsPage";
import ShopSetPage from "./store/pages/ShopSetPage";
import CardDetailPage from "./store/pages/CardDetailPage";
import {
  LoginPage,
  SignupPage,
  ForgotPasswordPage,
  ResetPasswordPage,
} from "./store/pages/AuthPages";
import {
  HomePage,
  ConditionGuidePage,
  ShippingPage,
  ReturnsPage,
  ContactPage,
  NotFoundPage,
} from "./store/pages/StaticPages";
import { PrivacyPage } from "./store/pages/PrivacyPage";
import { TermsPage } from "./store/pages/TermsPage";
import CheckoutPage from "./store/pages/CheckoutPage";
import SellPage from "./store/pages/SellPage";
import SellCollectionPage from "./store/pages/SellCollectionPage";
import SellStLouisPage from "./store/pages/SellStLouisPage";
import SellAreaPage from "./store/pages/SellAreaPage";
import { GuidePage, GuidesIndexPage } from "./store/pages/GuidePages";
import SellReferralPage from "./store/pages/SellReferralPage";
import { REFERRAL_PAGES } from "./seo/referralPages";
import { ST_LOUIS_PATH } from "./seo/sellAreas";
import { AccountPage } from "./store/pages/AccountPages";
import TrackOrderPage from "./store/pages/TrackOrderPage";
import RespondToOfferPage from "./store/pages/RespondToOfferPage";
import KioskPage from "./store/pages/KioskPage";

function Routes() {
  const { path } = useRouter();

  if (path === "/" || path === "") return <HomePage />;
  if (path === "/shop") return <ShopPage />;
  if (path === "/shop/sets") return <ShopSetsPage />;
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
  if (path === "/sell") return <SellPage />;
  if (path === "/sell-my-collection") return <SellCollectionPage />;
  if (path === ST_LOUIS_PATH) return <SellStLouisPage />;
  const areaMatch = matchRoute("/sell-magic-cards/:slug", path);
  if (areaMatch) return <SellAreaPage slug={areaMatch.slug} />;
  const referralPage = REFERRAL_PAGES.find((p) => p.path === path);
  if (referralPage) return <SellReferralPage category={referralPage.category} />;
  if (path === "/guides") return <GuidesIndexPage />;
  const guideMatch = matchRoute("/guides/:slug", path);
  if (guideMatch) return <GuidePage slug={guideMatch.slug} />;
  if (path === "/condition-guide") return <ConditionGuidePage />;
  if (path === "/shipping") return <ShippingPage />;
  if (path === "/returns") return <ReturnsPage />;
  if (path === "/contact") return <ContactPage />;
  if (path === "/privacy") return <PrivacyPage />;
  if (path === "/terms") return <TermsPage />;
  if (path === "/account" || path.startsWith("/account/")) {
    return <AccountPage />;
  }
  return <NotFoundPage />;
}

export default function App() {
  // The in-store kiosk is deliberately standalone: no signed-in account, no
  // cart, no header/footer chrome — just the kiosk experience on whatever
  // computer in the shop has this URL open, so a customer's kiosk session
  // can never touch or be confused with someone else's account/cart.
  if (window.location.pathname === "/kiosk") {
    return <KioskPage />;
  }

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
            <div className="app">
              <a className="skip-link" href="#main">
                Skip to content
              </a>
              <Header />
              <main id="main">
                <Routes />
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
