import * as React from "react";
import { Button, Heading, Link, Text } from "@react-email/components";
import { BaseLayout, brand } from "./BaseLayout.js";

export type ConfirmSubscriptionProps = {
  confirmUrl: string;
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
  expiresInHours: number;
};

export function ConfirmSubscription({
  confirmUrl,
  siteUrl,
  logoUrl,
  supportEmail,
  expiresInHours,
}: ConfirmSubscriptionProps) {
  return (
    <BaseLayout
      previewText="Confirm your email to get the Geega Games launch notice."
      siteUrl={siteUrl}
      logoUrl={logoUrl}
      supportEmail={supportEmail}
      reasonLine="You received this because this address was entered at Geega Games."
    >
      <Heading style={h1}>Confirm your email</Heading>
      <Text style={p}>
        Thanks for your interest in Geega Games. Confirm this address and we’ll
        email you the moment the shop — and checkout — go live.
      </Text>

      <Button href={confirmUrl} style={button}>
        Confirm my email
      </Button>

      <Text style={small}>
        Or paste this link into your browser:
        <br />
        <Link href={confirmUrl} style={link}>
          {confirmUrl}
        </Link>
      </Text>

      <Text style={small}>
        This link expires in {expiresInHours} hours. If you didn’t sign up, you
        can safely ignore this email — nothing will be sent.
      </Text>
    </BaseLayout>
  );
}

// Provide a matching plaintext version (Resend also auto-generates one, but an
// explicit copy keeps wording controlled).
export function confirmSubscriptionText(p: ConfirmSubscriptionProps): string {
  return [
    "Confirm your email — Geega Games",
    "",
    "Thanks for your interest in Geega Games. Confirm this address and we'll",
    "email you the moment the shop and checkout go live.",
    "",
    "Confirm your email:",
    p.confirmUrl,
    "",
    `This link expires in ${p.expiresInHours} hours. If you didn't sign up, ignore this email.`,
    "",
    `Questions? ${p.supportEmail}`,
    "You received this because this address was entered at Geega Games.",
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
  margin: "0 0 20px",
};
const button: React.CSSProperties = {
  backgroundColor: brand.purple,
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: 600,
  borderRadius: "10px",
  padding: "12px 22px",
  textDecoration: "none",
  display: "inline-block",
};
const small: React.CSSProperties = {
  color: brand.muted,
  fontSize: "13px",
  lineHeight: "20px",
  margin: "20px 0 0",
  wordBreak: "break-all",
};
const link: React.CSSProperties = {
  color: brand.purple,
  textDecoration: "underline",
};
