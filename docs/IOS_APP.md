# Geega Admin — the iPhone app

The admin dashboard as a real iPhone (and iPad) app, installed privately
through **TestFlight** — no public App Store listing.

What it adds over the dashboard in Safari:

- **Notifications with their own sound for each type**, even when the phone
  is locked: new order ("cha-ching"), new buying lead (rising three notes),
  new partner lead (doorbell), new customer sign-up (friendly "bloop").
  Offer responses and pickup requests share a chime.
- Its own icon, full screen, stays signed in.

The app shows the live dashboard from geega-games.com, so **every website
deploy updates it instantly**. A new app build is only needed when the
native parts change (`ios/`, `native/`, `capacitor.config.ts`) — GitHub
does that automatically — and to refresh TestFlight, whose builds expire
after 90 days (GitHub also does that, every other month).

---

## One-time setup

Allow about 45 minutes once Apple has approved your developer account.
Keep the downloaded `.p8` key files somewhere safe: **Apple only lets you
download each one once.**

### 1. Join the Apple Developer Program

1. Go to <https://developer.apple.com/programs/enroll/> and sign in with the
   Apple ID you want to own the app.
2. Enroll as an **individual** (quickest) or as an **organization** (shows
   "Geega Games" as the developer; needs a free D-U-N-S number and takes
   longer). $99/year.
3. Wait for the approval email (usually 1–2 days).

### 2. Note your Team ID

<https://developer.apple.com/account> → **Membership details** → **Team ID**
(10 characters, like `A1B2C3D4E5`).

### 3. Register the app

1. <https://developer.apple.com/account/resources/identifiers/list> → **+** →
   **App IDs** → **App** → Continue.
2. Description: `Geega Admin`. Bundle ID: **Explicit** →
   `com.geegagames.admin`.
3. Under **Capabilities**, tick **Push Notifications**. Continue → Register.
4. Go to <https://appstoreconnect.apple.com> → **Apps** → **+** → **New App**:
   - Platforms: **iOS**
   - Name: `Geega Admin` (if it's taken, `Geega Games Admin`: the name on
     the home screen stays "Geega Admin")
   - Primary language: English (U.S.)
   - Bundle ID: `com.geegagames.admin`
   - SKU: `geega-admin`
   - User Access: Full Access

### 4. Create the key GitHub builds with

1. App Store Connect → **Users and Access** → **Integrations** →
   **App Store Connect API** → **Team Keys** → **+**.
2. Name: `GitHub build`. Access: **Admin** (needed so the build can create
   its own signing certificate). Generate.
3. **Download** the key (`AuthKey_XXXXXXXXXX.p8`). Note the **Key ID** next
   to it and the **Issuer ID** at the top of the page.

### 5. Add four secrets to GitHub

GitHub → the `geega-games` repository → **Settings** → **Secrets and
variables** → **Actions** → **New repository secret**, four times:

| Name | Value |
|---|---|
| `APP_STORE_CONNECT_KEY_ID` | the Key ID from step 4 |
| `APP_STORE_CONNECT_ISSUER_ID` | the Issuer ID from step 4 |
| `APP_STORE_CONNECT_KEY_P8` | the whole contents of the `.p8` file from step 4 (open it in a text editor; include the `BEGIN`/`END` lines) |
| `APPLE_TEAM_ID` | your Team ID from step 2 |

### 6. Create the notification key and add it to Vercel

1. <https://developer.apple.com/account/resources/authkeys/list> → **+**.
2. Name: `Geega Admin push`. Tick **Apple Push Notifications service
   (APNs)** → **Configure** → Environment: **Sandbox & Production** →
   Save → Continue → Register.
3. **Download** the key and note its **Key ID**.
4. Vercel → **geega-games** → **Settings** → **Environment Variables**. Add
   these for **Production**, marked **Sensitive**:

   | Name | Value |
   |---|---|
   | `APNS_KEY_ID` | the Key ID from this step |
   | `APNS_TEAM_ID` | your Team ID |
   | `APNS_PRIVATE_KEY` | the whole contents of this step's `.p8` file |

5. **Redeploy** (Deployments → the latest → ⋯ → Redeploy). New variables
   only reach new deployments.

### 7. Build the app

