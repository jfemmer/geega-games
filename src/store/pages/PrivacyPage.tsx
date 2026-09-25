import { Link } from "../lib/router";
import { useSEO } from "../lib/useSEO";
import { SUPPORT_EMAIL } from "./StaticPages";

const EFFECTIVE_DATE = "September 24, 2026";

export function PrivacyPage() {
  useSEO({
    title: "Privacy Policy | Geega Games",
    description: "How Geega Games collects, uses, and protects your personal information.",
    path: "/privacy",
  });

  return (
    <div className="gg-page gg-prose">
      <h1>Privacy Policy</h1>
      <p className="gg-card-meta">Effective date: {EFFECTIVE_DATE}</p>

      <p>
        Geega Games LLC (&ldquo;Geega Games,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or
        &ldquo;our&rdquo;) operates geega-games.com (the &ldquo;Service&rdquo;). This Privacy
        Policy explains what information we collect, how we use and share it, and the choices
        available to you. This policy is part of, and should be read together with, our{" "}
        <Link to="/terms">Terms of Service</Link>. If you do not agree with this policy, please do not
        use the Service.
      </p>

      <h2>1. Information We Collect</h2>
      <p>We collect the following categories of information:</p>
      <ul>
        <li>
          <strong>Account information:</strong> name, email address, phone number (optional), and
          password (stored in hashed form by our authentication provider — we never see or store
          your plaintext password).
        </li>
        <li>
          <strong>Order and shipping information:</strong> shipping address, order contents,
          order history, and communications related to an order.
        </li>
        <li>
          <strong>Payment information:</strong> payment card details are collected and processed
          directly by our payment processor, Stripe, Inc. We do not receive or store your full
          card number, CVV, or equivalent. We retain only limited transaction metadata (such as
          amount, status, and a Stripe-provided reference) needed to fulfill and reconcile your
          order.
        </li>
        <li>
          <strong>Sell Your Cards / Sell Your Collection information:</strong> when you submit a
          request to sell cards or a collection, we collect your name, email, phone number
          (optional), city/state/ZIP, preferred contact method, the cards or collection details
          you provide, and any photographs you upload. See Section 6 below for more detail on how
          this information is used and protected.
        </li>
        <li>
          <strong>Marketing/newsletter information:</strong> if you subscribe to our newsletter or
          promotional emails, we collect your email address and subscription status (including
          when you subscribed and confirmed your subscription, and when you unsubscribe).
        </li>
        <li>
          <strong>Communications:</strong> if you contact us (for example, by email), we keep a
          record of that correspondence.
        </li>
        <li>
          <strong>Automatically collected information:</strong> like most websites, our hosting
          and analytics infrastructure may automatically log standard technical information such
          as IP address, browser type, device information, pages visited, and timestamps, and may
          use cookies or similar technologies necessary for the Service to function (for example,
          keeping you signed in or remembering your cart). Our own visitor statistics record the
          pages you view, your device type, the site that referred you, and your approximate
          location (country, state/region and city, estimated from your IP address) without
          storing your IP address or identifying you; we don&rsquo;t record them at all if your
          browser sends a Do Not Track or Global Privacy Control signal.
        </li>
      </ul>

      <h2>2. How We Use Information</h2>
      <p>We use the information described above to:</p>
      <ul>
        <li>create and manage your account;</li>
        <li>process, fulfill, and ship your orders, and communicate with you about them;</li>
        <li>evaluate, respond to, and process Sell Your Cards / Sell Your Collection submissions, including contacting you about them;</li>
        <li>provide customer support and respond to your requests;</li>
        <li>send transactional communications (order confirmations, shipping updates, account notices);</li>
        <li>send marketing communications where you have opted in, and let you opt out at any time;</li>
        <li>maintain the security of the Service and detect, investigate, and prevent fraud, abuse, or policy violations;</li>
        <li>comply with legal obligations; and</li>
        <li>operate, maintain, and improve the Service.</li>
      </ul>

      <h2>3. How We Share Information</h2>
      <p>
        <strong>We do not sell your personal information to third parties, and we do not share it
        with third parties for their own independent marketing purposes.</strong> We share
        information only as follows:
      </p>
      <ul>
        <li>
          <strong>Service providers</strong> who process information on our behalf and under our
          instructions, including: Stripe, Inc. (payment processing), Supabase, Inc. (database
          hosting, authentication, and file storage), Resend (transactional and marketing email
          delivery), Vercel Inc. (website hosting), and shipping carriers (USPS, UPS, FedEx, or
          similar) to deliver your order;
        </li>
        <li>
          <strong>Legal and safety reasons:</strong> where required by law, subpoena, or other
          legal process, or where we believe in good faith that disclosure is necessary to
          protect the rights, property, or safety of Geega Games, our users, or the public,
          including to investigate fraud or enforce our Terms of Service;
        </li>
        <li>
          <strong>Business transfers:</strong> in connection with a merger, acquisition,
          financing, or sale of some or all of our assets, in which case information may be
          transferred as part of that transaction, subject to standard confidentiality
          arrangements; and
        </li>
        <li>
          <strong>With your consent</strong> or at your direction.
        </li>
      </ul>

      <h2>4. Cookies and Similar Technologies</h2>
      <p>
        We use cookies and similar technologies that are necessary for the Service to function,
        such as keeping you signed in and remembering items in your cart. We may also use
        analytics tools to understand how the Service is used, in order to improve it. Most
        browsers let you control or block cookies through their settings; doing so may affect the
        functionality of the Service (for example, you may need to sign in more often or your
        cart may not persist between visits).
      </p>

      <h2>5. Data Retention</h2>
      <p>
        We retain personal information for as long as reasonably necessary to fulfill the
        purposes described in this policy, including to maintain your account, comply with our
        legal and tax obligations (such as order/transaction records), resolve disputes, and
        enforce our agreements. When information is no longer needed for these purposes, we take
        reasonable steps to delete or de-identify it, except where we are required or permitted by
        law to retain it longer.
      </p>

      <h2>6. Sell Your Cards / Sell Your Collection Photos and Data</h2>
      <p>
        Photographs and information you submit through the Sell Your Cards / Sell Your Collection
        tool are stored in a private file storage location that is not publicly accessible and is
        never displayed on the public storefront. Access is limited to authorized Geega Games
        staff for the purpose of reviewing and evaluating your submission. We retain submission
        information and photographs for our business records (including for cases where a
        submission does not result in a completed sale) unless you request deletion under Section
        8 below and we are not otherwise required or permitted to retain it (for example, for
        fraud-prevention or recordkeeping purposes related to a completed transaction).
      </p>

      <h2>7. Data Security</h2>
      <p>
        We use reasonable administrative, technical, and physical safeguards designed to protect
        personal information, including access controls on our database and file storage, and
        reliance on payment and authentication providers (Stripe and Supabase) that maintain
        their own industry-standard security programs. However, no method of transmission or
        storage is completely secure, and we cannot guarantee absolute security. You are
        responsible for keeping your account password confidential.
      </p>

      <h2>8. Your Choices and Rights</h2>
      <ul>
        <li>
          <strong>Marketing emails:</strong> every marketing email we send includes an unsubscribe
          link. You may also unsubscribe at any time by contacting us. Even after you unsubscribe
          from marketing email, we may still send you transactional messages related to an order
          or account you have with us.
        </li>
        <li>
          <strong>Account information:</strong> you can review and update most of your account
          information directly from your account page.
        </li>
        <li>
          <strong>Access, correction, or deletion:</strong> you may request access to, correction
          of, or deletion of your personal information by emailing{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. We will respond within a
          reasonable time. We may decline a deletion request, or delay it, to the extent we are
          required or permitted to retain information (for example, order records needed for tax,
          accounting, warranty, or fraud-prevention purposes).
        </li>
        <li>
          <strong>State privacy law rights:</strong> depending on where you live, applicable state
          law may give you additional rights regarding your personal information, such as the
          right to know what information we hold about you, request its deletion, or opt out of
          certain uses. If such a law applies to you, you may exercise those rights by contacting
          us at the email above; we will not discriminate against you for exercising any right you
          may have under applicable law.
        </li>
      </ul>

      <h2>9. Children's Privacy</h2>
      <p>
        The Service is not directed to, and is not intended for use by, anyone under the age of
        18. We do not knowingly collect personal information from children under 13. If you
        believe a child has provided us with personal information, please contact us at{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we will take steps to delete
        it.
      </p>

      <h2>10. Third-Party Links and Card Data</h2>
      <p>
        Card names, images, and printing data displayed on the Service may be sourced in part via
        the Scryfall API and remain the property of their respective rights holders (see our{" "}
        <Link to="/terms">Terms of Service</Link> for our trademark disclaimer). The Service may
        contain links to third-party websites. We are not responsible for the privacy practices or
        content of any third-party site, and this policy does not apply to them.
      </p>

      <h2>11. Where We Operate</h2>
      <p>
        Geega Games is based in the United States, and the Service is intended for use by
        residents of the United States. We currently ship only within the United States. If you
        access the Service from outside the United States, your information will be transferred
        to and processed in the United States, which may have data protection laws different from
        those of your country.
      </p>

      <h2>12. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Changes are effective when posted
        with an updated effective date at the top of this page. Your continued use of the Service
        after a change is posted constitutes acceptance of the revised policy.
      </p>

      <h2>13. Contact Us</h2>
      <p>
        Questions about this Privacy Policy or requests regarding your personal information can be
        sent to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
      <p className="gg-card-meta">
        Geega Games LLC — [insert registered business address before publishing to the public].
      </p>
    </div>
  );
}
