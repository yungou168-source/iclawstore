import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Boxes,
  Check,
  Copy,
  FileCode2,
  KeyRound,
  Play,
  Repeat2,
  ShieldCheck,
  Terminal,
  Unlock,
  UsersRound,
  Workflow,
} from "lucide-react";
import { useState } from "react";
import { useLocale } from "../lib/i18n/context";

type HomeCopy = {
  badge: string;
  title: string;
  titleHighlight: string;
  subtitle: string;
  primaryAction: string;
  secondaryAction: string;
  installHint: string;
  copy: string;
  copied: string;
  stats: readonly { value: string; label: string }[];
  previewTitle: string;
  previewDescription: string;
  previewAction: string;
  featuresTitle: string;
  featuresSubtitle: string;
  features: readonly { title: string; description: string }[];
  providersTitle: string;
  providersSubtitle: string;
  keyed: string;
  keyfree: string;
  finalAction: string;
};

const COPY: Record<"zh-CN" | "en", HomeCopy> = {
  "zh-CN": {
    badge: "AI 团队协作平台",
    title: "一句话，组建你的",
    titleHighlight: "AI 团队",
    subtitle: "把专家、工作流和已验证的能力放进同一个工作台，让每次协作都可追踪、可复用。",
    primaryAction: "进入工作台",
    secondaryAction: "浏览能力市场",
    installHint: "在本地终端开始",
    copy: "复制",
    copied: "已复制",
    stats: [
      { value: "267+", label: "专业角色" },
      { value: "61", label: "工作流模板" },
      { value: "DAG", label: "自动协作编排" },
      { value: "∞", label: "可扩展技能" },
    ],
    previewTitle: "从任务到团队，一次完成",
    previewDescription: "选择角色、确认协作步骤，再将公开市场中的技能补充到团队工作流。",
    previewAction: "打开团队工作台",
    featuresTitle: "不是聊天窗口，而是可运行的团队",
    featuresSubtitle: "从编排、执行到产物回收，每个环节都有明确的位置。",
    features: [
      { title: "自动组队", description: "根据任务选择合适的 AI 专家，并明确每个角色的职责。" },
      { title: "工作流编排", description: "用依赖关系表达协作顺序，独立步骤可并行执行。" },
      { title: "产物可追踪", description: "保留步骤输出与运行状态，支持从指定节点继续迭代。" },
      { title: "能力可复用", description: "将技能、插件和建设者资源作为团队的可选能力。" },
      { title: "安全边界", description: "在接入能力前提供清晰的审核与风险信息。" },
      { title: "统一工作区", description: "用一个入口管理团队、资源与持续协作。" },
    ],
    providersTitle: "连接适合团队的模型能力",
    providersSubtitle: "保留不同供应商和本地运行方式，让团队协作不受单一模型限制。",
    keyed: "受控模型连接",
    keyfree: "公开市场资源",
    finalAction: "开始构建 AI 团队",
  },
  en: {
    badge: "AI team collaboration platform",
    title: "One brief. Your",
    titleHighlight: "AI team.",
    subtitle:
      "Bring experts, workflows, and verified capabilities into one workspace where every collaboration is traceable and reusable.",
    primaryAction: "Open workspace",
    secondaryAction: "Browse marketplace",
    installHint: "Start from your terminal",
    copy: "Copy",
    copied: "Copied",
    stats: [
      { value: "267+", label: "expert roles" },
      { value: "61", label: "workflow templates" },
      { value: "DAG", label: "orchestration" },
      { value: "∞", label: "extensible skills" },
    ],
    previewTitle: "From a task to a team",
    previewDescription:
      "Choose roles, confirm collaboration steps, then add marketplace capabilities to the workflow.",
    previewAction: "Open team workspace",
    featuresTitle: "More than a chat window",
    featuresSubtitle:
      "Orchestration, execution, and artifacts each have a clear place in the team workspace.",
    features: [
      {
        title: "Automatic teams",
        description: "Match the task with the right AI experts and clear responsibilities.",
      },
      {
        title: "Workflow orchestration",
        description: "Express dependencies directly, while independent steps run in parallel.",
      },
      {
        title: "Traceable artifacts",
        description: "Keep step outputs and run states, then resume from a specific node.",
      },
      {
        title: "Reusable capabilities",
        description: "Use skills, plugins, and builder resources as optional team capabilities.",
      },
      {
        title: "Clear safety boundary",
        description: "Review risk and audit information before bringing in a capability.",
      },
      {
        title: "One workspace",
        description: "Manage teams, resources, and ongoing collaboration from one entry point.",
      },
    ],
    providersTitle: "Connect the model capabilities your team needs",
    providersSubtitle:
      "Keep provider and local-runtime options open instead of binding collaboration to one model.",
    keyed: "Managed model connections",
    keyfree: "Public marketplace resources",
    finalAction: "Build an AI team",
  },
};

const FEATURE_ICONS = [UsersRound, Workflow, FileCode2, Boxes, ShieldCheck, Repeat2] as const;
const INSTALL_COMMAND = 'ao compose "为产品发布组建 AI 团队" --run';

