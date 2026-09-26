// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The settings panel has to give a clear next step for every state a phone
// can be in. The browser push APIs are mocked at the service boundary.

const push = {
  native: false,
  availability: "supported" as "supported" | "ios-needs-install" | "unsupported" | "insecure",
  permission: "default" as NotificationPermission,
  config: { configured: true, publicKey: "BKey" },
  device: { subscribed: false, kinds: [] as string[] },
  enable: vi.fn(),
  disable: vi.fn(),
  update: vi.fn(),
  test: vi.fn(),
};

vi.mock("../src/admin/services/push", () => ({
  PushPermissionError: class extends Error {},
  pushAvailability: () => push.availability,
  notificationPermission: () => push.permission,
  currentPermission: async () => push.permission,
  isNativeApp: () => push.native,
  isStandalone: () => false,
  isIosDevice: () => push.availability === "ios-needs-install",
  fetchPushConfig: async () => push.config,
  deviceState: async () => push.device,
  enablePush: async (key: string) => {
    push.enable(key);
    return { subscribed: true, kinds: ["order", "buying_lead", "partner_lead", "signup", "offer_response", "pickup"] };
  },
  disablePush: async () => push.disable(),
  updatePushKinds: async (kinds: string[]) => {
    push.update(kinds);
    return { subscribed: true, kinds };
  },
  sendTestPush: async () => push.test(),
  canPromptInstall: () => false,
  subscribeInstallPrompt: () => () => undefined,
  promptInstall: async () => false,
}));

const { NotificationSettingsModal } = await import("../src/admin/components/layout/NotificationSettingsModal");
const { ToastProvider } = await import("../src/admin/components/ui/ToastProvider");

function renderModal() {
  return render(
    <ToastProvider>
      <NotificationSettingsModal open onClose={() => undefined} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  push.native = false;
  push.availability = "supported";
  push.permission = "default";
  push.config = { configured: true, publicKey: "BKey" };
  push.device = { subscribed: false, kinds: [] };
  push.enable.mockReset();
  push.disable.mockReset();
  push.update.mockReset();
  push.test.mockReset();
});

afterEach(cleanup);

describe("NotificationSettingsModal", () => {
  it("walks an iPhone in Safari through Add to Home Screen first", async () => {
    push.availability = "ios-needs-install";
    renderModal();
    expect(await screen.findByText("Add to Home Screen")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /turn on notifications/i })).toBeNull();
  });

  it("says when the server isn't set up yet", async () => {
    push.config = { configured: false, publicKey: null as unknown as string };
    renderModal();
    expect(await screen.findByText(/aren.t set up on the server yet/i)).toBeInTheDocument();
  });

  it("explains how to unblock notifications once they were denied", async () => {
    push.permission = "denied";
    renderModal();
    expect(await screen.findByText(/blocked for Geega Admin/i)).toBeInTheDocument();
  });

  it("turns notifications on with the server's key, then shows the per-event choices", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(await screen.findByRole("button", { name: /turn on notifications/i }));
    expect(push.enable).toHaveBeenCalledWith("BKey");
    // Both the confirmation toast and the panel say so.
    expect(await screen.findAllByText(/notifications are on for this device/i)).toHaveLength(2);
    expect(screen.getByRole("checkbox", { name: /new online orders/i })).toBeChecked();
  });

  it("offers a preview of each type's sound once notifications are on", async () => {
    push.device = { subscribed: true, kinds: ["order"] };
    renderModal();
    for (const label of ["new order", "new buying lead", "new partner lead", "new sign-up"]) {
      expect(await screen.findByRole("button", { name: `Play the ${label} sound` })).toBeInTheDocument();
    }
    expect(screen.getByRole("checkbox", { name: /a different sound for each type/i })).toBeChecked();
  });

  describe("inside the Geega Admin iPhone app", () => {
    it("points at the Apple push key when the server isn't set up", async () => {
      push.native = true;
      push.config = { configured: false, publicKey: null as unknown as string };
      renderModal();
      expect(await screen.findByText("APNS_KEY_ID")).toBeInTheDocument();
    });

    it("turns on without a web push key", async () => {
      push.native = true;
      push.config = { configured: true, publicKey: null as unknown as string };
      const user = userEvent.setup();
      renderModal();
      await user.click(await screen.findByRole("button", { name: /turn on notifications/i }));
      expect(push.enable).toHaveBeenCalledWith("");
    });

    it("explains the sounds play even when locked, with no browser-only switch", async () => {
      push.native = true;
      push.device = { subscribed: true, kinds: ["order"] };
      renderModal();
      expect(await screen.findByText(/even when your iPhone is locked/i)).toBeInTheDocument();
      expect(screen.queryByRole("checkbox", { name: /a different sound for each type/i })).toBeNull();
      expect(screen.getByRole("button", { name: "Play the new order sound" })).toBeInTheDocument();
    });
  });

  it("lets a device opt out of one kind of event, and send a test", async () => {
    push.device = { subscribed: true, kinds: ["order", "pickup"] };
    const user = userEvent.setup();
    renderModal();
    await user.click(await screen.findByRole("checkbox", { name: /pickup requests/i }));
    expect(push.update).toHaveBeenCalledWith(["order"]);
    await user.click(screen.getByRole("button", { name: /send a test/i }));
    expect(push.test).toHaveBeenCalled();
  });
});
