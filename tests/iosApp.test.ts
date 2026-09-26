import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config from "../capacitor.config";
import { SOUND_FILES, SOUND_TONES, type SoundKey } from "../src/admin/utils/soundTones";
import { encodeWav, renderSamples } from "../scripts/renderNotificationSounds";

// The Geega Admin iPhone app: the shell's config, the per-type push sounds,
// and the project settings the cloud build relies on. None of this can be
// compiled here (that needs Xcode), so these checks keep the pieces that
// must agree with each other in agreement.

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("Capacitor config", () => {
  it("wraps the live admin dashboard and keeps everything else out of the app", () => {
    expect(config.appId).toBe("com.geegagames.admin");
    expect(config.appName).toBe("Geega Admin");
    expect(config.server?.url).toBe("https://geega-games.com/admin_dashboard");
    expect(existsSync(new URL(`${config.webDir}/${config.server?.errorPath}`, root))).toBe(true);
  });

  it("matches the APNs topic the server sends to", () => {
    expect(read("api/_lib/env.ts")).toContain(`optionalEnv("APNS_BUNDLE_ID", "${config.appId}")`);
    expect(read("ios/App/App.xcodeproj/project.pbxproj")).toContain(`PRODUCT_BUNDLE_IDENTIFIER = ${config.appId};`);
  });
});

describe("notification sounds", () => {
  it("ships a .wav in the app for every sound the server can name", () => {
    for (const file of Object.values(SOUND_FILES)) {
      expect(existsSync(new URL(`native/www/sounds/${file}`, root)), file).toBe(true);
    }
  });

  it("keeps the shipped files in step with the notes (run `npm run sounds:render` after editing a sound)", () => {
    for (const key of Object.keys(SOUND_TONES) as SoundKey[]) {
      const shipped = readFileSync(new URL(`native/www/sounds/${SOUND_FILES[key]}`, root));
      expect(shipped.equals(encodeWav(renderSamples(SOUND_TONES[key]))), key).toBe(true);
    }
  });

  it("writes playable 16-bit mono PCM under Apple's 30-second limit, without clipping", () => {
    const samples = renderSamples(SOUND_TONES.order);
    const wav = encodeWav(samples);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(44_100);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(samples.length / 44_100).toBeLessThan(30);
    expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(0.9);
  });

  it("installs the sounds where iOS looks for push sounds", () => {
    const delegate = read("ios/App/App/AppDelegate.swift");
    expect(delegate).toContain('appendingPathComponent("public/sounds"');
    expect(delegate).toContain('appendingPathComponent("Sounds"');
    expect(delegate).toContain("capacitorDidRegisterForRemoteNotifications");
  });
});

describe("iOS project for the cloud build", () => {
  it("asks for the push notification entitlement", () => {
    expect(read("ios/App/App/App.entitlements")).toContain("<key>aps-environment</key>");
    expect(read("ios/App/App.xcodeproj/project.pbxproj").match(/CODE_SIGN_ENTITLEMENTS = App\/App.entitlements;/g)).toHaveLength(2);
  });

  it("has a shared scheme and uploads straight to TestFlight for internal testers", () => {
    expect(existsSync(new URL("ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme", root))).toBe(true);
    const exportOptions = read("ios/ExportOptions.plist");
    expect(exportOptions).toContain("<string>app-store-connect</string>");
    expect(exportOptions).toContain("<string>upload</string>");
    expect(exportOptions).toContain("<key>testFlightInternalTestingOnly</key>");
  });

  it("skips export-compliance questions (HTTPS only)", () => {
    expect(read("ios/App/App/Info.plist")).toMatch(/ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
  });

  it("builds from the four documented repository secrets", () => {
    const workflow = read(".github/workflows/ios-testflight.yml");
    for (const secret of ["APP_STORE_CONNECT_KEY_ID", "APP_STORE_CONNECT_ISSUER_ID", "APP_STORE_CONNECT_KEY_P8", "APPLE_TEAM_ID"]) {
      expect(workflow, secret).toContain(`secrets.${secret}`);
      expect(read("docs/IOS_APP.md"), secret).toContain(secret);
    }
  });
});
