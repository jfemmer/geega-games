import * as React from "react";
import { Heading, Text } from "@react-email/components";
import { BaseLayout, brand } from "./BaseLayout.js";

export type SubscriptionConfirmedProps = {
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
  unsubscribeUrl: string;
};

export function SubscriptionConfirmed({
  siteUrl,
  logoUrl,
  supportEmail,
  unsubscribeUrl,
}: SubscriptionConfirmedProps) {
  return (
    <BaseLayout
      previewText="You're on the list — we'll email you when Geega Games opens."
      siteUrl={siteUrl}
      logoUrl={logoUrl}
      supportEmail={supportEmail}
      reasonLine="You received this because you confirmed your email at Geega Games."
      footerExtra={
        <Text style={unsub}>
          Don’t want launch updates?{" "}
          <a href={unsubscribeUrl} style={unsubLink}>
            Unsubscribe
          </a>
          .
        </Text>
      }
    >
      <Heading style={h1}>You’re on the list 🎉</Heading>
      <Text style={p}>
        Your email is confirmed. You’ll receive our store-launch announcement the
        moment browsing turns into buying — no spam in between, just the launch.
      </Text>
      <Text style={p}>Thanks for being early. — The Geega Games team</Text>
    </BaseLayout>
  );
}

export function subscriptionConfirmedText(p: SubscriptionConfirmedProps): string {
  return [
    "You're on the list — Geega Games",
    "",
    "Your email is confirmed. You'll receive our store-launch announcement the",
    "moment browsing turns into buying — no spam in between, just the launch.",
    "",
    "Thanks for being early. — The Geega Games team",
    "",
    `Unsubscribe: ${p.unsubscribeUrl}`,
    `Questions? ${p.supportEmail}`,
  ].join("\n");
}

const h1: React.CSSProperties = {
  color: brand.purpleDeep,
  fontSize: "22px",
  fontWeight: 600,
  margin: "0 0 12px",
};
const p: React.CSSProperties = {
  color: brand.ink,
  fontSize: "15px",
  lineHeight: "24px",
  margin: "0 0 16px",
};
const unsub: React.CSSProperties = {
  color: brand.muted,
  fontSize: "12px",
  margin: 0,
};
const unsubLink: React.CSSProperties = {
  color: brand.purple,
  textDecoration: "underline",
};
