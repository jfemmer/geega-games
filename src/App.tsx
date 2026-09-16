import "./App.css";
import "./store/store.css";
import Footer from "./Footer";
import { RouterProvider, useRouter } from "./store/lib/router";
import { AuthProvider } from "./store/lib/AuthContext";
import { CartProvider } from "./store/lib/CartContext";
import Header from "./store/components/Header";
import ShopPage from "./store/pages/ShopPage";
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
import { AccountPage } from "./store/pages/AccountPages";

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
  return (
    <AuthProvider>
      <CartProvider>
        <RouterProvider>
          <a className="skip-link" href="#main">
            Skip to content
          </a>
          <Header />
          <main id="main">
            <Routes />
          </main>
          <Footer />
        </RouterProvider>
      </CartProvider>
    </AuthProvider>
  );
}
