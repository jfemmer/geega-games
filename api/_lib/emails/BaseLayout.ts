import * as React from "react";
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

// Loosely-typed createElement wrapper: React Email components type `children`
// as required, which the variadic createElement overload does not always satisfy.
const h = (
  type: unknown,
  props?: Record<string, unknown> | null,
  ...children: React.ReactNode[]
): React.ReactElement =>
  React.createElement(
    type as React.ElementType,
    props as Record<string, unknown>,
    ...children,
  );

// Brand tokens mirror src/index.css so emails match the storefront.
export const brand = {
  purple: "#663399",
  purpleDeep: "#4c2a85",
  gold: "#e0b341",
  ink: "#1a1526",
  parchment: "#f7f4ef",
  muted: "#6b6076",
  line: "#e7e0f2",
};

type BaseLayoutProps = {
  previewText: string;
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
  children: React.ReactNode;
  footerExtra?: React.ReactNode;
  reasonLine?: string;
};

export function BaseLayout({
  previewText,
  siteUrl,
  logoUrl,
  supportEmail,
  children,
  footerExtra,
  reasonLine,
}: BaseLayoutProps) {
  return h(
    Html,
    { lang: "en" },
    h(Head, null),
    h(Preview, null, previewText),
    h(
      Body,
      { style: styles.body },
      h(
        Container,
        { style: styles.container },
        h(
          Section,
          { style: styles.header },
          h(
            Link,
            { href: siteUrl },
            h(Img, {
              src: logoUrl,
              width: "160",
              alt: "Geega Games",
              style: styles.logo,
            }),
          ),
        ),
        h(Section, { style: styles.card }, children),
        h(
          Section,
          { style: styles.footer },
          footerExtra
            ? h("div", { style: styles.footerExtra }, footerExtra)
            : null,
          h(Hr, { style: styles.hr }),
          h(
            Text,
            { style: styles.footerText },
            "Questions? Reach us at ",
            h(Link, { href: `mailto:${supportEmail}`, style: styles.link }, supportEmail),
            ".",
          ),
          reasonLine ? h(Text, { style: styles.reason }, reasonLine) : null,
          h(
            Text,
            { style: styles.reason },
            `© ${new Date().getFullYear()} Geega Games · `,
            h(
              Link,
              { href: siteUrl, style: styles.link },
              siteUrl.replace(/^https?:\/\//, ""),
            ),
          ),
        ),
      ),
    ),
  );
}

const styles: Record<string, React.CSSProperties> = {
  body: {
    backgroundColor: brand.parchment,
    fontFamily:
      "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    margin: 0,
    padding: "24px 0",
  },
  container: { width: "100%", maxWidth: "560px", margin: "0 auto" },
  header: { textAlign: "center", padding: "8px 0 16px" },
  logo: { display: "block", margin: "0 auto" },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: "16px",
    border: `1px solid ${brand.line}`,
    padding: "28px 28px 24px",
  },
  footer: { padding: "18px 8px 4px" },
  footerExtra: { marginBottom: "8px" },
  hr: { borderColor: brand.line, margin: "12px 0" },
  footerText: { color: brand.muted, fontSize: "13px", margin: "6px 0" },
  reason: { color: brand.muted, fontSize: "12px", margin: "4px 0" },
  link: { color: brand.purple, textDecoration: "underline" },
};