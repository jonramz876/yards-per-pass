import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const refresh = vi.fn();
const params: { game_id?: string } = { game_id: "2026_01_BUF_HOU" };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  useParams: () => params,
}));

import GamePageError from "@/app/game/[game_id]/error";

const ERROR = Object.assign(new Error("Failed to fetch team game stats"), { digest: "abc123" });

beforeEach(() => {
  refresh.mockReset();
  params.game_id = "2026_01_BUF_HOU";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GamePageError (box score spec §6)", () => {
  it("'Try again' retries the server read exactly once (the retry lives in ErrorState)", () => {
    // In Next 14 reset() re-renders the client error boundary against the RSC
    // payload it already holds; it does not re-run the Server Component, so
    // without router.refresh() the button re-shows the same error for ever.
    // Since read resilience PR 1A the refresh is ErrorState's, for every
    // route (__tests__/components/ErrorState.test.tsx pins the transition).
    // This wrapper must pass plain `reset`: its own refresh would make two.
    const reset = vi.fn();
    render(<GamePageError error={ERROR} reset={reset} />);
    fireEvent.click(screen.getByText("Try again"));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("keeps the two team links every other failure state on this page keeps", () => {
    // uncovered and playoffs both hand the visitor both team pages
    // (page.tsx's teamLinks). A game whose box score failed to load still has
    // two team pages worth reading; the error card used to offer a GitHub
    // issue link and nothing else. The address itself carries the two codes.
    const { container } = render(<GamePageError error={ERROR} reset={vi.fn()} />);
    expect(container.querySelector('a[href="/team/BUF"]')?.textContent).toBe("Buffalo Bills");
    expect(container.querySelector('a[href="/team/HOU"]')?.textContent).toBe("Houston Texans");
  });

  it("offers no team links for an address that is not a game id", () => {
    params.game_id = "not-a-game";
    const { container } = render(<GamePageError error={ERROR} reset={vi.fn()} />);
    expect(container.querySelector('a[href^="/team/"]')).toBeNull();
    expect(screen.getByText("Unable to load this box score")).toBeTruthy();
    expect(container.textContent).not.toMatch(/undefined|null/);
  });

  it("logs the error it was handed", () => {
    render(<GamePageError error={ERROR} reset={vi.fn()} />);
    expect(console.error).toHaveBeenCalledWith("Box score page error:", ERROR);
  });
});
