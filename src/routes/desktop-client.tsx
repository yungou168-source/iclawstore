import { createFileRoute, Link } from '@tanstack/react-router';
import { CheckCircle2, Download, MonitorDown, PackageCheck, ShieldCheck } from 'lucide-react';
import { AI_WORK_RELEASES_URL } from '../lib/nav-items';
import { useLocale } from '../lib/i18n/context';

export const Route = createFileRoute('/desktop-client')({
  component: DesktopClientPage,
});

function DesktopClientPage() {
  const { locale } = useLocale();
  const isEnglish = locale === 'en';
  const steps = isEnglish
    ? ['Download the installer for your operating system.', 'Install and open AI Direct Hiring.', 'Choose employees and start collaborating.']
    : ['下载对应操作系统的安装包。', '安装并打开 AI直聘客户端。', '选择员工并开始协作。'];

  return (
    <main className="desktop-home">
      <section className="desktop-home-hero">
        <div className="desktop-home-grid" aria-hidden="true" />
        <div className="desktop-home-glow" aria-hidden="true" />
        <div className="desktop-home-container desktop-home-hero-content">
          <span className="desktop-home-badge"><MonitorDown size={15} /> {isEnglish ? 'Desktop client' : '桌面客户端'}</span>
          <h1>{isEnglish ? 'Bring AI employees into your ' : '把 AI 员工带到你的'}<strong>{isEnglish ? 'workspace' : '工作台'}</strong></h1>
          <p>{isEnglish ? 'Download the desktop client to interview candidates, organize a team, and run AI workflows locally.' : '下载桌面客户端，在本地面试候选员工、组织团队并运行 AI 工作流。'}</p>
          <div className="desktop-home-actions">
            <a href={AI_WORK_RELEASES_URL} target="_blank" rel="noreferrer" className="desktop-home-button desktop-home-button-primary">
              <Download size={17} /> {isEnglish ? 'View downloads' : '查看下载版本'}
            </a>
            <Link to="/recruit-ai" className="desktop-home-button desktop-home-button-secondary">
              {isEnglish ? 'Browse AI employees' : '浏览 AI 员工'}
            </Link>
          </div>
        </div>
      </section>

      <section className="desktop-home-container desktop-home-features">
        <div className="desktop-home-section-heading">
          <h2>{isEnglish ? 'Get started in three steps' : '三步开始使用'}</h2>
          <p>{isEnglish ? 'The desktop client keeps employee selection and workflow execution in one local workspace.' : '桌面客户端将员工选择和工作流执行集中在同一个本地工作区。'}</p>
        </div>
        <div className="desktop-home-feature-grid">
          {steps.map((step, index) => {
            const Icon = [Download, PackageCheck, ShieldCheck][index] ?? CheckCircle2;
            return <article key={step}><span><Icon size={21} /></span><h3>{isEnglish ? `Step ${index + 1}` : `第 ${index + 1} 步`}</h3><p>{step}</p></article>;
          })}
        </div>
      </section>
    </main>
  );
}