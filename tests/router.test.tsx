// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, RouterProvider, useRouter } from "../src/store/lib/router";

// The storefront's router (src/store/lib/router.tsx): an address's #fragment
// isn't part of the route. A link to /trade-cards#trade-cart has to show the
// Trade Cards page and then bring the trade cart into view; before, the
// fragment stayed in the route and the page wasn't found.

function Page() {
  const { path, query } = useRouter();
  const search = query.toString();
  return (
    <>
      <p data-testid="where">{`${path}${search ? `?${search}` : ""}`}</p>
      {path === "/trade-cards" && <section id="trade-cart">Your trade cart</section>}
      <Link to="/trade-cards#trade-cart">Review your trade</Link>
      <Link to="/shop?q=bolt">Search for Bolt</Link>
      <Link to="#trade-cart">Jump to the cart</Link>
      <Link to="/trade-cards#nothing-here">A missing anchor</Link>
    </>
  );
}

const scrollIntoView = vi.fn();

beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
  scrollIntoView.mockClear();
  window.history.replaceState({}, "", "/shop/card/sheoldred-the-apocalypse");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the router", () => {
  it("routes a link with a #fragment by its path, keeps the fragment in the address, and scrolls to it", async () => {
    const user = userEvent.setup();
    const scrollTo = vi.spyOn(window, "scrollTo");
    render(
      <RouterProvider>
        <Page />
      </RouterProvider>,
    );
    expect(screen.getByRole("link", { name: "Review your trade" })).toHaveAttribute("href", "/trade-cards#trade-cart");

    await user.click(screen.getByRole("link", { name: "Review your trade" }));

    expect(screen.getByTestId("where")).toHaveTextContent(/^\/trade-cards$/);
    expect(window.location.pathname).toBe("/trade-cards");
    expect(window.location.hash).toBe("#trade-cart");
    // The cart scrolls into view once the page is there, instead of the jump to the top.
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById("trade-cart"));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("still starts a page without a fragment at the top, query string and all", async () => {
    const user = userEvent.setup();
    const scrollTo = vi.spyOn(window, "scrollTo");
    render(
      <RouterProvider>
        <Page />
      </RouterProvider>,
    );

    await user.click(screen.getByRole("link", { name: "Search for Bolt" }));

    expect(screen.getByTestId("where")).toHaveTextContent(/^\/shop\?q=bolt$/);
    expect(window.location.pathname + window.location.search).toBe("/shop?q=bolt");
    expect(window.location.hash).toBe("");
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("keeps a link that's only a #fragment on the same page", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/trade-cards");
    render(
      <RouterProvider>
        <Page />
      </RouterProvider>,
    );

    await user.click(screen.getByRole("link", { name: "Jump to the cart" }));

    expect(screen.getByTestId("where")).toHaveTextContent(/^\/trade-cards$/);
    expect(window.location.hash).toBe("#trade-cart");
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById("trade-cart"));
  });

  it("goes to the top when the fragment names nothing on the page", async () => {
    const user = userEvent.setup();
    const scrollTo = vi.spyOn(window, "scrollTo");
    render(
      <RouterProvider>
        <Page />
      </RouterProvider>,
    );

    await user.click(screen.getByRole("link", { name: "A missing anchor" }));

    expect(screen.getByTestId("where")).toHaveTextContent(/^\/trade-cards$/);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
});
