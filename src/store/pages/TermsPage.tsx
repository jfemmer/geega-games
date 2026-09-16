import { Link } from "../lib/router";
import { SUPPORT_EMAIL } from "./StaticPages";

const EFFECTIVE_DATE = "September 16, 2026";

export function TermsPage() {
  return (
    <div className="gg-page gg-prose">
      <h1>Terms of Service</h1>
      <p className="gg-card-meta">Effective date: {EFFECTIVE_DATE}</p>

      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) are a binding legal agreement between you
        and Geega Games LLC, a Missouri limited liability company (&ldquo;Geega Games,&rdquo;
        &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;), governing your access to and use
        of the website located at geega-games.com, including the storefront, customer accounts,
        the Sell Your Cards / Sell Your Collection submission tool, and all related services
        (collectively, the &ldquo;Service&rdquo;). By accessing or using the Service, creating an
        account, placing an order, or submitting a Sell Your Cards request, you agree to be bound
        by these Terms and by our{" "}
        <Link to="/privacy">Privacy Policy</Link>, which is incorporated by reference. If you do not
        agree, do not use the Service.
      </p>

      <h2>1. Eligibility</h2>
      <p>
        You must be at least 18 years old and capable of forming a binding contract under
        applicable law to use the Service, create an account, place an order, or submit a Sell
        Your Cards request. By using the Service, you represent and warrant that you meet these
        requirements. We may refuse service, terminate accounts, or cancel orders at our
        discretion if we believe this requirement is not met.
      </p>

      <h2>2. Accounts</h2>
      <p>
        You may browse the storefront without an account, but certain features (order history,
        saved addresses, store credit, and Sell Your Cards status) require one. You are
        responsible for maintaining the confidentiality of your account credentials and for all
        activity that occurs under your account, whether or not authorized by you. You agree to
        provide accurate, current, and complete information and to keep it updated. Notify us
        immediately at <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> of any unauthorized
        use of your account. We are not liable for any loss arising from unauthorized use of your
        account that results from your failure to safeguard your credentials.
      </p>
      <p>
        We may suspend or terminate your account at any time, with or without notice, for conduct
        that we believe violates these Terms, is fraudulent, harmful to other users or to Geega
        Games, or for any other reason at our sole discretion, including inactivity.
      </p>

      <h2>3. Products, Descriptions, and Condition Grading</h2>
      <p>
        We make reasonable efforts to describe and photograph inventory accurately, including
        assigning a condition grade using the standards described on our{" "}
        <Link to="/condition-guide">Condition Guide</Link>. Condition grading of trading cards is
        inherently subjective, and minor variances between our grading and your own assessment
        are not, by themselves, grounds for a defect claim. Product images are provided for
        reference; for single, non-mass-produced items the photographed item is generally the
        exact item shipped, but lighting, monitor calibration, and photographic conditions can
        cause minor color/appearance variation. We do not guarantee that the Service, or any
        content on it, is accurate, complete, reliable, current, or error-free.
      </p>

      <h2>4. Pricing, Availability, and Order Acceptance</h2>
      <p>
        All prices are listed in U.S. dollars and are subject to change without notice. We do our
        best to ensure pricing and inventory accuracy, but errors can occur (including
        typographical errors, pricing-feed errors, and errors in the reference pricing data we
        use for guidance). If a product is listed at an incorrect price or with incorrect
        information due to an error, or if inventory becomes unavailable after you order, we
        reserve the right, at our sole discretion, to refuse or cancel the order. If your order is
        canceled after payment, we will issue a full refund of the amount charged for the
        canceled item(s); that refund is your sole and exclusive remedy for such a cancellation.
      </p>
      <p>
        Your submission of an order is an offer to purchase, which we may accept or decline. A
        charge to your payment method, or an automated order-confirmation email, does not by
        itself constitute our acceptance of your order — acceptance occurs when we ship the
        product or otherwise expressly confirm the order.
      </p>

      <h2>5. Payment</h2>
      <p>
        Payments are processed by Stripe, Inc., a third-party payment processor. We do not store
        your full payment card number on our servers. By submitting payment information, you
        represent that you are authorized to use the payment method provided. You authorize us to
        charge the payment method for the total amount of your order, including applicable
        shipping and any taxes. We reserve the right to refuse or limit any order, including
        orders that, in our judgment, appear to be placed by resellers, distributors, or for
        fraudulent purposes.
      </p>

      <h2>6. Shipping, Delivery, and Risk of Loss</h2>
      <p>
        Shipping options, costs, and general handling information are described on our{" "}
        <Link to="/shipping">Shipping</Link> page. Delivery time estimates are provided by carriers
        and are not guaranteed by Geega Games. <strong>Plain White Envelope (PWE)</strong>{" "}
        shipping is, by design, untracked and uninsured; you accept the risk of loss or non-delivery
        associated with choosing PWE at checkout. For all shipping methods, unless otherwise
        required by applicable law, risk of loss and title to items pass to you upon our delivery
        of the package to the shipping carrier. We are not responsible for packages lost, delayed,
        misdelivered, or damaged by the carrier after that point, though we may, at our discretion
        and as a courtesy, assist you in filing a carrier claim.
      </p>
      <p>
        We currently ship only to addresses within the United States. Orders that cannot be
        delivered due to an incomplete, incorrect, or undeliverable address you provided may be
        returned to us; we are not obligated to reship or refund such orders and may charge
        reasonable costs for any reshipment.
      </p>

      <h2>7. Returns and Refunds</h2>
      <p>
        Our current return practices are described on our <Link to="/returns">Returns &amp;
        refunds</Link> page. Except as stated there or as required by applicable law, all sales are
        final. We reserve the right to refuse a return, charge a restocking fee, or offer store
        credit instead of a cash refund at our discretion, including where a returned item is not
        in the condition it was shipped in.
      </p>

      <h2>8. Store Credit</h2>
      <p>
        Store credit issued by Geega Games (including credit issued through a Sell Your Cards
        transaction) has no cash value, cannot be redeemed for cash except where required by
        applicable law, is non-transferable, and may only be applied toward future purchases on
        the Service. We reserve the right to modify, suspend, or discontinue the store-credit
        program, or to void store credit obtained through fraud, error, or abuse of these Terms,
        at any time.
      </p>

      <h2>9. Sell Your Cards / Sell Your Collection Submissions</h2>
      <p>
        By submitting a Sell Your Cards or Sell Your Collection request (a &ldquo;Submission&rdquo;),
        including any card list, description, or photographs, you represent and warrant that:
      </p>
      <ul>
        <li>you own the items described or are fully authorized by the owner to sell them;</li>
        <li>the items are not stolen, counterfeit, or subject to any lien, dispute, or third-party claim;</li>
        <li>the information you provide is accurate and not misleading; and</li>
        <li>you have the right to grant us the license described in Section 10 for any photographs you upload.</li>
      </ul>
      <p>
        <strong>A Submission is not an offer, and submitting one does not create a contract, an
        obligation to purchase, or a guaranteed valuation.</strong> Any pricing shown to you
        during or after submission (including any reference to market or Scryfall pricing data) is
        informational only and is not an offer. We evaluate Submissions individually — based on
        condition, market demand, liquidity, and physical inspection — and may make an offer,
        decline the Submission in whole or in part, or request more information, at our sole
        discretion, for any reason or no reason. A purchase is final only when we and you have
        expressly agreed on items and price and you have received payment or store credit in
        exchange for items actually delivered to and accepted by us.
      </p>
      <p>
        If you ship items to us as part of an accepted or in-progress Submission, you retain
        ownership and risk of loss for those items until we receive and accept them. We recommend
        using a tracked, insured shipping method for anything you send to us; we are not
        responsible for items lost or damaged in transit to us. If we decline all or part of a
        Submission after receiving physical items, we will return them to you at your expense
        unless we separately agree otherwise, and we may dispose of unclaimed items after a
        reasonable period (at least 60 days) following written notice to the email address on the
        Submission if we are unable to reach you or you do not respond.
      </p>
      <p>
        We do not accept unsolicited shipments sent outside of a Submission created through the
        Service. If you send us items without an associated Submission, we are not responsible
        for their safekeeping, return, or value, and may decline delivery, return them at your
        expense, or treat them as abandoned property under applicable law.
      </p>
      <p>
        <strong>Payment for an accepted Submission is made exclusively via PayPal Goods &amp;
        Services.</strong> We do not pay via PayPal Friends &amp; Family, cash, check, or any other
        method. For some Submissions — including larger or higher-value collections, or where we
        are unable to fully verify condition or authenticity from photographs alone — we may
        require that you ship the items to us for inspection and authentication before any payment
        is sent, rather than paying in advance of shipment. We will tell you which arrangement
        applies to your Submission before you are asked to ship anything.
      </p>

      <h2>10. Content You Submit; License</h2>
      <p>
        You retain ownership of any photographs, descriptions, or other content you submit through
        the Service (&ldquo;Your Content&rdquo;). By submitting Your Content, you grant Geega
        Games a non-exclusive, worldwide, royalty-free, transferable license to host, store,
        reproduce, and internally use Your Content solely for the purposes of evaluating your
        Submission, communicating with you about it, and our internal business operations
        (including fraud prevention and recordkeeping). We do not publicly display collection
        photographs submitted through the Sell Your Cards tool. You represent that you have all
        rights necessary to grant this license and that Your Content does not infringe any
        third party's rights.
      </p>

      <h2>11. Intellectual Property; Trademarks</h2>
      <p>
        <strong>Magic: The Gathering</strong>, card names, card images, and related marks are
        trademarks and/or copyrights of Wizards of the Coast LLC, a subsidiary of Hasbro, Inc., in
        the United States and other countries. Geega Games is <strong>not affiliated with,
        endorsed, sponsored, or specifically approved by Wizards of the Coast LLC</strong>. Card
        images and printing data displayed on the Service are sourced in part via the Scryfall
        API and remain the property of their respective rights holders. We sell physical,
        lawfully-acquired trading cards; our listing and sale of those physical goods does not
        constitute a claim of ownership over Wizards of the Coast's intellectual property.
      </p>
      <p>
        Other than the trademarks referenced above, the Service itself — including its design,
        text, graphics, logos, the &ldquo;Geega Games&rdquo; name and logo, and underlying
        software — is owned by Geega Games or its licensors and is protected by intellectual
        property laws. We grant you a limited, non-exclusive, non-transferable, revocable license
        to access and use the Service for your own personal, non-commercial use, subject to these
        Terms. You may not copy, modify, distribute, sell, scrape, or lease any part of the
        Service, or reverse-engineer any part of it, except as permitted by applicable law
        notwithstanding this restriction.
      </p>

      <h2>12. Prohibited Conduct</h2>
      <p>You agree not to, and not to attempt to:</p>
      <ul>
        <li>violate any applicable law or regulation in connection with the Service;</li>
        <li>provide false information when creating an account, placing an order, or submitting a Sell Your Cards request;</li>
        <li>use the Service for fraud, including payment fraud, chargeback abuse, or submitting counterfeit or stolen items;</li>
        <li>scrape, crawl, or use automated means to access the Service other than through publicly documented interfaces, or to circumvent rate limiting or other technical protections;</li>
        <li>interfere with or disrupt the Service, including its servers or networks;</li>
        <li>attempt to gain unauthorized access to any account, system, or data; or</li>
        <li>use the Service to transmit any harmful code or material.</li>
      </ul>
      <p>
        Violation of this section may result in immediate suspension or termination of your
        account, cancellation of pending orders or Submissions, and, where warranted, referral to
        law enforcement.
      </p>

      <h2>13. No Investment or Financial Advice</h2>
      <p>
        Trading card values fluctuate and are influenced by factors outside our control. Nothing
        on the Service, including any pricing, valuation estimate, or market reference data, is
        investment, financial, tax, or legal advice, and we make no representation that any card
        or collection will retain or increase in value. You acknowledge that collecting and
        trading cards involves speculative risk that you assume entirely.
      </p>

      <h2>14. Disclaimer of Warranties</h2>
      <p>
        TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, THE SERVICE AND ALL PRODUCTS SOLD
        THROUGH IT ARE PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE,&rdquo; WITHOUT
        WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING IMPLIED
        WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND
        NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, TIMELY,
        SECURE, OR ERROR-FREE, OR THAT ANY DEFECTS WILL BE CORRECTED. SOME JURISDICTIONS DO NOT
        ALLOW THE EXCLUSION OF CERTAIN WARRANTIES, SO SOME OF THE ABOVE EXCLUSIONS MAY NOT APPLY
        TO YOU, AND YOU MAY HAVE ADDITIONAL RIGHTS.
      </p>

      <h2>15. Limitation of Liability</h2>
      <p>
        TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT WILL GEEGA GAMES, ITS
        OWNER, MEMBERS, OFFICERS, EMPLOYEES, OR AGENTS BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
        SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS,
        REVENUE, DATA, OR GOODWILL, ARISING OUT OF OR RELATED TO YOUR USE OF THE SERVICE, EVEN IF
        WE HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. OUR TOTAL AGGREGATE LIABILITY TO
        YOU FOR ANY CLAIM ARISING OUT OF OR RELATED TO THE SERVICE OR THESE TERMS WILL NOT EXCEED
        THE GREATER OF (A) THE AMOUNT YOU PAID TO US FOR THE PRODUCT OR TRANSACTION GIVING RISE TO
        THE CLAIM IN THE 12 MONTHS BEFORE THE CLAIM AROSE, OR (B) ONE HUNDRED U.S. DOLLARS
        ($100). SOME JURISDICTIONS DO NOT ALLOW THE LIMITATION OR EXCLUSION OF LIABILITY FOR
        CERTAIN DAMAGES, SO SOME OF THE ABOVE LIMITATIONS MAY NOT APPLY TO YOU.
      </p>

      <h2>16. Indemnification</h2>
      <p>
        You agree to indemnify, defend, and hold harmless Geega Games and its owner, members,
        officers, employees, and agents from and against any claims, liabilities, damages,
        losses, and expenses, including reasonable attorneys' fees, arising out of or in any way
        connected with: (a) your use or misuse of the Service; (b) your violation of these Terms;
        (c) your violation of any applicable law or the rights of a third party; or (d) any
        Submission you make, including any breach of the warranties in Section 9.
      </p>

      <h2>17. Dispute Resolution; Binding Arbitration; Class Action Waiver</h2>
      <p>
        <strong>Please read this section carefully — it affects your legal rights and requires
        most disputes to be resolved by individual binding arbitration rather than in court.</strong>
      </p>
      <p>
        <em>Agreement to Arbitrate.</em> Except for disputes that qualify for small claims court
        or seek injunctive relief for intellectual-property infringement or misuse, you and Geega
        Games agree that any dispute, claim, or controversy arising out of or relating to these
        Terms or the Service will be resolved by binding arbitration administered by the American
        Arbitration Association (&ldquo;AAA&rdquo;) under its Consumer Arbitration Rules then in
        effect, rather than in court, except that either party may bring an individual action in
        small claims court. The arbitration will be conducted in Missouri, or another mutually
        agreed location, or, at your option, by telephone or written submissions. Judgment on the
        arbitration award may be entered in any court of competent jurisdiction.
      </p>
      <p>
        <em>Class Action Waiver.</em> YOU AND GEEGA GAMES AGREE THAT EACH MAY BRING CLAIMS AGAINST
        THE OTHER ONLY IN YOUR OR ITS INDIVIDUAL CAPACITY, AND NOT AS A PLAINTIFF OR CLASS MEMBER
        IN ANY PURPORTED CLASS, CONSOLIDATED, OR REPRESENTATIVE PROCEEDING. Unless both parties
        agree otherwise, the arbitrator may not consolidate more than one person's claims and may
        not otherwise preside over any form of a representative or class proceeding.
      </p>
      <p>
        <em>Right to Opt Out.</em> You may opt out of this arbitration agreement by sending
        written notice to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> within 30 days of
        the date you first accept these Terms (for example, by first creating an account or
        placing an order), stating your name and that you decline to be bound by this arbitration
        agreement. If you opt out, only this Section 17's arbitration and class-action-waiver
        provisions will not apply to you; the rest of these Terms, including the Missouri
        governing-law and venue provisions below for any dispute you bring in court, still apply.
      </p>
      <p>
        <em>Severability.</em> If the class-action waiver in this section is found unenforceable
        as to a particular claim, then that claim (and only that claim) may proceed in court, and
        the remainder of this arbitration agreement will still apply to any other claims.
      </p>

      <h2>18. Governing Law and Venue</h2>
      <p>
        These Terms are governed by the laws of the State of Missouri, without regard to its
        conflict-of-laws principles. For any dispute not subject to arbitration under Section 17,
        you agree that the state and federal courts located in Missouri will have exclusive
        jurisdiction, and you consent to personal jurisdiction and venue there.
      </p>

      <h2>19. Force Majeure</h2>
      <p>
        We are not liable for any delay or failure to perform resulting from causes outside our
        reasonable control, including acts of God, natural disaster, war, terrorism, riots,
        embargoes, acts of civil or military authority, fire, flood, epidemic, strikes, or
        shortages of transportation, facilities, fuel, energy, labor, or materials.
      </p>

      <h2>20. Changes to These Terms</h2>
      <p>
        We may modify these Terms at any time by posting the revised Terms on the Service with an
        updated effective date. Changes are effective when posted, except that changes to the
        arbitration agreement in Section 17 will not apply to disputes that arose before the
        change. Your continued use of the Service after a change is posted constitutes acceptance
        of the revised Terms. If you do not agree to a change, your sole remedy is to stop using
        the Service.
      </p>

      <h2>21. General</h2>
      <p>
        If any provision of these Terms is found unenforceable, that provision will be limited or
        eliminated to the minimum extent necessary, and the remaining provisions will remain in
        full effect. Our failure to enforce any provision is not a waiver of that or any other
        provision. You may not assign these Terms without our prior written consent; we may
        assign these Terms without restriction, including in connection with a merger,
        acquisition, or sale of assets. These Terms, together with our Privacy Policy and any
        additional terms referenced on the Service (such as our Shipping and Returns pages),
        constitute the entire agreement between you and Geega Games regarding the Service.
      </p>

      <h2>22. Contact</h2>
      <p>
        Questions about these Terms can be sent to{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
      <p className="gg-card-meta">
        Geega Games LLC — [insert registered business address before publishing to the public].
      </p>
    </div>
  );
}
