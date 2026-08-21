import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, FileCode2, ShieldCheck } from "lucide-react";
import { createElement, useEffect } from "react";

const OPENAPI_URL = "/api/v1/desktop/openapi.yaml";
const CONTRACT_URL = "/api/v1/desktop/contract";

export const Route = createFileRoute("/api-docs/desktop")({
  component: DesktopApiDocsPage,
  head: () => ({
    meta: [
      { title: "Desktop Client API 文档 | AI直聘" },
      {
        name: "description",
        content: "AI直聘桌面客户端 API 的可检索、可调试 OpenAPI 文档。",
      },
    ],
  }),
});

function DesktopApiDocsPage() {
  useEffect(() => {
    void import("rapidoc");
  }, []);

  return (
    <main className="min-h-screen bg-[var(--bg)] pb-12">
      <section className="border-b border-[var(--line)] bg-[var(--bg-soft)]">
        <div className="mx-auto flex max-w-[1536px] flex-col gap-5 px-4 py-8 sm:px-6 lg:flex-row lg:items-end lg:justify-between lg:px-8">
          <div className="max-w-3xl">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--accent)]">
              <FileCode2 size={17} />
              AI直聘桌面客户端 API v1
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)] sm:text-4xl">
              AI直聘桌面客户端 API 文档
            </h1>
            <p className="mt-3 text-base leading-7 text-[var(--ink-soft)]">
              浏览、检索和调试当前生产 OpenAPI 契约。受保护接口需要在右上角配置 Bearer Token。
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <a
              className="inline-flex items-center gap-2 rounded-md border border-[var(--border-ui)] px-3 py-2 font-medium text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              href={CONTRACT_URL}
              target="_blank"
              rel="noreferrer"
            >
              <ShieldCheck size={16} />
              契约发现
              <ExternalLink size={14} />
            </a>
            <a
              className="inline-flex items-center gap-2 rounded-md border border-[var(--border-ui)] px-3 py-2 font-medium text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              href={OPENAPI_URL}
              target="_blank"
              rel="noreferrer"
            >
              下载 OpenAPI YAML
              <ExternalLink size={14} />
            </a>
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-[1536px] px-4 pt-6 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-[var(--border-ui)] bg-[var(--bg-soft)] p-4 text-sm leading-6 text-[var(--ink-soft)]">
          <p className="font-semibold text-[var(--ink)]">生产能力状态说明</p>
          <div className="mt-2 grid gap-x-6 gap-y-1 md:grid-cols-2">
            <p>
              <code>available</code>：生产已启用，调用时仍需满足鉴权、组织权限和会话能力。
            </p>
            <p>
              <code>documented_disabled</code>：契约已定义，但生产开关或运行配置关闭。
            </p>
            <p>
              <code>planned</code>：规划能力，尚无可调用的生产接口。
            </p>
            <p>
              <code>deprecated</code>：兼容保留，新客户端不得继续依赖。
            </p>
          </div>
          <p className="mt-2">
            OpenAPI 中出现某个接口不代表业务已启用。客户端必须先读取“契约发现”和会话能力；手工填写
            Bearer Token 仅用于调试，不等于 OAuth 登录已经可用。
          </p>
        </div>
      </section>
      <section className="mx-auto max-w-[1536px] px-2 pt-6 sm:px-4 lg:px-6">
        {createElement("rapi-doc", {
          "allow-authentication": "true",
          "allow-search": "true",
          "allow-try": "true",
          "bg-color": "#071d20",
          "header-color": "#0a282b",
          "load-fonts": "false",
          "nav-bg-color": "#0a282b",
          "primary-color": "#22c55e",
          "render-style": "read",
          "schema-style": "table",
          "show-header": "false",
          "spec-url": OPENAPI_URL,
          "text-color": "#f7fffe",
          lang: "zh-CN",
          theme: "dark",
          "update-route": "false",
        })}
      </section>
    </main>
  );
}
