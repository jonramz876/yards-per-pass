import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Read resilience spec §1.2 "Try again must actually retry" (review I3).
//
// reset() only re-renders the error boundary against the server payload it
// already holds; the server component runs again only on router.refresh().
// And the two must share ONE transition: reset is an urgent setState and
// refresh lands later, so called bare the boundary re-throws the old error
// before the fresh payload arrives and the first click does nothing visible.
const log: string[] = [];
let inTransition = false;
let transitions = 0;

const refresh = vi.fn(() => {
  log.push(`refresh inTransition=${inTransition}`);
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    startTransition: (callback: () => void) => {
      transitions += 1;
      inTransition = true;
      try {
        callback();
      } finally {
        inTransition = false;
      }
    },
  };
});

import ErrorState from "@/components/ui/ErrorState";

const reset = vi.fn(() => {
  log.push(`reset inTransition=${inTransition}`);
});

beforeEach(() => {
  log.length = 0;
  transitions = 0;
  refresh.mockClear();
  reset.mockClear();
});

describe("ErrorState", () => {
  it("shows the title, the shared message and both buttons", () => {
    render(<ErrorState title="Unable to load player data" reset={reset} />);
    expect(screen.getByRole("heading", { name: "Unable to load player data" })).toBeTruthy();
    expect(
      screen.getByText("Something went wrong loading this page. Try refreshing, or come back in a few minutes."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    const report = screen.getByRole("link", { name: "Report issue" });
    expect(report.getAttribute("href")).toBe("https://github.com/jonramz876/yards-per-pass/issues");
  });

  it("falls back to the default title", () => {
    render(<ErrorState reset={reset} />);
    expect(screen.getByRole("heading", { name: "Unable to load data" })).toBeTruthy();
  });

  it("does nothing until the button is clicked", () => {
    render(<ErrorState reset={reset} />);
    expect(refresh).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(transitions).toBe(0);
  });

  it("one click on 'Try again' re-runs the server render and clears the boundary, in one transition", () => {
    render(<ErrorState reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(transitions).toBe(1);
    // Both inside the transition's callback, refresh first.
    expect(log).toEqual(["refresh inTransition=true", "reset inTransition=true"]);
  });

  it("renders the optional links", () => {
    const { container } = render(
      <ErrorState reset={reset} links={[{ href: "/team/BUF", label: "Buffalo Bills" }]} />,
    );
    expect(container.querySelector('a[href="/team/BUF"]')?.textContent).toBe("Buffalo Bills");
  });
});
