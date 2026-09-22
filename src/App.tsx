import "./App.css";
import "./store/store.css";
import "./store/brand-refresh.css";
import Footer from "./Footer";
import { RouterProvider, useRouter, matchRoute } from "./store/lib/router";
import { AuthProvider } from "./store/lib/AuthContext";
import { CartProvider } from "./store/lib/CartContext";
import { WishlistProvider } from "./store/lib/WishlistContext";
import Header from "./store/components/Header";
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
import { AccountPage } from "./store/pages/AccountPages";
import TrackOrderPage from "./store/pages/TrackOrderPage";
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
  if (path === "/sell") return <SellPage />;
  if (path === "/sell-my-collection") return <SellCollectionPage />;
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

  return (
    <AuthProvider>
      <CartProvider>
        <WishlistProvider>
          <RouterProvider>
            <div className="app">
              <a className="skip-link" href="#main">
                Skip to content
              </a>
              <Header />
              <main id="main">
                <Routes />
              </main>
              <Footer />
            </div>
          </RouterProvider>
        </WishlistProvider>
      </CartProvider>
    </AuthProvider>
  );
}
