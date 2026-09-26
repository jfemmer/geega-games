// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeleteLeadSection } from "../src/admin/components/leads/DeleteLeadSection";
import { Modal } from "../src/admin/components/ui/Modal";

// The "Delete lead" block in the lead drawers, and the confirmation it opens
// on top of the drawer.

afterEach(cleanup);

describe("DeleteLeadSection", () => {
  it("asks before deleting, and deletes only on confirm", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn(async () => {});
    render(<DeleteLeadSection referenceNumber="GG-S-100010" onDelete={onDelete} />);

    await user.click(screen.getByRole("button", { name: "Delete lead" }));
    const dialog = screen.getByRole("dialog", { name: "Delete lead GG-S-100010?" });
    expect(dialog).toHaveTextContent("can't be undone");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Delete lead" }));
    const confirm = screen.getAllByRole("button", { name: "Delete lead" }).at(-1)!;
    await user.click(confirm);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("adds the extra caution to the confirmation", async () => {
    const user = userEvent.setup();
    render(
      <DeleteLeadSection
        referenceNumber="GG-S-100011"
        warning="It's marked Completed, so it's your record of buying these cards."
        onDelete={async () => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Delete lead" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("marked Completed");
  });

  it("explains instead of offering Delete when the lead has to be kept", () => {
    render(
      <DeleteLeadSection
        referenceNumber="GG-S-100012"
        blockedReason="Store credit was issued for this lead, so it's kept as the record of that credit."
        onDelete={async () => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Delete lead" })).toBeNull();
    expect(screen.getByText(/Store credit was issued/)).toBeInTheDocument();
  });

  it("Escape closes only the confirmation, not the drawer underneath", async () => {
    const user = userEvent.setup();
    const closeDrawer = vi.fn();
    render(
      <Modal open onClose={closeDrawer} title="Lead GG-R-100010" variant="drawer">
        <DeleteLeadSection referenceNumber="GG-R-100010" onDelete={async () => {}} />
      </Modal>,
    );
    await user.click(screen.getByRole("button", { name: "Delete lead" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(2);

    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(closeDrawer).not.toHaveBeenCalled();

    // With the confirmation gone, Escape closes the drawer as before.
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    });
    expect(closeDrawer).toHaveBeenCalledTimes(1);
  });
});
