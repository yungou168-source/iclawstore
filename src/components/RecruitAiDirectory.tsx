import { Download, Search, UserRoundCheck } from 'lucide-react';
import { useState } from 'react';
import expertsData from '../content/experts.json';
import { useLocale } from '../lib/i18n/context';
import { AI_WORK_RELEASES_URL } from '../lib/nav-items';

type Expert = {
  category: string;
  categoryName: string;
  id: string;
  name: string;
  description: string;
  emoji: string;
  color: string;
};

const EXPERTS_BY_LANGUAGE = expertsData as Record<string, Expert[]>;
const EXPERT_PAGE_SIZE = 12;

export function RecruitAiDirectory() {
  const { locale } = useLocale();
  const experts =
    EXPERTS_BY_LANGUAGE[locale === 'en' ? 'en' : 'zh'] ?? EXPERTS_BY_LANGUAGE.zh ?? [];
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [selectedExpertId, setSelectedExpertId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(EXPERT_PAGE_SIZE);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const categories = [
    ...new Map(experts.map((expert) => [expert.category, expert.categoryName])).entries(),
  ];
  const matchingExperts = experts.filter(
    (expert) =>
      (category === 'all' || expert.category === category) &&
      (!normalizedQuery ||
        `${expert.name} ${expert.description} ${expert.categoryName}`
          .toLocaleLowerCase()
          .includes(normalizedQuery)),
  );
  const visibleExperts = matchingExperts.slice(0, visibleCount);
  const selectedExpert = experts.find((expert) => expert.id === selectedExpertId) ?? null;

  const updateCategory = (nextCategory: string) => {
    setCategory(nextCategory);
    setVisibleCount(EXPERT_PAGE_SIZE);
  };

  const updateQuery = (nextQuery: string) => {
    setQuery(nextQuery);
    setVisibleCount(EXPERT_PAGE_SIZE);
  };

  return (
    <main className="desktop-home">
      <section className="desktop-home-hero">
        <div className="desktop-home-grid" aria-hidden="true" />
        <div className="desktop-home-glow" aria-hidden="true" />
        <div className="desktop-home-container desktop-home-hero-content">
          <span className="desktop-home-badge">
            <UserRoundCheck size={15} /> {locale === 'en' ? 'AI employee directory' : 'AI 员工目录'}
          </span>
          <h1>{locale === 'en' ? 'Hire your ' : '招聘你的'}<strong>{locale === 'en' ? 'AI employees' : 'AI 员工'}</strong></h1>
          <p>
            {locale === 'en'
              ? 'Browse the same role catalog as the desktop client, then choose the employee that fits your work.'
              : '浏览与客户端一致的岗位角色库，为你的工作选择合适的 AI 员工。'}
          </p>
        </div>
      </section>

      <section className="desktop-home-container ai-employee-directory">
        <div className="ai-employee-toolbar">
          <label className="ai-employee-search">
            <Search size={17} aria-hidden="true" />
            <span className="sr-only">{locale === 'en' ? 'Search AI employees' : '搜索 AI 员工'}</span>
            <input
              value={query}
              onChange={(event) => updateQuery(event.target.value)}
              placeholder={locale === 'en' ? 'Search roles or skills' : '搜索岗位、领域或技能'}
            />
          </label>
          <span>{matchingExperts.length} {locale === 'en' ? 'roles' : '个岗位'}</span>
        </div>
        <div className="ai-employee-categories" aria-label={locale === 'en' ? 'Employee categories' : '员工分类'}>
          <button type="button" className={category === 'all' ? 'is-active' : undefined} onClick={() => updateCategory('all')}>
            {locale === 'en' ? 'All' : '全部'}
          </button>
          {categories.map(([id, name]) => (
            <button type="button" key={id} className={category === id ? 'is-active' : undefined} onClick={() => updateCategory(id)}>
              {name}
            </button>
          ))}
        </div>
        <div className="ai-employee-grid">
          {visibleExperts.map((expert) => {
            const isSelected = selectedExpert?.id === expert.id;
            return (
              <article key={expert.id} className={`ai-employee-card${isSelected ? ' is-selected' : ''}`}>
                <div className="ai-employee-card-header">
                  <span className="ai-employee-avatar" style={{ backgroundColor: expert.color || '#078c90' }}>
                    {expert.emoji || expert.name.slice(0, 1)}
                  </span>
                  <div>
                    <small>{expert.categoryName}</small>
                    <h3>{expert.name}</h3>
                  </div>
                </div>
                <p>{expert.description}</p>
                <button type="button" onClick={() => setSelectedExpertId(isSelected ? null : expert.id)}>
                  {isSelected ? (locale === 'en' ? 'Selected' : '已选择') : (locale === 'en' ? 'Choose employee' : '选择员工')}
                </button>
              </article>
            );
          })}
        </div>
        {matchingExperts.length === 0 ? <p className="ai-employee-empty">{locale === 'en' ? 'No matching AI employees.' : '没有匹配的 AI 员工。'}</p> : null}
        {visibleExperts.length < matchingExperts.length ? (
          <div className="ai-employee-more">
            <button type="button" onClick={() => setVisibleCount((count) => count + EXPERT_PAGE_SIZE)}>
              {locale === 'en' ? 'Load more' : '查看更多'}
            </button>
          </div>
        ) : null}
        <div className="ai-employee-selection" aria-live="polite">
          <div>
            <strong>{selectedExpert ? selectedExpert.name : (locale === 'en' ? 'No employee selected' : '尚未选择员工')}</strong>
            <span>{selectedExpert ? selectedExpert.categoryName : (locale === 'en' ? 'Select a role to continue in the desktop client.' : '选择岗位后可在客户端继续招聘。')}</span>
          </div>
          <a href={AI_WORK_RELEASES_URL} target="_blank" rel="noreferrer" className="desktop-home-button desktop-home-button-primary">
            <Download size={17} /> {locale === 'en' ? 'Continue in desktop client' : '在客户端继续招聘'}
          </a>
        </div>
      </section>
    </main>
  );
}