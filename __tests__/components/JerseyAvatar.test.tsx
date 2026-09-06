import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import JerseyAvatar from "@/components/player/JerseyAvatar";

describe("JerseyAvatar", () => {
  it("renders an img when headshotUrl is set", () => {
    const { container } = render(
      <JerseyAvatar headshotUrl="https://img/x.png" jerseyNumber={17}
        primaryColor="#00338D" secondaryColor="#C60C30" playerName="Josh Allen" />
    );
    expect(container.querySelector("img")).not.toBeNull();
  });
  it("renders the jersey SVG with number when headshotUrl is null", () => {
    const { container, getByText } = render(
      <JerseyAvatar headshotUrl={null} jerseyNumber={17}
        primaryColor="#00338D" secondaryColor="#C60C30" playerName="Josh Allen" />
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(getByText("17")).toBeTruthy();
  });
  it("renders jersey with no number when jerseyNumber is null", () => {
    const { container } = render(
      <JerseyAvatar headshotUrl={null} jerseyNumber={null}
        primaryColor="#00338D" secondaryColor="#C60C30" playerName="X" />
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("text")).toBeNull();
  });
  it("falls back to the jersey SVG when the headshot fails to load", () => {
    const { container } = render(
      <JerseyAvatar headshotUrl="https://img/broken.png" jerseyNumber={17}
        primaryColor="#00338D" secondaryColor="#C60C30" playerName="Josh Allen" />
    );
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("text")?.textContent).toBe("17");
  });
});
