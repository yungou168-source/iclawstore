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
              Desktop Client API v1
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
          theme: "dark",
          "update-route": "false",
        })}
      </section>
    </main>
  );
}
