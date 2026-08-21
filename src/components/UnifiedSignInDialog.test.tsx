/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { signInMock } = vi.hoisted(() => ({ signInMock: vi.fn() }));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: signInMock }),
}));

vi.mock("./ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

vi.mock("../lib/useAuthError", () => ({
  clearAuthError: vi.fn(),
  setAuthError: vi.fn(),
}));

import { UnifiedSignInDialog } from "./UnifiedSignInDialog";

describe("UnifiedSignInDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signInMock.mockResolvedValue({ signingIn: true });
  });

  it("offers GitHub, Google, and a numeric email verification code sign-in", () => {
    render(<UnifiedSignInDialog locale="zh-CN" />);

    expect(screen.getByRole("button", { name: "GitHub" }).querySelector("svg")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Google" }).querySelector("svg")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "微信" })).toBeNull();
    expect(screen.getByRole("button", { name: "发送" })).toBeTruthy();
    expect(screen.queryByText("使用邮箱验证码，或通过 GitHub、Google、微信登录。")).toBeNull();
    const emailInput = screen.getByLabelText("邮箱地址");
    expect(emailInput.getAttribute("type")).toBe("email");
    expect(emailInput.getAttribute("maxlength")).toBe("38");
    const codeInput = screen.getByLabelText("4 位验证码");
    expect(codeInput.getAttribute("inputmode")).toBe("numeric");
    expect(codeInput.getAttribute("pattern")).toBe("[0-9]*");
    expect(codeInput.getAttribute("maxlength")).toBe("4");
    expect(screen.queryByText("发送登录链接")).toBeNull();
  });

  it("requests and verifies a 4-digit email code", async () => {
    render(<UnifiedSignInDialog locale="zh-CN" redirectTo="/dashboard" />);

    fireEvent.change(screen.getByLabelText("邮箱地址"), {
      target: { value: "USER@Example.COM" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(signInMock).toHaveBeenCalledWith("resend-otp", { email: "user@example.com" });
    });

    fireEvent.change(screen.getByLabelText("4 位验证码"), {
      target: { value: "12ab34" },
    });
    expect((screen.getByLabelText("4 位验证码") as HTMLInputElement).value).toBe("1234");
    const verifyButton = screen
      .getAllByRole("button", { name: "登录" })
      .find((button) => button.getAttribute("value") === "verify-code");
    expect(verifyButton).toBeTruthy();
    fireEvent.click(verifyButton as HTMLButtonElement);

    await waitFor(() => {
      expect(signInMock).toHaveBeenLastCalledWith("resend-otp", {
        email: "user@example.com",
        code: "1234",
        redirectTo: "/dashboard",
      });
    });
  });

  it("uses native email validation before requesting a code", () => {
    render(<UnifiedSignInDialog locale="zh-CN" />);

    fireEvent.change(screen.getByLabelText("邮箱地址"), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(signInMock).not.toHaveBeenCalled();
  });

  it("prevents concurrent code requests from replacing the valid code", () => {
    signInMock.mockReturnValue(new Promise(() => {}));
    render(<UnifiedSignInDialog locale="zh-CN" />);

    fireEvent.change(screen.getByLabelText("邮箱地址"), {
      target: { value: "user@example.com" },
    });
    const sendButton = screen.getByRole("button", { name: "发送" });
    fireEvent.click(sendButton);
    fireEvent.click(sendButton);

    expect(signInMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["GitHub", "github"],
    ["Google", "google"],
  ])("starts %s OAuth sign-in", async (buttonName, provider) => {
    render(<UnifiedSignInDialog locale="zh-CN" redirectTo="/dashboard" />);

    fireEvent.click(screen.getByRole("button", { name: buttonName }));

    await waitFor(() => {
      expect(signInMock).toHaveBeenCalledWith(provider, { redirectTo: "/dashboard" });
    });
  });
});
