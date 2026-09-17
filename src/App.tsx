import "./App.css";
import "./store/store.css";
import { lazy, Suspense } from "react";
import Footer from "./Footer";
import { RouterProvider, useRouter } from "./store/lib/router";
import { AuthProvider } from "./store/lib/AuthContext";
import { CartProvider } from "./store/lib/CartContext";
import Header from "./store/components/Header";
import {
  HomePage,
  ConditionGuidePage,
  ShippingPage,
  ReturnsPage,
  ContactPage,
  NotFoundPage,
} from "./store/pages/StaticPages";

// Lazy-loaded: keeps the initial bundle down to just the homepage/shop-adjacent
// static pages above (already one small shared chunk). Everything below pulls
// in noticeably more code (Stripe on checkout, the multi-step sell/photo-
// upload flow, the full account dashboard) that a visitor browsing the shop
// or homepage should never have to download up front.
const ShopPage = lazy(() => import("./store/pages/ShopPage"));
const LoginPage = lazy(() =>
  import("./store/pages/AuthPages").then((m) => ({ default: m.LoginPage })),
);
const SignupPage = lazy(() =>
  import("./store/pages/AuthPages").then((m) => ({ default: m.SignupPage })),
);
const ForgotPasswordPage = lazy(() =>
  import("./store/pages/AuthPages").then((m) => ({ default: m.ForgotPasswordPage })),
);
const ResetPasswordPage = lazy(() =>
  import("./store/pages/AuthPages").then((m) => ({ default: m.ResetPasswordPage })),
);
const PrivacyPage = lazy(() =>
  import("./store/pages/PrivacyPage").then((m) => ({ default: m.PrivacyPage })),
);
const TermsPage = lazy(() =>
  import("./store/pages/TermsPage").then((m) => ({ default: m.TermsPage })),
);
const CheckoutPage = lazy(() => import("./store/pages/CheckoutPage"));
const SellPage = lazy(() => import("./store/pages/SellPage"));
const SellCollectionPage = lazy(() => import("./store/pages/SellCollectionPage"));
const AccountPage = lazy(() =>
  import("./store/pages/AccountPages").then((m) => ({ default: m.AccountPage })),
);
const KioskPage = lazy(() => import("./store/pages/KioskPage"));

function RouteFallback() {
  return (
    <div className="gg-page">
      <p className="gg-card-meta">Loading…</p>
    </div>
  );
}

function Routes() {
  const { path } = useRouter();

  if (path === "/" || path === "") return <HomePage />;
  if (path === "/shop") return <ShopPage />;
  if (path === "/login") return <LoginPage />;
  if (path === "/signup") return <SignupPage />;
  if (path === "/forgot-password") return <ForgotPasswordPage />;
  if (path === "/reset-password") return <ResetPasswordPage />;
  if (path === "/checkout") return <CheckoutPage />;
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
    return (
      <Suspense fallback={<RouteFallback />}>
        <KioskPage />
      </Suspense>
    );
  }

  return (
    <AuthProvider>
      <CartProvider>
        <RouterProvider>
          <a className="skip-link" href="#main">
            Skip to content
          </a>
          <Header />
          <main id="main">
            <Suspense fallback={<RouteFallback />}>
              <Routes />
            </Suspense>
          </main>
          <Footer />
        </RouterProvider>
      </CartProvider>
    </AuthProvider>
  );
}