GitHub → **Actions** → **iPhone app → TestFlight** → **Run workflow**. It
takes about 15 minutes. When it's green, the build appears in App Store
Connect → **Geega Admin** → **TestFlight** after Apple finishes processing
it (usually 5–15 more minutes).

### 8. Install it

1. App Store Connect → **Users and Access** → **+**: invite each staff member
   who should have the app (any role works; "Customer Support" is the most
   limited). You're already there as the account holder.
2. **Geega Admin** → **TestFlight** → **Internal Testing** → **+** → group
   `Staff` → add those people → tick **Enable automatic distribution** so
   new builds reach them without anyone lifting a finger.
3. On each iPhone: install **TestFlight** from the App Store, open the
   invite email (or TestFlight itself), and tap **Install** next to Geega
   Admin.

### 9. Turn notifications on

Open **Geega Admin** → sign in → tap the banner (or your profile menu →
**Push notifications**) → **Turn on notifications** → **Allow** → **Send a
test**. Use the **Play** buttons to hear each type's sound.

---

## Day to day

- **Website changes:** nothing to do; the app shows them immediately.
- **Native changes** (`ios/`, `native/`, `capacitor.config.ts`): pushing to
  `main` builds and uploads a new version automatically.
- **Expiry:** TestFlight builds last 90 days. The workflow uploads a fresh
  one on the 1st of every other month; with automatic distribution on,
  phones update on their own.
- **New staff member:** step 8. **Someone leaves:** remove them in App Store
  Connect and take away their staff role in the dashboard. They stop getting
  notifications right away, because the server re-checks staff access before
  every send.
- **Changing a sound:** edit `src/admin/utils/soundTones.ts`, run
  `npm run sounds:render`, commit. The previews and the notifications stay
  identical because both come from those notes.

## Costs

- Apple Developer Program: $99/year.
- GitHub Actions: Mac build minutes count 10× against the monthly allowance
  for private repositories (the free plan's 2,000 minutes ≈ 200 Mac minutes,
  about a dozen builds). A handful of builds a month fits comfortably.

## Troubleshooting

| Problem | Fix |
|---|---|
| The workflow says "Skipping the iPhone build" | One of the four secrets in step 5 is missing or misnamed. |
| Build fails with "No profiles" / "No signing certificate" | The API key in step 4 needs **Admin** access. Create a new one and update the three secrets. |
| Upload fails with "no suitable application records" | Finish step 3.4: create the app in App Store Connect with bundle ID `com.geegagames.admin`. |
| Upload rejected for an old SDK | Apple raised the minimum Xcode. Change `runs-on: macos-15` in `.github/workflows/ios-testflight.yml` to the newest macOS runner. |
| The app says notifications aren't set up | Step 6: the three `APNS_*` variables, then redeploy. |
| "Send a test" says Apple didn't accept it | Check `APNS_TEAM_ID` and that the key has APNs ticked. Check the whole `.p8` is in `APNS_PRIVATE_KEY`. |
| Notifications arrive but make no sound | The iPhone is on Silent or in a Focus mode, or sounds are off in Settings → Notifications → Geega Admin. |

## How it works (for developers)

- **Shell:** Capacitor 8 (`capacitor.config.ts`, `ios/`, Swift Package
  Manager, no CocoaPods). It loads `https://geega-games.com/admin_dashboard`
  (`server.url`). Admin pages stay in the app; other links open in Safari.
  `native/www` is bundled: the offline screen (`server.errorPath`) and the
  sounds.
- **Push:** in the app, `src/admin/services/push.ts` hands off to
  `nativePush.ts` (`@capacitor/push-notifications`). That registers the APNs
  token with `/api/admin/native-push`, stored in `staff_apns_devices`.
  `notifyStaff()` (`api/_lib/staffPush.ts`) sends every event to both web
  push devices and iPhones, through `api/_lib/apns.ts` (token auth, HTTP/2).
- **Sounds:** `src/admin/utils/soundTones.ts` → `npm run sounds:render` →
  `native/www/sounds/*.wav`. Those ship in the app, and `AppDelegate.swift`
  copies them to `Library/Sounds` on launch. Each push names its file in
  `aps.sound`.
- **Build:** `.github/workflows/ios-testflight.yml` on a GitHub-hosted Mac:
  `cap sync ios` → `xcodebuild archive` → export and upload
  (`ios/ExportOptions.plist`, internal TestFlight only). Signing is automatic
  through the App Store Connect API key.