export function HomeWorkspace() {
  const { locale } = useLocale();
  const copy = COPY[locale === "en" ? "en" : "zh-CN"];

  return (
    <main className="desktop-home">
      <section className="desktop-home-hero">
        <div className="desktop-home-grid" aria-hidden="true" />
        <div className="desktop-home-glow" aria-hidden="true" />
        <div className="desktop-home-container desktop-home-hero-content">
          <span className="desktop-home-badge">
            <Workflow size={15} /> {copy.badge}
          </span>
          <h1>
            {copy.title} <strong>{copy.titleHighlight}</strong>
          </h1>
          <p>{copy.subtitle}</p>
          <div className="desktop-home-actions">
            <Link
              to="/skills"
              search={{
                q: undefined,
                sort: undefined,
                dir: undefined,
                highlighted: undefined,
                view: undefined,
                focus: undefined,
              }}
              className="desktop-home-button desktop-home-button-primary"
            >
              <Play size={17} fill="currentColor" /> {copy.primaryAction}
            </Link>
            <Link to="/plugins" className="desktop-home-button desktop-home-button-secondary">
              {copy.secondaryAction} <ArrowRight size={17} />
            </Link>
          </div>
          <InstallCommand copy={copy} />
          <div className="desktop-home-stats">
            {copy.stats.map((stat) => (
              <div key={stat.label}>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="desktop-home-container desktop-home-preview-section">
        <div className="desktop-home-section-heading">
          <h2>{copy.previewTitle}</h2>
          <p>{copy.previewDescription}</p>
        </div>
        <Link
          to="/skills"
          search={{
            q: undefined,
            sort: undefined,
            dir: undefined,
            highlighted: undefined,
            view: undefined,
            focus: undefined,
          }}
          className="desktop-home-preview"
        >
          <div className="desktop-home-window-bar">
            <i />
            <i />
            <i />
            <span>AI直聘 / 团队工作台</span>
          </div>
          <div className="desktop-home-window-body">
            <aside>
              <span className="desktop-home-window-logo">AI</span>
              <b>{locale === "en" ? "Workspace" : "工作台"}</b>
              <span className="is-active">
                <UsersRound size={15} /> {locale === "en" ? "Team" : "团队"}
              </span>
              <span>
                <Workflow size={15} /> {locale === "en" ? "Workflows" : "工作流"}
              </span>
              <span>
                <FileCode2 size={15} /> {locale === "en" ? "Artifacts" : "产物"}
              </span>
            </aside>
            <div className="desktop-home-window-main">
              <div className="desktop-home-window-title">
                <div>
                  <small>{locale === "en" ? "YOUR AI TEAM" : "你的 AI 团队"}</small>
                  <strong>{locale === "en" ? "Product launch" : "产品发布"}</strong>
                </div>
                <button type="button">{locale === "en" ? "Run workflow" : "运行工作流"}</button>
              </div>
              <div className="desktop-home-role-grid">
                {copy.features.slice(0, 3).map((feature, index) => (
                  <div key={feature.title}>
                    <span>{index + 1}</span>
                    <b>{feature.title}</b>
                    <small>
                      {index === 0
                        ? locale === "en"
                          ? "Ready"
                          : "已就绪"
                        : locale === "en"
                          ? "Queued"
                          : "等待中"}
                    </small>
                  </div>
                ))}
              </div>
              <div className="desktop-home-run-line">
                <Check size={15} />{" "}
                {locale === "en" ? "Team plan is ready to run" : "团队方案已准备就绪"}
                <ArrowRight size={15} />
              </div>
            </div>
          </div>
          <span className="desktop-home-preview-action">
            {copy.previewAction} <ArrowRight size={16} />
          </span>
        </Link>
      </section>

      <section className="desktop-home-features">
        <div className="desktop-home-container">
          <div className="desktop-home-section-heading">
            <h2>{copy.featuresTitle}</h2>
            <p>{copy.featuresSubtitle}</p>
          </div>
          <div className="desktop-home-feature-grid">
            {copy.features.map((feature, index) => {
              const Icon = FEATURE_ICONS[index] ?? Workflow;
              return (
                <article key={feature.title}>
                  <span>
                    <Icon size={21} />
                  </span>
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="desktop-home-container desktop-home-providers">
        <div className="desktop-home-section-heading">
          <h2>{copy.providersTitle}</h2>
          <p>{copy.providersSubtitle}</p>
        </div>
        <div className="desktop-home-provider-grid">
          <article className="is-primary">
            <h3>
              <KeyRound size={19} /> {copy.keyed}
            </h3>
            <div>
              <span>Jinsha</span>
              <span>OpenAI</span>
              <span>Claude</span>
              <span>DeepSeek</span>
            </div>
          </article>
          <article>
            <h3>
              <Unlock size={19} /> {copy.keyfree}
            </h3>
            <div>
              <span>Skills</span>
              <span>Plugins</span>
              <span>Agents</span>
              <span>Workflows</span>
            </div>
          </article>
        </div>
      </section>

      <section className="desktop-home-container desktop-home-final">
        <div>
          <h2>
            {copy.title} {copy.titleHighlight}
          </h2>
          <p>{copy.subtitle}</p>
          <Link
            to="/skills"
            search={{
              q: undefined,
              sort: undefined,
              dir: undefined,
              highlighted: undefined,
              view: undefined,
              focus: undefined,
            }}
            className="desktop-home-button desktop-home-button-primary"
          >
            <Play size={17} fill="currentColor" /> {copy.finalAction}
          </Link>
        </div>
      </section>
    </main>
  );
}

function InstallCommand({ copy }: { copy: HomeCopy }) {
  const [copied, setCopied] = useState(false);
  const copyCommand = async () => {
    await navigator.clipboard?.writeText(INSTALL_COMMAND);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="desktop-home-install">
      <p>{copy.installHint}</p>
      <div>
        <Terminal size={16} />
        <code>{INSTALL_COMMAND}</code>
        <button type="button" onClick={() => void copyCommand()} aria-label={copy.copy}>
          {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? copy.copied : copy.copy}
        </button>
      </div>
    </div>
  );
}
